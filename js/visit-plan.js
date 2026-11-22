/* js/visit-plan.js — «ویزیت بعدی»: reminders DERIVED from the visits the app already stores.
 *
 * No new array, no new status: the plan is the optional `nextVisitDate` of a customer's LATEST visit.
 * (The visit form used to save it only for «فروشگاه بسته بود» and nothing ever read it.)
 *
 * A plan is open while ALL of these hold:
 *  - the customer is active;
 *  - the latest visit (by date, then time) has a valid `nextVisitDate` and is not `nextVisitSkipped`;
 *  - the customer has no invoice dated AFTER that visit (an invoice = the customer was served again,
 *    even if the visit itself was never logged). Same-day invoices (made during the visit) don't count.
 *
 * Because the plan lives on the latest visit, logging any newer visit replaces/clears it automatically —
 * a plan can never become a zombie. The only mutations are reschedule() and skip(), both on that visit.
 */
'use strict';

(function (global) {
  var PP = global.PaymentPromises; // date helpers

  function _src(src) { return src || (typeof data !== 'undefined' ? data : {}); }
  function _today(t) { return t || todayISO(); }
  function _fa(n) { return typeof enToFaDigits === 'function' ? enToFaDigits(String(n)) : String(n); }
  function _day(s) { return String(s || '').slice(0, 10); }

  function latestVisit(c) {
    var best = null, bestKey = '';
    (c && c.visits || []).forEach(function (v) {
      if (!v) return;
      var key = _day(v.date) + ' ' + String(v.time || '');
      if (!best || key >= bestKey) { best = v; bestKey = key; }
    });
    return best;
  }

  /** The open plan of one customer, or null. @returns {{customerId, visitId, visitDate, date, reason}|null} */
  function forCustomer(cid, src) {
    var s = _src(src);
    var c = (s.customers || []).find(function (x) { return x && x.id === cid; });
    if (!c || c.active === false || c.oneOff) return null;   // one-off customers have no revisit plan
    var v = latestVisit(c);
    if (!v || !PP.isIso(v.nextVisitDate) || v.nextVisitSkipped) return null;
    var vd = _day(v.date);
    var served = (s.invoices || []).some(function (i) { return i && i.customerId === cid && _day(i.date) > vd; });
    if (served) return null;
    return {
      customerId: cid, visitId: v.id, visitDate: vd, date: v.nextVisitDate,
      reason: v.nextAction || (v.kind === 'closed' ? 'فروشگاه بسته بود' : ''),
    };
  }

  function all(src) {
    var s = _src(src), out = [];
    (s.customers || []).forEach(function (c) { var p = c && forCustomer(c.id, s); if (p) out.push(p); });
    return out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  }

  /** kind: overdue | today | tomorrow | upcoming */
  function phase(plan, today) {
    var d = PP.dayDiff(_today(today), plan.date);
    if (d < 0) return { kind: 'overdue', days: -d };
    if (d === 0) return { kind: 'today', days: 0 };
    if (d === 1) return { kind: 'tomorrow', days: 1 };
    return { kind: 'upcoming', days: d };
  }
  function badge(plan, today) {
    var ph = phase(plan, today);
    switch (ph.kind) {
      case 'overdue': return { text: _fa(ph.days) + ' روز تأخیر', tone: 'danger' };
      case 'today': return { text: 'امروز', tone: 'warning' };
      case 'tomorrow': return { text: 'فردا', tone: 'primary' };
      default: return { text: _fa(ph.days) + ' روز دیگر', tone: 'primary' };
    }
  }

  /** Plans due by today (+horizon days), most overdue first. */
  function dueList(src, today, horizon) {
    var limit = PP.addDays(_today(today), horizon == null ? 0 : horizon);
    return all(src).filter(function (p) { return p.date <= limit; });
  }

  /* ---------------- mutations (on the plan's visit; synchronous, no I/O) ---------------- */

  function _visitOf(src, cid) {
    var s = _src(src), plan = forCustomer(cid, s);
    if (!plan) return null;
    var c = s.customers.find(function (x) { return x.id === cid; });
    return (c.visits || []).find(function (v) { return v.id === plan.visitId; }) || null;
  }

  function reschedule(src, cid, newDate, today) {
    var v = _visitOf(src, cid);
    if (!v) return { ok: false, error: 'ویزیت برنامه‌ریزی‌شده‌ای نیست' };
    if (!PP.isIso(newDate)) return { ok: false, error: 'تاریخ نامعتبر است' };
    if (newDate < _today(today)) return { ok: false, error: 'تاریخ نمی‌تواند قبل از امروز باشد' };
    v.nextVisitDate = newDate;
    return { ok: true };
  }

  /** «لغو»: the visit keeps its date for history; the plan just stops being a reminder. */
  function skip(src, cid) {
    var v = _visitOf(src, cid);
    if (!v) return { ok: false, error: 'ویزیت برنامه‌ریزی‌شده‌ای نیست' };
    v.nextVisitSkipped = true;
    return { ok: true };
  }

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

  global.VisitPlan = {
    latestVisit: latestVisit, forCustomer: forCustomer, all: all, phase: phase, badge: badge, dueList: dueList,
    reschedule: reschedule, skip: skip, commit: commit,
  };
})(typeof window !== 'undefined' ? window : this);
