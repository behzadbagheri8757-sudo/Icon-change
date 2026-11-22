/* js/delivery-promises.js — «قول تحویل» (oral delivery promise): model, rules, mutations, loading summary.
 *
 * «فردا نخود و عدس بیار» / «۳ روز دیگه بیار». A promise is a COMMITMENT, not a sale: it never touches
 * stock, invoices or balances. The only bridge to real data is complete(): called inside the SAME save
 * as the real invoice (see openInvoiceForm), so a promise can never become «done» without an invoice
 * — except the explicit, user-confirmed closeManually().
 *
 * Rules
 *  - Many pending promises per customer are fine (different days / different goods).
 *  - deliveryDate >= today at creation / reschedule.
 *  - items: [{productId, name(snapshot), qty}]; qty 0 = «مقدار مشخص نیست».
 *    At least one item or a note is required.
 *  - pending -> done      : complete() with an invoice, autoCompleteForInvoice(), or closeManually()
 *  - pending -> cancelled : cancel()
 *  - any -> deleted       : remove()
 *  - Auto-complete rule (not for one-off customers): a new invoice completes a pending promise of the same customer when it contains
 *    EVERY promised product with qty > 0 (quantities are not compared). Note-only promises never auto-complete.
 *
 * Pure functions take `src` (defaults to global `data`) and `today` (defaults to todayISO()).
 */
'use strict';

