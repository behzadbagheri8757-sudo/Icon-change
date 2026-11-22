/* js/views/payment-promises.js — UI for «وعدهٔ پرداخت». Presentation only:
   all rules/mutations live in js/payment-promises.js (PaymentPromises).
   Entry points (called from customer.js / dashboard.js):
     PromiseUI.cardHtml(cid, balance)   → the one slot under the top alert (active promise OR «ثبت وعده»)
     PromiseUI.historyHtml(cid)         → collapsed history of closed promises
     PromiseUI.bind(root, cid)          → wires data-pp-* buttons inside `root`
     PromiseUI.dashboardHtml()          → dashboard block: due/overdue promises with a 1-tap «دریافت شد»
     PromiseUI.bindDashboard(root)
     PromiseUI.openAddSheet(cid, opts)  PromiseUI.openDetailSheet(id, opts)  PromiseUI.openListSheet()
*/
'use strict';

(function (global) {
  var PP = global.PaymentPromises;

  function badgeHtml(p) {
    var b = PP.badge(p);
    return '<span class="pp-badge pp-' + b.tone + '">' + esc(b.text) + '</span>';
  }
  function customerName(cid) {
    var c = (data.customers || []).find(function (x) { return x && x.id === cid; });
    return c ? (c.name || '—') : '—';
  }
  function afterChange() { if (typeof render === 'function') render(); }
  function isOneOff(cid) { return isOneOffCustomer((data.customers || []).find(function (x) { return x && x.id === cid; })); }
  /** One-off customers («متفرقه»): the promise note carries WHO promised, so lists show it. */
  function whoHint(p) { return (p.note && isOneOff(p.customerId)) ? ' · ' + esc(p.note) : ''; }

  /* ---------- customer page ---------- */

  function addButtonHtml(cid) {
    return '<button type="button" class="pp-add-row" data-pp-add="' + esc(cid) + '">' +
      '<span class="pp-add-plus" aria-hidden="true">+</span><span>وعدهٔ پرداخت</span></button>';
  }

  /** One-off customer: several pending promises (one per person) listed in one card. */
  function oneOffCardHtml(cid) {
    var list = PP.pendingFor(cid);
    var rows = list.map(function (p) {
      return '<button type="button" class="pp-row" data-pp-open="' + esc(p.id) + '">' +
        '<span class="pp-row-main"><strong>' + esc(PP.amountLabel(p)) + (p.note ? ' · ' + esc(p.note) : '') + '</strong>' +
        '<small>' + esc(faDate(p.promiseDate)) + '</small></span>' + badgeHtml(p) + '</button>';
    }).join('');
    return '<div class="card pp-card dp-card">' +
      '<div class="dp-card-head"><span class="pp-card-title">وعده‌های پرداخت</span>' +
      '<button type="button" class="pp-link-btn" data-pp-add="' + esc(cid) + '">+ جدید</button></div>' +
      '<div class="dp-card-list">' + rows + '</div></div>';
  }

  function cardHtml(cid, balance) {
    if (isOneOff(cid) && PP.pendingFor(cid).length) return oneOffCardHtml(cid);
    var p = PP.active(cid);
    if (!p) return balance > 0 ? addButtonHtml(cid) : '';
    return '<div class="card pp-card pp-card-' + PP.badge(p).tone + '">' +
      '<button type="button" class="pp-card-main" data-pp-open="' + esc(p.id) + '">' +
        '<span class="pp-card-head"><span class="pp-card-title">وعدهٔ پرداخت</span>' + badgeHtml(p) + '</span>' +
        '<span class="pp-card-amount">' + esc(PP.amountLabel(p)) + '</span>' +
        '<span class="pp-card-sub">' + esc(faDate(p.promiseDate)) + (p.note ? ' · ' + esc(p.note) : '') + '</span>' +
      '</button>' +
      '<div class="btn-row pp-card-actions">' +
        '<button type="button" class="btn small" data-pp-receive="' + esc(p.id) + '">دریافت شد</button>' +
        '<button type="button" class="btn small secondary" data-pp-reschedule="' + esc(p.id) + '">تمدید</button>' +
      '</div></div>';
  }

  function historyHtml(cid) {
    var closed = PP.forCustomer(cid).filter(function (p) { return p.status !== 'pending'; })
      .sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
    if (!closed.length) return '';
    var rows = closed.map(function (p) {
      var kept = p.status !== 'kept' ? '' :
        (p.keptAmount != null ? ' · دریافت: ' + toman(p.keptAmount) + ' ت' : ' · پرداخت جداگانه ثبت شد');
      return '<button type="button" class="pp-row" data-pp-open="' + esc(p.id) + '">' +
        '<span class="pp-row-main"><strong>' + esc(PP.amountLabel(p)) + '</strong>' +
        '<small>' + esc(faDate(p.promiseDate)) + kept + '</small></span>' + badgeHtml(p) + '</button>';
    }).join('');
    return '<section class="cd-history-list"><h3 class="sub-title">تاریخچهٔ وعده‌ها (' +
      enToFaDigits(String(closed.length)) + ')</h3><div class="pp-list">' + rows + '</div></section>';
  }

  function bind(root, cid) {
    if (!root) return;
    root.querySelectorAll('[data-pp-add]').forEach(function (b) { b.onclick = function () { openAddSheet(cid); }; });
    root.querySelectorAll('[data-pp-open]').forEach(function (b) { b.onclick = function () { openDetailSheet(b.getAttribute('data-pp-open')); }; });
    root.querySelectorAll('[data-pp-receive]').forEach(function (b) { b.onclick = function () { receive(b.getAttribute('data-pp-receive')); }; });
    root.querySelectorAll('[data-pp-reschedule]').forEach(function (b) {
      b.onclick = function () { var p = PP.byId(b.getAttribute('data-pp-reschedule')); if (p) openAddSheet(p.customerId, { from: p }); };
    });
  }

  /* ---------- flows ---------- */

  /** «دریافت شد»: opens the normal payment sheet. The promise turns «kept» only when that payment is saved. */
  function receive(id, opts) {
    var p = PP.byId(id);
    if (!p || p.status !== 'pending') return;
    if (typeof closeModal === 'function') closeModal();
    openAddTransaction(p.customerId, { promiseId: p.id, stay: !!(opts && opts.stay) });
  }

  function openAddSheet(cid, opts) {
    opts = opts || {};
    var from = opts.from || null;
    var today = todayISO();
    var t = typeof customerTotals === 'function' ? customerTotals(cid) : null;
    var hint = t && t.balance > 0 ? '<div class="pp-hint">مانده فعلی: ' + toman(t.balance) + ' ت</div>' : '';
    var defDate = PP.addDays(today, 3);
    function chip(label, n) { return '<button type="button" class="chip-opt" data-pp-days="' + n + '">' + label + '</button>'; }
    openSheet(
      '<h3>' + (from ? 'تمدید وعدهٔ پرداخت' : 'وعدهٔ پرداخت') + ' — ' + esc(customerName(cid)) + '</h3>' + hint +
      '<div class="field"><label>مبلغ (تومان) — اختیاری</label>' +
        '<input id="pp-amount" type="text" inputmode="numeric" placeholder="خالی = کل بدهی" autocomplete="off" value="' + (from && from.amount > 0 ? esc(String(from.amount)) : '') + '">' +
        '<div class="pp-amount-echo" id="pp-amount-echo"></div></div>' +
      '<div class="q-block"><div class="q-title">تاریخ وعده</div>' +
        '<div class="chip-wrap">' + chip('امروز', 0) + chip('فردا', 1) + chip('۳ روز دیگر', 3) + chip('هفتهٔ دیگر', 7) + '</div></div>' +
      '<div class="field">' + shamsiDateInputHTML('pp-date', defDate, { mode: 'calendar' }) +
        '<div class="pp-error" id="pp-date-error" hidden>تاریخ وعده نمی‌تواند قبل از امروز باشد</div></div>' +
      '<div class="field"><label>' + (isOneOff(cid) ? 'نام پرداخت‌کننده / یادداشت' : 'یادداشت (اختیاری)') + '</label><input id="pp-note" autocomplete="off" value="' + (from ? esc(from.note || '') : '') + '"></div>' +
      '<div class="btn-row"><button type="button" class="btn" id="pp-save">ثبت</button></div>',
      { dirtyCheck: true }
    );

    var amountEl = document.getElementById('pp-amount');
    var dateEl = document.getElementById('pp-date');
    var errEl = document.getElementById('pp-date-error');
    var saveBtn = document.getElementById('pp-save');
    function amountVal() { var v = parseFloat(faToEnDigits(amountEl.value)); return Number.isFinite(v) ? v : (amountEl.value.trim() === '' ? 0 : NaN); }
    function refresh() {
      var a = amountVal();
      document.getElementById('pp-amount-echo').textContent = a > 0 ? toman(a) + ' تومان' : '';
      var dateOk = PP.isIso(dateEl.value) && dateEl.value >= todayISO();
      errEl.hidden = dateOk;
      saveBtn.disabled = !dateOk || !Number.isFinite(a) || a < 0;
      document.querySelectorAll('[data-pp-days]').forEach(function (c) {
        c.classList.toggle('selected', dateEl.value === PP.addDays(todayISO(), Number(c.getAttribute('data-pp-days'))));
      });
    }
    amountEl.addEventListener('input', refresh);
    dateEl.addEventListener('input', refresh);
    document.querySelectorAll('[data-pp-days]').forEach(function (c) {
      c.addEventListener('click', function () {
        var iso = PP.addDays(todayISO(), Number(c.getAttribute('data-pp-days')));
        dateEl.value = iso;
        var j = isoToJalali(iso);
        var field = dateEl.parentElement && dateEl.parentElement.querySelector('[data-shamsi-field]');
        if (field && j) field.value = enToFaDigits(j[0] + '/' + j[1] + '/' + j[2]);
        var sheetEl = c.closest('.sheet'); if (sheetEl) sheetEl.dataset.dirty = '1';
        refresh();
      });
    });
    refresh();

    saveBtn.addEventListener('click', async function (e) {
      await withSubmitGuard(e.currentTarget, async function () {
        var res = await PP.commit(function (d) {
          return PP.add(d, cid, { amount: amountVal(), promiseDate: dateEl.value, note: document.getElementById('pp-note').value, replaces: from ? from.id : null });
        });
        if (!res || !res.ok) { showToast((res && res.error) || 'ثبت نشد', { type: 'error' }); throw new Error('validation'); }
        closeModal();
        afterChange();
        showToast('وعده ثبت شد');
      });
    });
  }

  /** opts.fromList: opened from the full list → adds «صفحهٔ مشتری» and stays on the current view after receiving. */
  function openDetailSheet(id, opts) {
    opts = opts || {};
    var p = PP.byId(id);
    if (!p) return;
    var ph = PP.phase(p);
    function kv(k, v) { return '<div class="pp-kv"><span>' + k + '</span><strong>' + v + '</strong></div>'; }
    function action(id, label, hint, cls, tag, href) {
      var inner = '<span>' + label + '</span>' + (hint ? '<small>' + hint + '</small>' : '');
      var c = 'pp-action' + (cls ? ' ' + cls : '');
      return tag === 'a'
        ? '<a class="' + c + '" id="' + id + '" href="' + href + '">' + inner + '</a>'
        : '<button type="button" class="' + c + '" id="' + id + '">' + inner + '</button>';
    }
    var primary = '', resolve = '', more = '';
    if (p.status === 'pending') {
      primary = '<button type="button" class="btn" id="pp-d-receive">دریافت شد</button>';
      resolve += action('pp-d-dismiss', 'بستن بدون پرداخت', 'پرداخت را جداگانه ثبت کرده‌ام');
      resolve += action('pp-d-reschedule', 'تمدید / وعدهٔ جدید');
      if (ph.kind === 'overdue') resolve += action('pp-d-broken', 'انجام نشد', '', 'is-danger');
    }
    if (opts.fromList) more += action('pp-d-customer', 'صفحهٔ مشتری', '', '', 'a', '#/customer?id=' + encodeURIComponent(p.customerId));
    more += action('pp-d-delete', 'حذف وعده', '', 'is-danger');
    var actions = primary +
      (resolve ? '<div class="pp-action-list">' + resolve + '</div>' : '') +
      '<div class="pp-action-list">' + more + '</div>';
    openSheet(
      '<h3>وعدهٔ پرداخت ' + badgeHtml(p) + '</h3>' +
      '<div class="pp-detail">' +
        kv('مشتری', esc(customerName(p.customerId))) +
        kv('مبلغ', esc(PP.amountLabel(p))) +
        kv('تاریخ وعده', esc(faDate(p.promiseDate))) +
        kv('ثبت‌شده در', esc(faDate(p.date))) +
        (p.status === 'kept' ? kv(p.keptAmount != null ? 'دریافت‌شده' : 'نحوهٔ بستن', p.keptAmount != null ? toman(p.keptAmount) + ' ت' : 'پرداخت جداگانه ثبت شد') : '') +
        (p.note ? kv('یادداشت', esc(p.note)) : '') +
      '</div><div class="pp-actions">' + actions + '</div>'
    );
    function on(idStr, fn) { var el = document.getElementById(idStr); if (el) el.addEventListener('click', fn); }
    on('pp-d-receive', function () { receive(p.id, { stay: !!opts.fromList }); });
    on('pp-d-dismiss', async function () {
      if (!(await appConfirm('این وعده بسته شود؟ (پرداخت جداگانه ثبت شده است)', 'بستن'))) return;
      var res = await PP.commit(function (d) { return PP.dismiss(d, p.id); });
      if (!res || !res.ok) { showToast((res && res.error) || 'انجام نشد', { type: 'error' }); return; }
      closeModal(); afterChange(); showToast('وعده بسته شد');
    });
    on('pp-d-reschedule', function () { openAddSheet(p.customerId, { from: p }); });
    on('pp-d-customer', function () { closeModal(); });
    on('pp-d-broken', async function () {
      if (!(await appConfirm('این وعده «انجام نشد» ثبت شود؟', 'ثبت'))) return;
      var res = await PP.commit(function (d) { return PP.markBroken(d, p.id); });
      if (!res || !res.ok) { showToast((res && res.error) || 'انجام نشد', { type: 'error' }); return; }
      closeModal(); afterChange();
    });
    on('pp-d-delete', async function () {
      if (!(await appConfirm('این وعده حذف شود؟', 'حذف'))) return;
      await PP.commit(function (d) { return PP.remove(d, p.id); });
      closeModal(); afterChange(); showToast('وعده حذف شد');
    });
  }

  /* ---------- dashboard ---------- */

  var DASH_MAX_ROWS = 5;

  function dashRow(p) {
    var b = PP.badge(p);
    var late = PP.phase(p).kind === 'overdue';
    return '<div class="pp-dash-row">' +
      '<a class="pp-dash-who" href="#/customer?id=' + encodeURIComponent(p.customerId) + '">' +
        '<strong>' + esc(customerName(p.customerId)) + '</strong>' +
        '<small>' + esc(PP.amountLabel(p)) + whoHint(p) + (late ? ' · <span class="pp-dash-late">' + esc(b.text) + '</span>' : '') + '</small>' +
      '</a>' +
      '<button type="button" class="pp-receive" data-pp-receive-quick="' + esc(p.id) + '">دریافت شد</button>' +
    '</div>';
  }

  /** One calm card, two groups (سررسیدگذشته / امروز); at most 5 rows, «همه» opens the full list. '' when nothing is due. */
  function dashboardHtml(opts) {
    var due = PP.dueList();
    if (!due.length) return '';
    var shown = due.slice(0, opts && opts.all ? due.length : DASH_MAX_ROWS);
    var groups = [
      { title: 'سررسیدگذشته', tone: 'danger', list: shown.filter(function (p) { return PP.phase(p).kind === 'overdue'; }) },
      { title: 'امروز', tone: 'warning', list: shown.filter(function (p) { return PP.phase(p).kind === 'today'; }) },
    ];
    var body = groups.map(function (g) {
      if (!g.list.length) return '';
      return '<div class="pp-dash-group pp-dash-' + g.tone + '">' + g.title + '<span>' + enToFaDigits(String(g.list.length)) + '</span></div>' +
        g.list.map(dashRow).join('');
    }).join('');
    return '<div class="dashboard-block pp-dash">' +
      '<div class="dashboard-block-head"><div class="dash-section-label"><span>وعده‌های پرداخت</span></div>' +
        '<button type="button" class="section-action" data-pp-open-all>همه</button></div>' +
      '<div class="pp-dash-card">' + body + '</div></div>';
  }

  function bindDashboard(root) {
    if (!root) return;
    root.querySelectorAll('[data-pp-receive-quick]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.preventDefault();
        receive(b.getAttribute('data-pp-receive-quick'), { stay: true });
      });
    });
    var all = root.querySelector('[data-pp-open-all]');
    if (all) all.addEventListener('click', openListSheet);
  }

  /** Dashboard sheet: overdue → today → upcoming. Tap a row → detail (with «دریافت شد»). */
  function openListSheet() {
    var today = todayISO();
    var groups = { overdue: [], today: [], upcoming: [] };
    PP.pendingList().forEach(function (p) { groups[PP.phase(p, today).kind].push(p); });
    function section(title, list) {
      if (!list.length) return '';
      return '<div class="pp-section-title">' + title + ' (' + enToFaDigits(String(list.length)) + ')</div><div class="pp-list">' +
        list.map(function (p) {
          return '<button type="button" class="pp-row" data-pp-list-open="' + esc(p.id) + '"><span class="pp-row-main"><strong>' +
            esc(customerName(p.customerId)) + '</strong><small>' + esc(PP.amountLabel(p)) + whoHint(p) + ' · ' + esc(faDate(p.promiseDate)) + '</small></span>' +
            badgeHtml(p) + '</button>';
        }).join('') + '</div>';
    }
    var body = section('سررسیدگذشته', groups.overdue) + section('امروز', groups.today) + section('در راه', groups.upcoming);
    openSheet('<h3>وعده‌های پرداخت</h3>' + (body || '<div class="empty">وعدهٔ در انتظاری ثبت نشده است.</div>'));
    document.querySelectorAll('[data-pp-list-open]').forEach(function (b) {
      b.addEventListener('click', function () { openDetailSheet(b.getAttribute('data-pp-list-open'), { fromList: true }); });
    });
  }

  global.PromiseUI = {
    cardHtml: cardHtml, addButtonHtml: addButtonHtml, historyHtml: historyHtml, bind: bind,
    dashboardHtml: dashboardHtml, bindDashboard: bindDashboard,
    openAddSheet: openAddSheet, openDetailSheet: openDetailSheet, openListSheet: openListSheet, receive: receive,
  };
})(typeof window !== 'undefined' ? window : this);
