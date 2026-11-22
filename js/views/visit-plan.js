/* js/views/visit-plan.js — UI for «ویزیت بعدی» (derived reminders, see js/visit-plan.js).
   Entry points:
     VisitPlanUI.cardHtml(cid) / bind(root, cid)        → customer page card (تغییر تاریخ / لغو)
     VisitPlanUI.dashboardHtml() / bindDashboard(root)  → dashboard block: due today / overdue, 1-tap «ثبت ویزیت»
     VisitPlanUI.openListSheet()                        → every planned visit (overdue → later)
*/
'use strict';

(function (global) {
  var VP = global.VisitPlan;
  var PP = global.PaymentPromises;

  function customerName(cid) {
    var c = (data.customers || []).find(function (x) { return x && x.id === cid; });
    return c ? (c.name || '—') : '—';
  }
  function fa(n) { return enToFaDigits(String(n)); }
  function afterChange() { if (typeof render === 'function') render(); }
  function badgeHtml(plan) {
    var b = VP.badge(plan);
    return '<span class="pp-badge pp-' + b.tone + '">' + esc(b.text) + '</span>';
  }
  function reasonOf(plan) { return plan.reason || 'مراجعه'; }

  /* ---------- customer page ---------- */

  function cardHtml(cid) {
    var plan = VP.forCustomer(cid);
    if (!plan) return '';
    return '<div class="card pp-card pp-card-' + VP.badge(plan).tone + '">' +
      '<div class="pp-card-main">' +
        '<span class="pp-card-head"><span class="pp-card-title">ویزیت بعدی</span>' + badgeHtml(plan) + '</span>' +
        '<span class="pp-card-amount">' + esc(reasonOf(plan)) + '</span>' +
        '<span class="pp-card-sub">' + esc(faDate(plan.date)) + '</span>' +
      '</div>' +
      '<div class="btn-row pp-card-actions">' +
        '<button type="button" class="btn small secondary" data-vp-reschedule="' + esc(cid) + '">تغییر تاریخ</button>' +
        '<button type="button" class="btn small secondary danger" data-vp-skip="' + esc(cid) + '">لغو</button>' +
      '</div></div>';
  }

  function reschedule(cid) {
    var plan = VP.forCustomer(cid);
    if (!plan || typeof DeliveryUI === 'undefined') return;
    DeliveryUI.openDateSheet('تغییر تاریخ ویزیت بعدی', 'ویزیت بعدی', plan.date, function (iso) {
      return VP.commit(function (d) { return VP.reschedule(d, cid, iso); });
    });
  }

  async function skip(cid) {
    if (!(await appConfirm('یادآوری ویزیت بعدی لغو شود؟', 'لغو'))) return;
    var res = await VP.commit(function (d) { return VP.skip(d, cid); });
    if (res && res.ok) afterChange();
  }

  function bind(root, cid) {
    if (!root) return;
    root.querySelectorAll('[data-vp-reschedule]').forEach(function (b) { b.onclick = function () { reschedule(b.getAttribute('data-vp-reschedule')); }; });
    root.querySelectorAll('[data-vp-skip]').forEach(function (b) { b.onclick = function () { skip(b.getAttribute('data-vp-skip')); }; });
  }

  /* ---------- dashboard ---------- */

  var DASH_MAX_ROWS = 5;

  function dashRow(plan) {
    var late = VP.phase(plan).kind === 'overdue';
    return '<div class="pp-dash-row">' +
      '<a class="pp-dash-who" href="#/customer?id=' + encodeURIComponent(plan.customerId) + '">' +
        '<strong>' + esc(customerName(plan.customerId)) + '</strong>' +
        '<small>' + esc(reasonOf(plan)) + (late ? ' · <span class="pp-dash-late">' + esc(VP.badge(plan).text) + '</span>' : '') + '</small>' +
      '</a>' +
      '<button type="button" class="pp-receive" data-vp-visit-quick="' + esc(plan.customerId) + '">ثبت ویزیت</button>' +
    '</div>';
  }

  /** One calm card: عقب‌افتاده / امروز. '' when no planned visit is due. */
  function dashboardHtml(opts) {
    var due = VP.dueList();
    if (!due.length) return '';
    var shown = due.slice(0, opts && opts.all ? due.length : DASH_MAX_ROWS);
    var groups = [
      { title: 'عقب‌افتاده', tone: 'danger', kind: 'overdue' },
      { title: 'امروز', tone: 'warning', kind: 'today' },
    ];
    var body = groups.map(function (g) {
      var list = shown.filter(function (p) { return VP.phase(p).kind === g.kind; });
      if (!list.length) return '';
      return '<div class="pp-dash-group pp-dash-' + g.tone + '">' + g.title + '<span>' + fa(list.length) + '</span></div>' + list.map(dashRow).join('');
    }).join('');
    return '<div class="dashboard-block pp-dash">' +
      '<div class="dashboard-block-head"><div class="dash-section-label"><span>ویزیت‌های برنامه‌ریزی‌شده</span></div>' +
        '<button type="button" class="section-action" data-vp-open-all>همه</button></div>' +
      '<div class="pp-dash-card">' + body + '</div></div>';
  }

  function openListSheet() {
    var g = { overdue: [], today: [], tomorrow: [], upcoming: [] };
    VP.all().forEach(function (p) { g[VP.phase(p).kind].push(p); });
    function section(title, list) {
      if (!list.length) return '';
      return '<div class="pp-section-title">' + title + ' (' + fa(list.length) + ')</div><div class="pp-list">' +
        list.map(function (p) {
          return '<a class="pp-row" data-vp-list-row href="#/customer?id=' + encodeURIComponent(p.customerId) + '"><span class="pp-row-main"><strong>' +
            esc(customerName(p.customerId)) + '</strong><small>' + esc(reasonOf(p)) + ' · ' + esc(faDate(p.date)) + '</small></span>' + badgeHtml(p) + '</a>';
        }).join('') + '</div>';
    }
    var body = section('عقب‌افتاده', g.overdue) + section('امروز', g.today) + section('فردا', g.tomorrow) + section('بعداً', g.upcoming);
    openSheet('<h3>ویزیت‌های برنامه‌ریزی‌شده</h3>' + (body || '<div class="empty">ویزیت بعدی ثبت نشده است. هنگام ثبت ویزیت، «ویزیت بعدی» را انتخاب کن.</div>'));
    document.querySelectorAll('[data-vp-list-row]').forEach(function (a) { a.addEventListener('click', function () { closeModal(); }); });
  }

  function bindDashboard(root) {
    if (!root) return;
    root.querySelectorAll('[data-vp-visit-quick]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.preventDefault();
        if (typeof openAddVisit === 'function') openAddVisit(b.getAttribute('data-vp-visit-quick'));
      });
    });
    var all = root.querySelector('[data-vp-open-all]'); if (all) all.addEventListener('click', openListSheet);
  }

  global.VisitPlanUI = {
    cardHtml: cardHtml, bind: bind, dashboardHtml: dashboardHtml, bindDashboard: bindDashboard, openListSheet: openListSheet,
  };
})(typeof window !== 'undefined' ? window : this);
