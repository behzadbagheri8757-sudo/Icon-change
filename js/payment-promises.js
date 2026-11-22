/* js/payment-promises.js — «وعدهٔ پرداخت» (oral payment promise): model, rules, mutations.
 *
 * A promise is a COMMITMENT, not money. Nothing here touches payments, invoices,
 * FIFO allocation or customerTotals. The only link to real money is keep(): it is
 * called inside the SAME save as a real payment (see openAddTransaction), so a
 * promise can never become «kept» without a payment record.
 *
 * Rules
 *  - One active (pending) promise per customer. A new one supersedes the old one.
 *    EXCEPTION: one-off customers («متفرقه», several different people under one account) may hold
 *    several pending promises at once — nothing is superseded, and nothing is auto-linked to a payment.
 *  - amount 0 = «مبلغ مشخص نیست» (shown as «کل بدهی»).
 *  - promiseDate >= today at creation.
 *  - pending -> kept   : only via keep() together with a real payment
 *  - pending -> broken : only when promiseDate < today (explicit user action)
 *  - pending -> kept   : also via dismiss() = «بستن بدون پرداخت» (payment was recorded separately);
 *                        keptAmount stays null = «no payment linked to this promise»
 *  - pending -> superseded : automatically when a new promise is added
 *  - any -> deleted     : remove()
 *
 * Pure functions take `src` (defaults to global `data`) and `today` (defaults to todayISO()).
 */
'use strict';

