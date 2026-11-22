/* js/intelligence/persistence.js — Signal Persistence (P-02)
   ============================================================
   READ-ONLY w.r.t. CRM data. Independent Intelligence storage only.

   Purpose:
     A signal must accumulate minOccurrences valid detections inside a
     rolling window before it becomes active for Risk scoring.

   Public API:
     applyPersistence(signals) -> signals (same array, each gets .status)
     getOccurrenceCount(customerId, category, productId) -> number
     clearIntelligencePersistence() -> void   (test / reset helper)
     PERSISTENCE_PARAMS

   Storage:
     - In-memory map (session source of truth)
     - localStorage key bagheri_intelligence_occurrences (sync backup)
     - IndexedDB bagheri_intelligence_db / store occurrences (async mirror)
     Never writes to CRM stores, customers, invoices, checks, etc.

   Key: customerId|category|familyId-or-productId(or empty)
        (familyId = analysisGroupId || productId, runtime only)
   One occurrence per calendar day per key.
   ============================================================ */
'use strict';

(function (global) {

  var PERSISTENCE_PARAMS = {
    minOccurrences: 2,
    windowDays: 60,
    lsKey: 'bagheri_intelligence_occurrences',
    idbName: 'bagheri_intelligence_db',
    idbStore: 'occurrences',
    idbVersion: 4
  };

  // key -> array of ISO date strings (YYYY-MM-DD), newest not required sorted
  var _mem = Object.create(null);
  var _hydrated = false;
  var _idb = null;

  function _today() {
    if (typeof todayISO === 'function') return todayISO();
    return new Date().toISOString().slice(0, 10);
  }

  function _dateOnly(iso) {
    if (!iso) return _today();
    return String(iso).slice(0, 10);
  }

  function _daysBetween(later, earlier) {
    var a = new Date(String(later).slice(0, 10)).getTime();
    var b = new Date(String(earlier).slice(0, 10)).getTime();
    if (isNaN(a) || isNaN(b)) return null;
    return Math.round((a - b) / 86400000);
  }

  function _makeKey(customerId, category, productId) {
    var pid = (productId != null && productId !== '' && productId !== 'multi')
      ? String(productId)
      : '';
    return String(customerId) + '|' + String(category) + '|' + pid;
  }

  function _prune(dates, asOf) {
    var window = PERSISTENCE_PARAMS.windowDays;
    var kept = [];
    for (var i = 0; i < dates.length; i++) {
      var d = dates[i];
      var diff = _daysBetween(asOf, d);
      if (diff != null && diff >= 0 && diff <= window) kept.push(d);
    }
    // unique
    var seen = Object.create(null);
    var uniq = [];
    for (var j = 0; j < kept.length; j++) {
      if (!seen[kept[j]]) {
        seen[kept[j]] = true;
        uniq.push(kept[j]);
      }
    }
    return uniq;
  }

  function _loadLocalStorage() {
    try {
      if (typeof localStorage === 'undefined' || !localStorage) return;
      var raw = localStorage.getItem(PERSISTENCE_PARAMS.lsKey);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return;
      var keys = Object.keys(parsed);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (Array.isArray(parsed[k])) {
          _mem[k] = parsed[k].slice();
        }
      }
      _hydrated = true;
    } catch (e) {
      // ignore corrupt storage
    }
  }

  function _saveLocalStorage() {
    try {
      if (typeof localStorage === 'undefined' || !localStorage) return;
      localStorage.setItem(PERSISTENCE_PARAMS.lsKey, JSON.stringify(_mem));
    } catch (e) {
      // quota / private mode — memory still works for session
    }
  }

  function _openIdb(cb) {
    if (typeof indexedDB === 'undefined' || !indexedDB) {
      if (cb) cb(null);
      return;
    }
    try {
      var req = indexedDB.open(PERSISTENCE_PARAMS.idbName, PERSISTENCE_PARAMS.idbVersion);
      req.onupgradeneeded = function (ev) {
        var db = ev.target.result;
        // Shared bagheri_intelligence_db schema (v4): ensure all Intelligence stores.
        if (!db.objectStoreNames.contains('occurrences')) {
          db.createObjectStore('occurrences', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('seller_feedback')) {
          db.createObjectStore('seller_feedback', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('baseline_cache')) {
          db.createObjectStore('baseline_cache', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('seller_acks')) {
          var _ackSt = db.createObjectStore('seller_acks', { keyPath: 'id' });
          try {
            _ackSt.createIndex('by_customer_status', ['customerId', 'status'], { unique: false });
            _ackSt.createIndex('by_expiry', 'expiresAt', { unique: false });
          } catch (_ackIdxErr) { /* ignore */ }
        }
      };
      req.onsuccess = function (ev) {
        _idb = ev.target.result;
        if (cb) cb(_idb);
      };
      req.onerror = function () {
        if (cb) cb(null);
      };
    } catch (e) {
      if (cb) cb(null);
    }
  }


  /* ---------- v117: safe Restore / hydration ----------
     replace = epoch++ -> memory EXACTLY the new snapshot (no merge) -> LS mirror aligned -> snapshot marked
     pending -> written to IndexedDB in ONE transaction (clear + every put) when the DB is ready.
     pending is cleared ONLY in transaction.oncomplete, and only if it still belongs to that snapshot's epoch;
     error / abort / synchronous failures keep it, and the next hydration / write retries (no timers, no queues).
     A hydration read remembers the epoch it started in: a late answer after a replace is ignored entirely. */
  var _epoch = 0;
  var _pending = null;            // { epoch, cbs, writing }
  var _idbState = 'opening';      // 'opening' | 'ready' | 'unavailable'

  function _currentRows() {
    return Object.keys(_mem).map(function (k) { return { key: k, dates: _mem[k].slice() }; });
  }

  function _runCbs(snap, ok) {
    var cbs = snap.cbs || [];
    snap.cbs = [];
    for (var i = 0; i < cbs.length; i++) {
      try { cbs[i](ok); } catch (e) { /* caller errors never break storage */ }
    }
  }

  function _flushPending() {
    var snap = _pending;
    if (!snap || snap.writing) return;
    if (!_idb) {
      // no IndexedDB at all (unsupported / failed to open): memory + LS mirror are the persistence layer
      if (_idbState === 'unavailable') { _pending = null; _runCbs(snap, true); }
      return;                      // still opening: the first hydration / write after it is ready flushes
    }
    var tx = null;
    try {
      tx = _idb.transaction(PERSISTENCE_PARAMS.idbStore, 'readwrite');
      snap.writing = true;
      tx.oncomplete = function () {
        snap.writing = false;
        if (_pending === snap && _epoch === snap.epoch) { _pending = null; _runCbs(snap, true); }
      };
      var failed = function () {
        snap.writing = false;      // pending stays: retried by the next hydration / write
        _runCbs(snap, false);
      };
      tx.onerror = failed;
      tx.onabort = failed;
      var st = tx.objectStore(PERSISTENCE_PARAMS.idbStore);
      st.clear();
      var rows = _currentRows();
      for (var i = 0; i < rows.length; i++) st.put(rows[i]);
    } catch (e) {
      snap.writing = false;
      try { if (tx) tx.abort(); } catch (eA) { /* ignore */ }
      _runCbs(snap, false);
    }
  }

  function replaceAllOccurrences(rows, onDone) {
    var prev = _pending;
    _epoch++;
    if (prev) _runCbs(prev, false);       // superseded snapshot: its caller must not assume success
    _mem = Object.create(null);
    (Array.isArray(rows) ? rows : []).forEach(function (r) {
      if (r && r.key != null && Array.isArray(r.dates)) _mem[r.key] = r.dates.slice();
    });
    _hydrated = true;
    _saveLocalStorage();
    _pending = { epoch: _epoch, cbs: (typeof onDone === 'function') ? [onDone] : [], writing: false };
    _flushPending();
    return { epoch: _epoch, dbPending: !!_pending };
  }

  function _idbPut(key, dates) {
    if (_pending) { _flushPending(); return; }   // a pending restore is written as a whole, never overtaken
    if (!_idb) return;
    try {
      var tx = _idb.transaction(PERSISTENCE_PARAMS.idbStore, 'readwrite');
      var store = tx.objectStore(PERSISTENCE_PARAMS.idbStore);
      store.put({ key: key, dates: dates });
    } catch (e) { /* ignore */ }
  }

  function _idbDelete(key) {
    if (_pending) { _flushPending(); return; }
    if (!_idb) return;
    try {
      var tx = _idb.transaction(PERSISTENCE_PARAMS.idbStore, 'readwrite');
      tx.objectStore(PERSISTENCE_PARAMS.idbStore).delete(key);
    } catch (e) { /* ignore */ }
  }

  // cb(applied): applied === false means nothing was read into memory / LS (stale answer, pending restore, error)
  function _idbHydrate(cb) {
    if (_pending) { _flushPending(); if (cb) cb(false); return; }   // restored snapshot goes TO the DB, never the reverse
    if (!_idb) {
      if (cb) cb(false);
      return;
    }
    try {
      var startEpoch = _epoch;
      var tx = _idb.transaction(PERSISTENCE_PARAMS.idbStore, 'readonly');
      var store = tx.objectStore(PERSISTENCE_PARAMS.idbStore);
      var req = store.getAll();
      req.onsuccess = function () {
        if (_epoch !== startEpoch || _pending) {       // a replace happened while this read was in flight
          _flushPending();
          if (cb) cb(false);
          return;
        }
        var rows = req.result || [];
        for (var i = 0; i < rows.length; i++) {
          var row = rows[i];
          if (row && row.key && Array.isArray(row.dates)) {
            // merge: prefer union of dates
            var existing = _mem[row.key] || [];
            var merged = existing.concat(row.dates);
            _mem[row.key] = _prune(merged, _today());
          }
        }
        _hydrated = true;
        if (cb) cb(true);
      };
      req.onerror = function () { if (cb) cb(false); };
    } catch (e) {
      if (cb) cb(false);
    }
  }

  /**
   * Cold-Key GC (maintenance-only; runs once at bootstrap, never from the
   * render/reconcile hot path). A key is "cold" when _prune() reduces its
   * dates to an empty array as-of today — i.e. every occurrence it holds
   * has already aged out of PERSISTENCE_PARAMS.windowDays. Removing such a
   * key changes nothing about future behavior: recordOccurrence() already
   * treats a missing key exactly like a cold one (dates=[], fresh count
   * starting at 1, status 'pending' via statusFromCount) — see the
   * `_mem[key] ? _mem[key].slice() : []` fallback there and in
   * getOccurrenceCount(). This function does not touch _prune, does not
   * touch keys that still have at least one date inside the window, and
   * does not alter recordOccurrence/status logic in any way.
   * Removal is applied to all three storage layers together so a later
   * _idbHydrate() (which merges IndexedDB rows back into _mem) cannot
   * resurrect a key this sweep already removed.
   */
  function _sweepColdKeys() {
    var today = _today();
    var removedKeys = [];
    var keys = Object.keys(_mem);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var pruned = _prune(_mem[k] || [], today);
      if (pruned.length === 0) {
        delete _mem[k];
        removedKeys.push(k);
      }
    }
    if (removedKeys.length) {
      _saveLocalStorage();
      for (var j = 0; j < removedKeys.length; j++) {
        _idbDelete(removedKeys[j]);
      }
    }
    return removedKeys.length;
  }

  // Bootstrap: localStorage first (sync), IDB async mirror, then a single
  // maintenance GC pass over whatever is now in _mem (local-only keys and
  // freshly hydrated IDB keys alike). Not called from applyPersistence,
  // recordOccurrence, or getOccurrenceCount — bootstrap-only, once per load.
  _loadLocalStorage();
  _openIdb(function (db) {
    _idbState = db ? 'ready' : 'unavailable';
    // Bootstrap GC must never prune / delete a snapshot restored before it ran (_epoch > 0).
    if (db) _idbHydrate(function (applied) { if (!applied) return; _saveLocalStorage(); if (_epoch === 0) _sweepColdKeys(); });
    else { _flushPending(); if (_epoch === 0) _sweepColdKeys(); }
  });

  function recordOccurrence(customerId, category, productId, timestamp) {
    if (!customerId || !category) return 0;
    var key = _makeKey(customerId, category, productId);
    var day = _dateOnly(timestamp);
    var dates = _mem[key] ? _mem[key].slice() : [];
    dates = _prune(dates, day);
    var hasDay = false;
    for (var i = 0; i < dates.length; i++) {
      if (dates[i] === day) { hasDay = true; break; }
    }
    if (!hasDay) dates.push(day);
    dates = _prune(dates, day);
    _mem[key] = dates;
    _saveLocalStorage();
    _idbPut(key, dates);
    return dates.length;
  }

  function getOccurrenceCount(customerId, category, productId, asOf) {
    var key = _makeKey(customerId, category, productId);
    var day = _dateOnly(asOf || _today());
    var dates = _mem[key] ? _mem[key].slice() : [];
    dates = _prune(dates, day);
    return dates.length;
  }

  function statusFromCount(count) {
    return (count >= PERSISTENCE_PARAMS.minOccurrences) ? 'active' : 'pending';
  }

  /* Immediate / state-event categories: a single occurrence is already
     meaningful and actionable. These skip the 2-in-60d gate and become
     active on first detection. Behavioral trend signals still require
     persistence confirmation. */
  var IMMEDIATE_CATEGORIES = {
    CHECK_BOUNCED: true,
    PAYMENT_OVERDUE: true,
    VISIT_OVERDUE: true,
    LONG_NO_VISIT: true,
    VISIT_CONVERSION_LOW: true
  };

  function _isImmediateCategory(category) {
    return !!(category && IMMEDIATE_CATEGORIES[category]);
  }

  /**
   * Apply persistence to a signal array in place.
   * - Immediate categories → status 'active' on first occurrence
   * - Behavioral categories → pending until minOccurrences inside window
   * - Records today's occurrence for history (1 per day per key)
   * - Never removes signals from the array
   * Returns the same array.
   */
  function applyPersistence(signals, ctx) {
    if (!signals || !signals.length) return signals || [];
    // v117: the context reference date (when a context is given) is the day of this evaluation
    var today = (ctx && typeof analysisToday === 'function') ? analysisToday(ctx) : _today();
    for (var i = 0; i < signals.length; i++) {
      var s = signals[i];
      if (!s || !s.category || !s.customerId) {
        if (s && s.status == null) s.status = 'pending';
        continue;
      }
      // Occurrence identity is Family-aware: familyId (runtime property set by
      // Family-level Intelligence) || productId. For products without an
      // analysisGroupId familyId === productId, so the key is identical to
      // the legacy key. familyId is only part of the in-memory/LS/IDB KEY
      // string — it is never added as a field on the stored record.
      var pid = (s.familyId != null && s.familyId !== '')
        ? s.familyId
        : (s.productId != null ? s.productId : null);
      var ts = s.detectedAt || today;
      var existingCount = getOccurrenceCount(s.customerId, s.category, pid, today);
      var count = (s.category === 'CONSECUTIVE_NO_ORDER' && existingCount >= PERSISTENCE_PARAMS.minOccurrences)
        ? existingCount
        : recordOccurrence(s.customerId, s.category, pid, ts);
      if (_isImmediateCategory(s.category)) {
        s.status = 'active';
        s.occurrenceCount = count;
      } else {
        s.status = statusFromCount(count);
        s.occurrenceCount = count;
      }
    }
    return signals;
  }

  function clearIntelligencePersistence() {
    _mem = Object.create(null);
    try {
      if (typeof localStorage !== 'undefined' && localStorage) {
        localStorage.removeItem(PERSISTENCE_PARAMS.lsKey);
      }
    } catch (e) { /* ignore */ }
    if (_idb) {
      try {
        var tx = _idb.transaction(PERSISTENCE_PARAMS.idbStore, 'readwrite');
        tx.objectStore(PERSISTENCE_PARAMS.idbStore).clear();
      } catch (e2) { /* ignore */ }
    }
  }

  // Test helper: seed occurrences without going through signals
  function _seedOccurrences(customerId, category, productId, dateList) {
    var key = _makeKey(customerId, category, productId);
    _mem[key] = (dateList || []).map(_dateOnly);
    _saveLocalStorage();
    _idbPut(key, _mem[key]);
  }

  global.applyPersistence = applyPersistence;
  global.replaceAllOccurrences = replaceAllOccurrences;
  global._persistenceExportRows = _currentRows;   // test seam
  global.getOccurrenceCount = getOccurrenceCount;
  global.clearIntelligencePersistence = clearIntelligencePersistence;
  global.PERSISTENCE_PARAMS = PERSISTENCE_PARAMS;
  // internal test seam
  global._intelligencePersistenceSeed = _seedOccurrences;
  global._intelligencePersistenceMem = function () { return _mem; };
  global._intelligenceColdKeySweep = _sweepColdKeys;

})(typeof window !== 'undefined' ? window : this);