(function (global) {
  var PP = global.PaymentPromises; // reuse the date helpers (isIso / dayDiff / addDays)

  function _src(src) { return src || (typeof data !== 'undefined' ? data : {}); }   // `data` is a script-scope `let`
  function _today(t) { return t || todayISO(); }
  function _fa(n) { return typeof enToFaDigits === 'function' ? enToFaDigits(String(n)) : String(n); }

  function all(src) { var s = _src(src); return Array.isArray(s.deliveryPromises) ? s.deliveryPromises : []; }
  function byId(id, src) { return all(src).find(function (p) { return p && p.id === id; }) || null; }
  function forCustomer(cid, src) { return all(src).filter(function (p) { return p && p.customerId === cid; }); }
  function _byDate(a, b) { return a.deliveryDate < b.deliveryDate ? -1 : a.deliveryDate > b.deliveryDate ? 1 : 0; }
  function pending(cid, src) {
    return forCustomer(cid, src).filter(function (p) { return p.status === 'pending' && PP.isIso(p.deliveryDate); }).sort(_byDate);
  }
  function pendingAll(src) {
    return all(src).filter(function (p) { return p && p.status === 'pending' && PP.isIso(p.deliveryDate); }).sort(_byDate);
  }

  /** kind: overdue | today | tomorrow | upcoming | done | cancelled ; days = distance from today */
  function phase(p, today) {
    if (p.status !== 'pending') return { kind: p.status, days: 0 };
    var d = PP.dayDiff(_today(today), p.deliveryDate);
    if (d < 0) return { kind: 'overdue', days: -d };
    if (d === 0) return { kind: 'today', days: 0 };
    if (d === 1) return { kind: 'tomorrow', days: 1 };
    return { kind: 'upcoming', days: d };
  }

  /** {text, tone} — tone: primary | warning | danger | success | neutral */
  function badge(p, today) {
    var ph = phase(p, today);
    switch (ph.kind) {
      case 'overdue': return { text: _fa(ph.days) + ' روز تأخیر', tone: 'danger' };
      case 'today': return { text: 'امروز', tone: 'warning' };
      case 'tomorrow': return { text: 'فردا', tone: 'primary' };
      case 'upcoming': return { text: _fa(ph.days) + ' روز دیگر', tone: 'primary' };
      case 'done': return { text: 'تحویل شد', tone: 'success' };
      default: return { text: 'لغو شد', tone: 'neutral' };
    }
  }

  function _qty(n) { return _fa(fmtQtyDisplay(n)); }
  /** «نخود ۲ · عدس» — product names come from the snapshot (a product may be renamed/deleted later). */
  function itemsLabel(p) {
    var parts = (p.items || []).map(function (it) {
      return (it.name || '—') + (it.qty > 0 ? ' ' + _qty(it.qty) : '');
    });
    if (!parts.length) return p.note ? p.note : '—';
    return parts.join(' · ');
  }

  /** pending with deliveryDate <= today + horizon (default: tomorrow), earliest first. */
  function dueList(src, today, horizon) {
    var limit = PP.addDays(_today(today), horizon == null ? 1 : horizon);
    return pendingAll(src).filter(function (p) { return p.deliveryDate <= limit; });
  }

  /**
   * Loading summary: total per product over pending promises with deliveryDate in the window
   * (fromDate = null means «everything up to toDate», so overdue goods are included).
   * @returns [{productId, name, qty, unknown(bool: some promise had no quantity), stock, short(bool), customers:[names]}]
   */
  function loadSummary(src, toDate, fromDate) {
    var s = _src(src), map = {}, order = [];
    pendingAll(s).forEach(function (p) {
      if (p.deliveryDate > toDate || (fromDate && p.deliveryDate < fromDate)) return;
      var cust = (s.customers || []).find(function (c) { return c && c.id === p.customerId; });
      (p.items || []).forEach(function (it) {
        var row = map[it.productId];
        if (!row) {
          var prod = (s.products || []).find(function (x) { return x && x.id === it.productId; });
          row = map[it.productId] = {
            productId: it.productId, name: (prod && prod.name) || it.name || '—', qty: 0, unknown: false,
            stock: prod ? (Number(prod.stockQty) || 0) : null, short: false, customers: [],
          };
          order.push(it.productId);
        }
        if (it.qty > 0) row.qty += it.qty; else row.unknown = true;
        var nm = cust ? (cust.name || '—') : '—';
        if (row.customers.indexOf(nm) < 0) row.customers.push(nm);
      });
    });
    return order.map(function (id) {
      var r = map[id];
      r.short = r.stock != null && r.qty > r.stock;
      return r;
    }).sort(function (a, b) { return (b.qty - a.qty) || String(a.name).localeCompare(String(b.name)); });
  }

  /* ---------------- mutations (synchronous, on a data object; no I/O) ---------------- */

  function _cleanItems(s, items) {
    var seen = {}, out = [];
    (items || []).forEach(function (it) {
      if (!it || !it.productId || seen[it.productId]) return;
      var prod = (s.products || []).find(function (x) { return x && x.id === it.productId; });
      if (!prod) return;
      var q = it.qty == null || it.qty === '' ? 0 : Number(it.qty);
      if (!Number.isFinite(q) || q < 0) q = NaN;
      seen[it.productId] = true;
      out.push({ productId: it.productId, name: prod.name || '', qty: q });
    });
    return out;
  }

  /** @returns {{ok:boolean, error?:string, promise?:object}} */
  function add(src, cid, input, today) {
    var s = _src(src), t = _today(today);
    input = input || {};
    if (!(s.customers || []).some(function (c) { return c && c.id === cid; })) return { ok: false, error: 'مشتری پیدا نشد' };
    if (!PP.isIso(input.deliveryDate)) return { ok: false, error: 'تاریخ تحویل نامعتبر است' };
    if (input.deliveryDate < t) return { ok: false, error: 'تاریخ تحویل نمی‌تواند قبل از امروز باشد' };
    var items = _cleanItems(s, input.items);
    if (items.some(function (it) { return Number.isNaN(it.qty); })) return { ok: false, error: 'مقدار نامعتبر است' };
    var note = String(input.note || '').trim();
    if (!items.length && !note) return { ok: false, error: 'حداقل یک کالا یا یادداشت لازم است' };
    s.deliveryPromises = Array.isArray(s.deliveryPromises) ? s.deliveryPromises : [];
    var promise = {
      id: uid(), customerId: cid, date: t, deliveryDate: input.deliveryDate, items: items, note: note,
      status: 'pending', doneAt: null, invoiceId: null, createdAt: new Date().toISOString(),
    };
    s.deliveryPromises.push(promise);
    return { ok: true, promise: promise };
  }

  function reschedule(src, id, newDate, today) {
    var p = byId(id, src);
    if (!p || p.status !== 'pending') return { ok: false, error: 'قول در انتظار نیست' };
    if (!PP.isIso(newDate)) return { ok: false, error: 'تاریخ نامعتبر است' };
    if (newDate < _today(today)) return { ok: false, error: 'تاریخ تحویل نمی‌تواند قبل از امروز باشد' };
    p.deliveryDate = newDate;
    return { ok: true, promise: p };
  }

  function cancel(src, id) {
    var p = byId(id, src);
    if (!p || p.status !== 'pending') return { ok: false, error: 'قول در انتظار نیست' };
    p.status = 'cancelled';
    return { ok: true, promise: p };
  }

  /** pending -> done together with the real invoice's save. */
  function complete(src, id, invoice) {
    var p = byId(id, src);
    if (!p || p.status !== 'pending') return { ok: false, error: 'قول در انتظار نیست' };
    if (!invoice || !invoice.id || invoice.customerId !== p.customerId) return { ok: false, error: 'فاکتور معتبر نیست' };
    p.status = 'done';
    p.invoiceId = invoice.id;
    p.doneAt = new Date().toISOString();
    return { ok: true, promise: p };
  }

  /** Close without an invoice (goods were handed over some other way). invoiceId stays null. */
  function closeManually(src, id) {
    var p = byId(id, src);
    if (!p || p.status !== 'pending') return { ok: false, error: 'قول در انتظار نیست' };
    p.status = 'done';
    p.doneAt = new Date().toISOString();
    return { ok: true, promise: p };
  }

  /** A newly created invoice completes the customer's pending promises it fully covers (see header). */
  function autoCompleteForInvoice(src, invoice) {
    var done = [];
    if (!invoice || !invoice.id) return done;
    // one-off customers: an invoice may belong to a different person than the promise → explicit only
    var cu = (_src(src).customers || []).find(function (x) { return x && x.id === invoice.customerId; });
    if (cu && cu.oneOff) return done;
    var have = {};
    (invoice.items || []).forEach(function (it) { if (it && it.productId && Number(it.qty) > 0) have[it.productId] = true; });
    pending(invoice.customerId, src).forEach(function (p) {
      if (!p.items.length) return;
      if (p.items.every(function (it) { return have[it.productId]; })) {
        if (complete(src, p.id, invoice).ok) done.push(p);
      }
    });
    return done;
  }

  function remove(src, id) {
    var s = _src(src), before = all(s).length;
    s.deliveryPromises = all(s).filter(function (p) { return p.id !== id; });
    return { ok: s.deliveryPromises.length < before };
  }

  /** Same snapshot/rollback wrapper as PaymentPromises.commit. */
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

  global.DeliveryPromises = {
    all: all, byId: byId, forCustomer: forCustomer, pending: pending, pendingAll: pendingAll,
    phase: phase, badge: badge, itemsLabel: itemsLabel, dueList: dueList, loadSummary: loadSummary,
    add: add, reschedule: reschedule, cancel: cancel, complete: complete, closeManually: closeManually,
    autoCompleteForInvoice: autoCompleteForInvoice, remove: remove, commit: commit,
  };
})(typeof window !== 'undefined' ? window : this);