(function (global) {
  var ISO = /^\d{4}-\d{2}-\d{2}$/;

  function _src(src) { return src || (typeof data !== 'undefined' ? data : {}); }  // `data` is a script-scope `let` (models.js), not a window property
  function _today(t) { return t || todayISO(); }
  function _fa(n) { return typeof enToFaDigits === 'function' ? enToFaDigits(String(n)) : String(n); }

  function isIso(s) { return typeof s === 'string' && ISO.test(s); }
  function _dayNumber(iso) {
    var p = iso.split('-');
    return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000);
  }
  /** whole days from `fromIso` to `toIso` (positive when `toIso` is later). DST-proof. */
  function dayDiff(fromIso, toIso) { return _dayNumber(toIso) - _dayNumber(fromIso); }
  function addDays(iso, n) { return new Date((_dayNumber(iso) + n) * 86400000).toISOString().slice(0, 10); }

  function all(src) {
    var s = _src(src);
    return Array.isArray(s.paymentPromises) ? s.paymentPromises : [];
  }
  function forCustomer(cid, src) {
    return all(src).filter(function (p) { return p && p.customerId === cid; });
  }
  function _oneOff(cid, src) {
    var c = (_src(src).customers || []).find(function (x) { return x && x.id === cid; });
    return !!(c && c.oneOff);
  }
  /** All pending promises of a customer, earliest first (several only for one-off customers). */
  function pendingFor(cid, src) {
    return forCustomer(cid, src).filter(function (p) { return p.status === 'pending' && isIso(p.promiseDate); })
      .sort(function (a, b) { return a.promiseDate < b.promiseDate ? -1 : a.promiseDate > b.promiseDate ? 1 : 0; });
  }
  /** The customer's current pending promise (most urgent if data ever holds several). */
  function active(cid, src) {
    var best = null;
    forCustomer(cid, src).forEach(function (p) {
      if (p.status !== 'pending' || !isIso(p.promiseDate)) return;
      if (!best || p.promiseDate < best.promiseDate) best = p;
    });
    return best;
  }
  function byId(id, src) {
    return all(src).find(function (p) { return p && p.id === id; }) || null;
  }

  /** kind: upcoming | today | overdue | kept | broken | superseded ; days = distance from today */
  function phase(p, today) {
    if (p.status !== 'pending') return { kind: p.status, days: 0 };
    var d = dayDiff(_today(today), p.promiseDate);
    if (d > 0) return { kind: 'upcoming', days: d };
    if (d === 0) return { kind: 'today', days: 0 };
    return { kind: 'overdue', days: -d };
  }

  /** {text, tone} — tone: primary | warning | danger | success | neutral | muted */
  function badge(p, today) {
    var ph = phase(p, today);
    switch (ph.kind) {
      case 'upcoming': return { text: ph.days === 1 ? 'فردا' : _fa(ph.days) + ' روز مانده', tone: 'primary' };
      case 'today': return { text: 'امروز', tone: 'warning' };
      case 'overdue': return { text: _fa(ph.days) + ' روز از موعد', tone: 'danger' };
      case 'kept': return { text: 'انجام شد', tone: 'success' };
      case 'broken': return { text: 'انجام نشد', tone: 'neutral' };
      default: return { text: 'جایگزین شد', tone: 'muted' };
    }
  }

  function amountLabel(p) {
    return p && p.amount > 0 ? toman(p.amount) + ' ت' : 'کل بدهی';
  }

  /** Pending promises whose date is today or earlier, most overdue first. */
  function dueList(src, today) {
    var t = _today(today);
    return all(src).filter(function (p) {
      return p && p.status === 'pending' && isIso(p.promiseDate) && p.promiseDate <= t;
    }).sort(function (a, b) { return a.promiseDate < b.promiseDate ? -1 : a.promiseDate > b.promiseDate ? 1 : 0; });
  }
  function pendingList(src) {
    return all(src).filter(function (p) { return p && p.status === 'pending' && isIso(p.promiseDate); })
      .sort(function (a, b) { return a.promiseDate < b.promiseDate ? -1 : a.promiseDate > b.promiseDate ? 1 : 0; });
  }

  /* ---------------- mutations (synchronous, on a data object; no I/O) ---------------- */

  /** @returns {{ok:boolean, error?:string, promise?:object}} */
  function add(src, cid, input, today) {
    var s = _src(src);
    var t = _today(today);
    input = input || {};
    if (!(s.customers || []).some(function (c) { return c && c.id === cid; })) return { ok: false, error: 'مشتری پیدا نشد' };
    if (!isIso(input.promiseDate)) return { ok: false, error: 'تاریخ وعده نامعتبر است' };
    if (input.promiseDate < t) return { ok: false, error: 'تاریخ وعده نمی‌تواند قبل از امروز باشد' };
    var amount = input.amount == null || input.amount === '' ? 0 : Number(input.amount);
    if (!Number.isFinite(amount) || amount < 0) return { ok: false, error: 'مبلغ نامعتبر است' };
    s.paymentPromises = Array.isArray(s.paymentPromises) ? s.paymentPromises : [];
    // one active promise per customer: the new one replaces the old one (not for one-off customers)
    if (!_oneOff(cid, s)) {
      s.paymentPromises.forEach(function (p) {
        if (p.customerId === cid && p.status === 'pending') p.status = 'superseded';
      });
    } else if (input.replaces) {
      // one-off: «تمدید» replaces exactly the promise being extended, nobody else's
      s.paymentPromises.forEach(function (p) {
        if (p.id === input.replaces && p.customerId === cid && p.status === 'pending') p.status = 'superseded';
      });
    }
    var promise = {
      id: uid(), customerId: cid, date: t, promiseDate: input.promiseDate,
      amount: amount, note: String(input.note || '').trim(), status: 'pending',
      keptAmount: null, keptAt: null, createdAt: new Date().toISOString(),
    };
    s.paymentPromises.push(promise);
    return { ok: true, promise: promise };
  }

  /** pending -> kept. Must be called together with the real payment's save. */
  function keep(src, id, payment) {
    var p = byId(id, src);
    if (!p || p.status !== 'pending') return { ok: false, error: 'وعده در انتظار نیست' };
    if (!payment || !(Number(payment.amount) > 0) || payment.customerId !== p.customerId) return { ok: false, error: 'پرداخت معتبر نیست' };
    p.status = 'kept';
    p.keptAmount = Number(payment.amount);
    p.keptAt = new Date().toISOString();
    return { ok: true, promise: p };
  }

  function markBroken(src, id, today) {
    var p = byId(id, src);
    if (!p || p.status !== 'pending') return { ok: false, error: 'وعده در انتظار نیست' };
    if (!(p.promiseDate < _today(today))) return { ok: false, error: 'هنوز موعد وعده نرسیده' };
    p.status = 'broken';
    return { ok: true, promise: p };
  }

  /**
   * Close a promise without linking a payment (the payment was already recorded through the normal
   * flow, or the toggle was off). Status becomes «kept», keptAmount stays null (= nothing linked),
   * so history can tell it apart from a promise closed by an actual payment. Touches no money.
   */
  function dismiss(src, id) {
    var p = byId(id, src);
    if (!p || p.status !== 'pending') return { ok: false, error: 'وعده در انتظار نیست' };
    p.status = 'kept';
    p.keptAmount = null;
    p.keptAt = new Date().toISOString();
    return { ok: true, promise: p };
  }

  function remove(src, id) {
    var s = _src(src);
    var before = all(s).length;
    s.paymentPromises = all(s).filter(function (p) { return p.id !== id; });
    return { ok: s.paymentPromises.length < before };
  }

  /* ---------------- persistence wrapper (same snapshot/rollback pattern as the rest of the app) ---------------- */
  async function commit(mutator) {
    var previous = JSON.parse(JSON.stringify(data));
    try {
      var res = mutator(data);
      if (!res || !res.ok) return res || { ok: false };
      await saveData();
      return res;
    } catch (err) {
      restoreDataInPlace(previous);
      throw err;
    }
  }

  global.PaymentPromises = {
    isIso: isIso, dayDiff: dayDiff, addDays: addDays,
    all: all, forCustomer: forCustomer, active: active, pendingFor: pendingFor, byId: byId,
    phase: phase, badge: badge, amountLabel: amountLabel, dueList: dueList, pendingList: pendingList,
    add: add, keep: keep, markBroken: markBroken, dismiss: dismiss, remove: remove, commit: commit,
  };
})(typeof window !== 'undefined' ? window : this);
