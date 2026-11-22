/* js/views/delivery-promises.js — UI for «قول تحویل». Presentation only: rules/mutations live in
   js/delivery-promises.js (DeliveryPromises); the shared date helpers come from PaymentPromises.
   Entry points:
     DeliveryUI.slotHtml(cid, balance)  → customer page: ONE slot for both commitment kinds (payment + delivery)
     DeliveryUI.historyHtml(cid)        → collapsed history (done / cancelled)
     DeliveryUI.bind(root, cid)
     DeliveryUI.dashboardHtml() / bindDashboard(root)   → due/tomorrow deliveries with a 1-tap «تحویل شد»
     DeliveryUI.openAddSheet / openDetailSheet / openListSheet / openLoadSheet
*/
'use strict';

(function (global) {
  var DP = global.DeliveryPromises;
  var PP = global.PaymentPromises;

  function badgeHtml(p) {
    var b = DP.badge(p);
    return '<span class="pp-badge pp-' + b.tone + '">' + esc(b.text) + '</span>';
  }
  function customerName(cid) {
    var c = (data.customers || []).find(function (x) { return x && x.id === cid; });
    return c ? (c.name || '—') : '—';
  }
  function afterChange() { if (typeof render === 'function') render(); }
  function isOneOff(cid) { return isOneOffCustomer((data.customers || []).find(function (x) { return x && x.id === cid; })); }
  /** One-off customers («متفرقه»): the note carries WHO ordered, so lists show it. */
  function whoHint(p) { return (p.note && p.items && p.items.length && isOneOff(p.customerId)) ? ' · ' + esc(p.note) : ''; }
  function fa(n) { return enToFaDigits(String(n)); }

  /* ---------- customer page ---------- */

  function addButtonHtml(cid) {
    return '<button type="button" class="pp-add-row" data-dp-add="' + esc(cid) + '">' +
      '<span class="pp-add-plus" aria-hidden="true">+</span><span>قول تحویل</span></button>';
  }

  function cardHtml(cid) {
    var list = DP.pending(cid);
    if (!list.length) return '';
    var rows = list.map(function (p) {
      return '<button type="button" class="pp-row" data-dp-open="' + esc(p.id) + '">' +
        '<span class="pp-row-main"><strong>' + esc(DP.itemsLabel(p)) + '</strong><small>' + esc(faDate(p.deliveryDate)) + '</small></span>' +
        badgeHtml(p) + '</button>';
    }).join('');
    return '<div class="card pp-card dp-card">' +
      '<div class="dp-card-head"><span class="pp-card-title">قول‌های تحویل</span>' +
      '<button type="button" class="pp-link-btn" data-dp-add="' + esc(cid) + '">+ جدید</button></div>' +
      '<div class="dp-card-list">' + rows + '</div></div>';
  }

  /** The single «commitments» slot of the customer page: active cards first, compact add buttons side by side. */
  function slotHtml(cid, balance) {
    var out = '';
    var payActive = isOneOff(cid) ? PP.pendingFor(cid).length > 0 : !!PP.active(cid);
    var dels = DP.pending(cid);
    if (payActive) out += PromiseUI.cardHtml(cid, balance);
    if (dels.length) out += cardHtml(cid);
    var adds = [];
    if (!payActive && balance > 0) adds.push(PromiseUI.addButtonHtml(cid));
    if (!dels.length) adds.push(addButtonHtml(cid));
    if (adds.length) out += '<div class="pp-add-pair">' + adds.join('') + '</div>';
    return out;
  }

  function historyHtml(cid) {
    var closed = DP.forCustomer(cid).filter(function (p) { return p.status !== 'pending'; })
      .sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
    if (!closed.length) return '';
    var rows = closed.map(function (p) {
      return '<button type="button" class="pp-row" data-dp-open="' + esc(p.id) + '">' +
        '<span class="pp-row-main"><strong>' + esc(DP.itemsLabel(p)) + '</strong><small>' + esc(faDate(p.deliveryDate)) + '</small></span>' +
        badgeHtml(p) + '</button>';
    }).join('');
    return '<section class="cd-history-list"><h3 class="sub-title">تاریخچهٔ قول‌های تحویل (' +
      fa(closed.length) + ')</h3><div class="pp-list">' + rows + '</div></section>';
  }

  function bind(root, cid) {
    if (!root) return;
    root.querySelectorAll('[data-dp-add]').forEach(function (b) { b.onclick = function () { openAddSheet(b.getAttribute('data-dp-add')); }; });
    root.querySelectorAll('[data-dp-open]').forEach(function (b) { b.onclick = function () { openDetailSheet(b.getAttribute('data-dp-open')); }; });
  }

  /* ---------- flows ---------- */

  /** «تحویل شد»: opens the normal invoice form pre-filled with the promised goods. The promise turns «done»
      only when that invoice is saved (see openInvoiceForm). */
  function deliver(id) {
    var p = DP.byId(id);
    if (!p || p.status !== 'pending') return;
    if (typeof closeModal === 'function') closeModal();
    openAddInvoice(p.customerId, { deliveryId: p.id });
  }

  /* shared date block (add + reschedule): quick chips + shamsi field, returns {get, onChange} */
  function dateBlockHtml(defIso, withToday, label) {
    function chip(label, n) { return '<button type="button" class="chip-opt" data-dp-days="' + n + '">' + label + '</button>'; }
    return '<div class="q-block"><div class="q-title">' + (label || 'تاریخ تحویل') + '</div><div class="chip-wrap">' +
      (withToday ? chip('امروز', 0) : '') + chip('فردا', 1) + chip('۳ روز دیگر', 3) + chip('هفتهٔ دیگر', 7) + '</div></div>' +
      '<div class="field">' + shamsiDateInputHTML('dp-date', defIso, { mode: 'calendar' }) +
      '<div class="pp-error" id="dp-date-error" hidden>تاریخ نمی‌تواند قبل از امروز باشد</div></div>';
  }
  function wireDateBlock(onChange) {
    var dateEl = document.getElementById('dp-date');
    function ok() { return PP.isIso(dateEl.value) && dateEl.value >= todayISO(); }
    function sync() {
      document.getElementById('dp-date-error').hidden = ok();
      document.querySelectorAll('[data-dp-days]').forEach(function (c) {
        c.classList.toggle('selected', dateEl.value === PP.addDays(todayISO(), Number(c.getAttribute('data-dp-days'))));
      });
      if (onChange) onChange();
    }
    dateEl.addEventListener('input', sync);
    document.querySelectorAll('[data-dp-days]').forEach(function (c) {
      c.addEventListener('click', function () {
        var iso = PP.addDays(todayISO(), Number(c.getAttribute('data-dp-days')));
        dateEl.value = iso;
        var j = isoToJalali(iso);
        var field = dateEl.parentElement && dateEl.parentElement.querySelector('[data-shamsi-field]');
        if (field && j) field.value = enToFaDigits(j[0] + '/' + j[1] + '/' + j[2]);
        var sheetEl = c.closest('.sheet'); if (sheetEl) sheetEl.dataset.dirty = '1';
        sync();
      });
    });
    sync();
    return { value: function () { return dateEl.value; }, valid: ok };
  }

  function openAddSheet(cid) {
    var products = (data.products || []).filter(function (p) { return p && p.active !== false; })
      .sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
    if (!products.length) { showToast('اول در «اجناس» کالا اضافه کن'); return; }
    var rows = [{ productId: '', qty: '' }];

    function itemsHtml() {
      return rows.map(function (r, i) {
        return '<div class="dp-item" data-i="' + i + '">' +
          '<select class="dp-prod" aria-label="کالا"><option value="">انتخاب کالا…</option>' +
          products.map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === r.productId ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') +
          '</select>' +
          '<input class="dp-qty" type="text" inputmode="decimal" placeholder="مقدار" aria-label="مقدار" autocomplete="off" value="' + esc(r.qty) + '">' +
          (rows.length > 1 ? '<button type="button" class="dp-del" data-i="' + i + '" aria-label="حذف">×</button>' : '') +
          '</div>';
      }).join('');
    }

    openSheet(
      '<h3>قول تحویل — ' + esc(customerName(cid)) + '</h3>' +
      '<div class="q-title">چه چیزی؟</div>' +
      '<div id="dp-items" class="dp-items">' + itemsHtml() + '</div>' +
      '<button type="button" class="pp-link-btn dp-add-item" id="dp-add-item">+ کالای دیگر</button>' +
      dateBlockHtml(PP.addDays(todayISO(), 1), true) +
      '<div class="field"><label>' + (isOneOff(cid) ? 'نام خریدار / یادداشت' : 'یادداشت (اختیاری)') + '</label><input id="dp-note" autocomplete="off"></div>' +
      '<div class="btn-row"><button type="button" class="btn" id="dp-save">ثبت</button></div>',
      { dirtyCheck: true }
    );

    var saveBtn = document.getElementById('dp-save');
    var noteEl = document.getElementById('dp-note');
    var date = null;
    function qtyOf(r) { var v = parseFloat(faToEnDigits(String(r.qty))); return Number.isFinite(v) ? v : (String(r.qty).trim() === '' ? 0 : NaN); }
    function refresh() {
      var anyProduct = rows.some(function (r) { return r.productId; });
      var qtyOk = rows.every(function (r) { return !r.productId || (Number.isFinite(qtyOf(r)) && qtyOf(r) >= 0); });
      saveBtn.disabled = !(date && date.valid()) || !qtyOk || !(anyProduct || noteEl.value.trim());
    }
    function wireItems() {
      var box = document.getElementById('dp-items');
      box.innerHTML = itemsHtml();
      box.querySelectorAll('.dp-item').forEach(function (el) {
        var i = Number(el.getAttribute('data-i'));
        el.querySelector('.dp-prod').addEventListener('change', function (e) { rows[i].productId = e.target.value; refresh(); });
        el.querySelector('.dp-qty').addEventListener('input', function (e) { rows[i].qty = e.target.value; refresh(); });
        var del = el.querySelector('.dp-del');
        if (del) del.addEventListener('click', function () { rows.splice(i, 1); wireItems(); refresh(); });
      });
    }
    wireItems();
    document.getElementById('dp-add-item').addEventListener('click', function () { rows.push({ productId: '', qty: '' }); wireItems(); refresh(); });
    noteEl.addEventListener('input', refresh);
    date = wireDateBlock(refresh);

    saveBtn.addEventListener('click', async function (e) {
      await withSubmitGuard(e.currentTarget, async function () {
        var items = rows.filter(function (r) { return r.productId; }).map(function (r) { return { productId: r.productId, qty: qtyOf(r) }; });
        var res = await DP.commit(function (d) { return DP.add(d, cid, { deliveryDate: date.value(), items: items, note: noteEl.value }); });
        if (!res || !res.ok) { showToast((res && res.error) || 'ثبت نشد', { type: 'error' }); throw new Error('validation'); }
        closeModal(); afterChange(); showToast('قول تحویل ثبت شد');
      });
    });
  }

  /**
   * Generic «pick a date» sheet (also used by VisitPlanUI).
   * onSave(iso) → Promise<{ok, error?}>; the sheet closes and the view re-renders on success.
   */
  function openDateSheet(title, label, defIso, onSave) {
    var start = (PP.isIso(defIso) && defIso >= todayISO()) ? defIso : PP.addDays(todayISO(), 1);
    openSheet('<h3>' + title + '</h3>' + dateBlockHtml(start, true, label) +
      '<div class="btn-row"><button type="button" class="btn" id="dp-save">ثبت</button></div>', { dirtyCheck: true });
    var saveBtn = document.getElementById('dp-save');
    var date = wireDateBlock(function () { saveBtn.disabled = !date || !date.valid(); });
    saveBtn.disabled = !date.valid();
    saveBtn.addEventListener('click', async function (e) {
      await withSubmitGuard(e.currentTarget, async function () {
        var res = await onSave(date.value());
        if (!res || !res.ok) { showToast((res && res.error) || 'ثبت نشد', { type: 'error' }); throw new Error('validation'); }
        closeModal(); afterChange(); showToast('تاریخ تغییر کرد');
      });
    });
  }

  function openRescheduleSheet(id) {
    var p = DP.byId(id);
    if (!p || p.status !== 'pending') return;
    openDateSheet('تغییر تاریخ تحویل', 'تاریخ تحویل', p.deliveryDate, function (iso) {
      return DP.commit(function (d) { return DP.reschedule(d, id, iso); });
    });
  }

  /** opts.fromList: opened from a list → adds «صفحهٔ مشتری». */
  function openDetailSheet(id, opts) {
    opts = opts || {};
    var p = DP.byId(id);
    if (!p) return;
    function kv(k, v) { return '<div class="pp-kv"><span>' + k + '</span><strong>' + v + '</strong></div>'; }
    function action(idStr, label, hint, cls, href) {
      var inner = '<span>' + label + '</span>' + (hint ? '<small>' + hint + '</small>' : '');
      var c = 'pp-action' + (cls ? ' ' + cls : '');
      return href
        ? '<a class="' + c + '" id="' + idStr + '" href="' + href + '">' + inner + '</a>'
        : '<button type="button" class="' + c + '" id="' + idStr + '">' + inner + '</button>';
    }
    var itemsHtml = (p.items || []).length
      ? p.items.map(function (it) { return esc(it.name || '—') + (it.qty > 0 ? ' × ' + fa(fmtQtyDisplay(it.qty)) : ''); }).join('<br>')
      : '';
    var inv = p.invoiceId ? (data.invoices || []).find(function (x) { return x && x.id === p.invoiceId; }) : null;
    var primary = '', resolve = '', more = '';
    if (p.status === 'pending') {
      primary = '<button type="button" class="btn" id="dp-d-deliver">تحویل شد — ثبت فاکتور</button>';
      resolve += action('dp-d-manual', 'تحویل شد، بدون فاکتور', 'کالا را جداگانه تحویل داده‌ام');
      resolve += action('dp-d-reschedule', 'تغییر تاریخ');
      resolve += action('dp-d-cancel', 'لغو قول', '', 'is-danger');
    }
    if (opts.fromList) more += action('dp-d-customer', 'صفحهٔ مشتری', '', '', '#/customer?id=' + encodeURIComponent(p.customerId));
    more += action('dp-d-delete', 'حذف', '', 'is-danger');
    openSheet(
      '<h3>قول تحویل ' + badgeHtml(p) + '</h3><div class="pp-detail">' +
        kv('مشتری', esc(customerName(p.customerId))) +
        (itemsHtml ? kv('اقلام', itemsHtml) : '') +
        kv('تاریخ تحویل', esc(faDate(p.deliveryDate))) +
        kv('ثبت‌شده در', esc(faDate(p.date))) +
        (p.note ? kv('یادداشت', esc(p.note)) : '') +
        (p.status === 'done' ? kv('نحوهٔ تحویل', inv ? 'با فاکتور ' + fa(inv.number != null ? inv.number : '') : 'بدون فاکتور') : '') +
      '</div><div class="pp-actions">' + primary +
        (resolve ? '<div class="pp-action-list">' + resolve + '</div>' : '') +
        '<div class="pp-action-list">' + more + '</div></div>'
    );
    function on(idStr, fn) { var el = document.getElementById(idStr); if (el) el.addEventListener('click', fn); }
    on('dp-d-deliver', function () { deliver(p.id); });
    on('dp-d-reschedule', function () { openRescheduleSheet(p.id); });
    on('dp-d-customer', function () { closeModal(); });
    on('dp-d-manual', async function () {
      if (!(await appConfirm('این قول بدون فاکتور بسته شود؟ (کالا جداگانه تحویل داده شده)', 'بستن'))) return;
      var res = await DP.commit(function (d) { return DP.closeManually(d, p.id); });
      if (!res || !res.ok) { showToast((res && res.error) || 'انجام نشد', { type: 'error' }); return; }
      closeModal(); afterChange(); showToast('قول بسته شد');
    });
    on('dp-d-cancel', async function () {
      if (!(await appConfirm('این قول تحویل لغو شود؟', 'لغو قول'))) return;
      var res = await DP.commit(function (d) { return DP.cancel(d, p.id); });
      if (!res || !res.ok) { showToast((res && res.error) || 'انجام نشد', { type: 'error' }); return; }
      closeModal(); afterChange();
    });
    on('dp-d-delete', async function () {
      if (!(await appConfirm('این قول حذف شود؟', 'حذف'))) return;
      await DP.commit(function (d) { return DP.remove(d, p.id); });
      closeModal(); afterChange(); showToast('حذف شد');
    });
  }

  /* ---------- lists & loading summary ---------- */

  /** All pending promises: overdue → today → tomorrow → later. */
  function openListSheet() {
    var g = { overdue: [], today: [], tomorrow: [], upcoming: [] };
    DP.pendingAll().forEach(function (p) { g[DP.phase(p).kind].push(p); });
    function section(title, list) {
      if (!list.length) return '';
      return '<div class="pp-section-title">' + title + ' (' + fa(list.length) + ')</div><div class="pp-list">' +
        list.map(function (p) {
          return '<button type="button" class="pp-row" data-dp-list-open="' + esc(p.id) + '"><span class="pp-row-main"><strong>' +
            esc(customerName(p.customerId)) + '</strong><small>' + esc(DP.itemsLabel(p)) + whoHint(p) + ' · ' + esc(faDate(p.deliveryDate)) + '</small></span>' +
            badgeHtml(p) + '</button>';
        }).join('') + '</div>';
    }
    var body = section('عقب‌افتاده', g.overdue) + section('امروز', g.today) + section('فردا', g.tomorrow) + section('بعداً', g.upcoming);
    openSheet('<h3>قول‌های تحویل</h3>' + (body || '<div class="empty">قول تحویل بازی ثبت نشده است.</div>'));
    document.querySelectorAll('[data-dp-list-open]').forEach(function (b) {
      b.addEventListener('click', function () { openDetailSheet(b.getAttribute('data-dp-list-open'), { fromList: true }); });
    });
  }

  /** «بارگیری»: per-product totals for today (incl. overdue) and for tomorrow, with a stock warning. */
  function openLoadSheet() {
    var today = todayISO(), tomorrow = PP.addDays(today, 1);
    function section(title, rows) {
      if (!rows.length) return '';
      return '<div class="pp-section-title">' + title + '</div><div class="pp-list">' + rows.map(function (r) {
        var qty = r.qty > 0 ? fa(fmtQtyDisplay(r.qty)) + (r.unknown ? ' +' : '') : 'مقدار نامشخص';
        var warn = r.short ? '<span class="pp-dash-late">موجودی ' + fa(fmtQtyDisplay(r.stock)) + ' · کمبود ' + fa(fmtQtyDisplay(r.qty - r.stock)) + '</span>' : '';
        return '<div class="pp-row pp-load-row"><span class="pp-row-main"><strong>' + esc(r.name) + '</strong>' +
          '<small>' + esc(r.customers.join('، ')) + (warn ? ' · ' : '') + warn + '</small></span>' +
          '<span class="pp-load-qty">' + qty + '</span></div>';
      }).join('') + '</div>';
    }
    var forToday = DP.loadSummary(null, today, null);
    var forTomorrow = DP.loadSummary(null, tomorrow, tomorrow);
    var body = section('برای امروز (با عقب‌افتاده‌ها)', forToday) + section('برای فردا', forTomorrow);
    openSheet('<h3>بارگیری</h3>' + (body || '<div class="empty">برای امروز و فردا چیزی قول داده نشده است.</div>'));
  }

  /* ---------- dashboard ---------- */

  var DASH_MAX_ROWS = 5;

  function dashRow(p) {
    var late = DP.phase(p).kind === 'overdue';
    return '<div class="pp-dash-row">' +
      '<a class="pp-dash-who" href="#/customer?id=' + encodeURIComponent(p.customerId) + '">' +
        '<strong>' + esc(customerName(p.customerId)) + '</strong>' +
        '<small>' + esc(DP.itemsLabel(p)) + whoHint(p) + (late ? ' · <span class="pp-dash-late">' + esc(DP.badge(p).text) + '</span>' : '') + '</small>' +
      '</a>' +
      '<button type="button" class="pp-receive" data-dp-deliver-quick="' + esc(p.id) + '">تحویل شد</button>' +
    '</div>';
  }

  /** One calm card: عقب‌افتاده / امروز / فردا. '' when nothing is due by tomorrow. */
  function dashboardHtml(opts) {
    var due = DP.dueList();
    if (!due.length) return '';
    var shown = due.slice(0, opts && opts.all ? due.length : DASH_MAX_ROWS);
    var groups = [
      { title: 'عقب‌افتاده', tone: 'danger', kind: 'overdue' },
      { title: 'امروز', tone: 'warning', kind: 'today' },
      { title: 'فردا', tone: 'primary', kind: 'tomorrow' },
    ];
    var body = groups.map(function (g) {
      var list = shown.filter(function (p) { return DP.phase(p).kind === g.kind; });
      if (!list.length) return '';
      return '<div class="pp-dash-group pp-dash-' + g.tone + '">' + g.title + '<span>' + fa(list.length) + '</span></div>' + list.map(dashRow).join('');
    }).join('');
    return '<div class="dashboard-block pp-dash">' +
      '<div class="dashboard-block-head"><div class="dash-section-label"><span>قول‌های تحویل</span></div>' +
        '<div class="pp-head-actions"><button type="button" class="section-action" data-dp-open-load>بارگیری</button>' +
        '<button type="button" class="section-action" data-dp-open-all>همه</button></div></div>' +
      '<div class="pp-dash-card">' + body + '</div></div>';
  }

  function bindDashboard(root) {
    if (!root) return;
    root.querySelectorAll('[data-dp-deliver-quick]').forEach(function (b) {
      b.addEventListener('click', function (e) { e.preventDefault(); deliver(b.getAttribute('data-dp-deliver-quick')); });
    });
    var all = root.querySelector('[data-dp-open-all]'); if (all) all.addEventListener('click', openListSheet);
    var load = root.querySelector('[data-dp-open-load]'); if (load) load.addEventListener('click', openLoadSheet);
  }

  global.DeliveryUI = {
    slotHtml: slotHtml, historyHtml: historyHtml, bind: bind,
    dashboardHtml: dashboardHtml, bindDashboard: bindDashboard,
    openAddSheet: openAddSheet, openDetailSheet: openDetailSheet, openListSheet: openListSheet, openLoadSheet: openLoadSheet, deliver: deliver,
    openDateSheet: openDateSheet,
  };
})(typeof window !== 'undefined' ? window : this);
