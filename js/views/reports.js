/* js/views/reports.js — SPA Reports view (management report, redesigned).

   Question this page answers: «در این بازه چه اتفاقی برای عملکرد کسب‌وکار افتاد و دلیل اصلی چه بود؟»
   (Dashboard answers a different one: «امروز چه کار کنم؟» — Dashboard is untouched.)

   Hierarchy: Glance → Scan → Understand → Drill down
     1. Period selector (segmented)     2. Period context
     3. Hero — sales of the period       4. Sales trend (line)
     5. Performance snapshot             6. Top products (rounded bars)
     7. Customers                        8. Collections / receivables
     9. Inventory (exception-driven)    10. Field performance (visits)
    11. Financial & supply (collapsed)  12. Detail links

   READ-ONLY presentation layer. No accounting, FIFO, allocation, backup,
   schema, Intelligence or Watch logic is touched or re-implemented. Everything
   comes from existing `data` + calc.js helpers (globalTotals, inventoryValue,
   lowStockProducts, debtorList, supplierTotals, commandCenterMetrics,
   invoiceDiscountAmount).
   analysisGroupId / product families are deliberately NOT used.

   Period-aware helpers below (bucketing, top products / customers per period)
   are local, presentation-only aggregations over existing records.
*/
'use strict';

(function (global) {
  /* ------------------------------------------------------------------ */
  /* State                                                               */
  /* ------------------------------------------------------------------ */
  let reportPeriod = 'month';
  let openState = { receipts: false, financial: false };
  let rootClickHandler = null;
  let rootToggleHandler = null;
  let chartPointerHandler = null;
  let chartState = null;

  const PERIODS = [
    { id: 'today', label: 'امروز' },
    { id: 'week', label: 'این هفته' },
    { id: 'month', label: 'این ماه' },
    { id: 'all', label: 'همه' },
    { id: 'range', label: 'بازه' },
  ];
  const PERIOD_LABEL = { today: 'امروز', week: 'این هفته', month: 'این ماه', all: 'همه زمان‌ها', range: 'بازه انتخابی' };
  /* Custom range: { from, to } as ISO dates (inclusive). Compared with the equal-length span just before it. */
  let reportRange = null;
  let reportProductSort = 'sales'; // 'sales' | 'profit' — top-products ordering
  let reportProductsAll = false;   // false: top five; true: every product in the period
  function rangeDefault() {
    const t = new Date();
    const f = new Date(t);
    f.setDate(f.getDate() - 29);
    return { from: isoOfLocalDate(f), to: isoOfLocalDate(t) };
  }
  function rangeDays(r) {
    const a = new Date(r.from + 'T00:00:00');
    const b = new Date(r.to + 'T00:00:00');
    return Math.round((b - a) / 86400000) + 1;
  }
  function prevRangeOf(r) {
    const n = rangeDays(r);
    const b = new Date(r.from + 'T00:00:00');
    b.setDate(b.getDate() - 1);
    const a = new Date(b);
    a.setDate(a.getDate() - (n - 1));
    return { from: isoOfLocalDate(a), to: isoOfLocalDate(b) };
  }
  function inRange(iso, r) {
    const d = String(iso || '').slice(0, 10);
    return !!r && d >= r.from && d <= r.to;
  }
  const WEEKDAYS = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];
  const MONTHS =
    (typeof SHAMSI_MONTH_NAMES !== 'undefined' && SHAMSI_MONTH_NAMES) ||
    ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];

  const CHEVRON_SVG =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>';

  /* ------------------------------------------------------------------ */
  /* Formatting                                                          */
  /* ------------------------------------------------------------------ */
  function fa(n) {
    return enToFaDigits(String(n));
  }
  function faNum(n, maxFrac) {
    return Number(n || 0).toLocaleString('fa-IR', { maximumFractionDigits: maxFrac == null ? 1 : maxFrac });
  }
  /** {num, unit} — hero shows a big number with a small unit. */
  function splitBig(n) {
    const v = Math.round(Number(n) || 0);
    const a = Math.abs(v);
    if (a >= 1e9) return { num: faNum(v / 1e9, 2), unit: 'میلیارد تومان' };
    if (a >= 1e6) return { num: faNum(v / 1e6, 1), unit: 'میلیون تومان' };
    return { num: toman(v), unit: 'تومان' };
  }
  /** Compact one-line money for bars / stats. */
  function compact(n) {
    const v = Math.round(Number(n) || 0);
    const a = Math.abs(v);
    if (a >= 1e9) return faNum(v / 1e9, 2) + ' میلیارد';
    if (a >= 1e6) return faNum(v / 1e6, 1) + ' میلیون';
    return toman(v);
  }
  function fullToman(n) {
    return toman(n) + ' تومان';
  }

  /* ------------------------------------------------------------------ */
  /* Period helpers (same rules the previous page used)                  */
  /* ------------------------------------------------------------------ */
  function startOfWeek(ref) {
    const d = new Date(ref);
    const day = d.getDay();
    const diff = (day + 1) % 7; // week starts Saturday
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - diff);
    return d;
  }

  function dateInPeriod(iso, period, now) {
    if (period === 'all') return true;
    if (!iso) return false;
    if (period === 'range') return inRange(iso, reportRange);
    if (period === 'today') return isSameDay(iso, now);
    /* Week and month end at today: a future-dated invoice must not lengthen only the current span. */
    if (period === 'month') return isSameMonth(iso, now) && String(iso).slice(0, 10) <= isoOfLocalDate(now);
    if (period === 'week') {
      const d = new Date(iso);
      const start = startOfWeek(now);
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      return d >= start && d < end;
    }
    return true;
  }

  function isoOfLocalDate(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function key10(iso) {
    return String(iso || '').slice(0, 10);
  }

  /* Product-level gross profit. Uses the exact per-line and per-invoice terms of
     periodInvoiceGrossProfit (line: (price−buyPrice)×qty − line discount; invoice:
     − invoiceDiscountAmount). The invoice discount is ALLOCATED to lines in proportion
     to their net line value, so the sum over products equals the period total exactly.
     Returns are not netted from profit (same convention as the period headline); they
     are attributed to products separately in topProductsForPeriod. */
  function productProfitRows(invoices, retPays, discountTotal) {
    const map = {};
    let unallocated = 0;
    invoices.forEach(function (inv) {
      const items = inv.items || [];
      const subtotal = items.reduce(function (a, it) {
        return a + (it.qty || 0) * (it.price || 0) - (it.discount || 0);
      }, 0);
      const invDisc = invoiceDiscountAmount(inv);
      if (subtotal <= 0 && invDisc) unallocated += invDisc;
      items.forEach(function (it) {
        const lineNet = (it.qty || 0) * (it.price || 0) - (it.discount || 0);
        const alloc = subtotal > 0 ? (invDisc * lineNet) / subtotal : 0;
        const profit = ((it.price || 0) - (it.buyPrice || 0)) * (it.qty || 0) - (it.discount || 0) - alloc;
        const sales = lineNet - alloc;
        const k = it.productId || it.name;
        if (!map[k]) map[k] = { productId: it.productId, name: it.name || '—', sales: 0, profit: 0, qty: 0 };
        map[k].sales += sales;
        map[k].profit += profit;
        map[k].qty += it.qty || 0;
      });
    });
    /* Returns of the period (by PAYMENT date, the dashboard KPI rule). Profit reversal per
       returned line = _ccReturnMarginForPayment, the exact function the KPI uses (FIFO cost). */
    let returnsMargin = 0;
    (retPays || []).forEach(function (p) {
      (p.returnItems || []).forEach(function (ri) {
        if (!(Number(ri.qty) > 0)) return;
        const margin = typeof _ccReturnMarginForPayment === 'function'
          ? _ccReturnMarginForPayment(p.customerId, Object.assign({}, p, { returnItems: [ri] }))
          : 0;
        returnsMargin += margin;
        const k = ri.productId || ri.name;
        if (!map[k]) map[k] = { productId: ri.productId, name: ri.name || '—', sales: 0, profit: 0, qty: 0 };
        map[k].profit -= margin;
        map[k].sales -= (Number(ri.qty) || 0) * (Number(ri.price) || 0);
        map[k].qty -= Number(ri.qty) || 0;
      });
    });

    const rows = Object.keys(map).map(function (k) {
      const r = map[k];
      r.margin = r.sales > 0 ? (r.profit / r.sales) * 100 : null;
      return r;
    });
    const netTotal = rows.reduce(function (a, r) { return a + r.profit; }, 0) - (discountTotal || 0);
    return { rows: rows, unallocated: unallocated, returnsMargin: returnsMargin, discountTotal: discountTotal || 0, netTotal: netTotal };
  }

  // Same formula the previous Reports page used for «سود ناخالص فاکتورهای دوره».
  function periodInvoiceGrossProfit(invoices) {
    return invoices.reduce(function (sum, inv) {
      const itemsProfit = (inv.items || []).reduce(function (a, it) {
        return a + ((it.price || 0) - (it.buyPrice || 0)) * (it.qty || 0) - (it.discount || 0);
      }, 0);
      return sum + itemsProfit - invoiceDiscountAmount(inv);
    }, 0);
  }

  /* ------------------------------------------------------------------ */
  /* Returns (read-only). Same attribution rule as calc.js              */
  /* _behaviorReturnsInRange: a return belongs to the period of the      */
  /* ORIGINAL invoice when resolvable, otherwise to its own date.        */
  /* ------------------------------------------------------------------ */
  function periodReturns(period, now) {
    const invById = {};
    (data.invoices || []).forEach(function (i) {
      if (i && i.id) invById[i.id] = i;
    });
    const list = [];
    (data.payments || []).forEach(function (p) {
      if (!p || p.method !== 'return') return;
      let ref = p.date;
      if (p.invoiceId && invById[p.invoiceId] && invById[p.invoiceId].date) ref = invById[p.invoiceId].date;
      if (dateInPeriod(ref, period, now)) list.push(p);
    });
    return list;
  }

  /* ------------------------------------------------------------------ */
  /* Period-aware Top Products (local wrapper; calc.js topProducts is    */
  /* all-time and is left untouched).                                    */
  /* Sales value = qty × price − line discount (same as topProducts),    */
  /* minus returned value (returnItems qty × price) of the same period.  */
  /* ------------------------------------------------------------------ */
  function topProductsForPeriod(invs, returns, limit) {
    /* Revenue = net sales of the invoices: line value minus the invoice-level discount,
       allocated to lines (same allocation as the product profit table). Invoice totals
       are already net of that discount, so the product bars now add up to the headline. */
    const map = {};
    productProfitRows(invs, [], 0).rows.forEach(function (r) {
      if (r.sales === 0 && r.qty === 0) return;
      map[r.productId || r.name] = { productId: r.productId, name: r.name, revenue: r.sales };
    });
    let returnsWithoutItems = 0;
    let appliedReturns = 0;
    returns.forEach(function (p) {
      const items = p.returnItems || [];
      if (!items.length) {
        returnsWithoutItems++;
        return;
      }
      items.forEach(function (ri) {
        const k = ri.productId || ri.name;
        if (map[k]) {
          map[k].revenue -= (ri.qty || 0) * (ri.price || 0);
          appliedReturns++;
        }
      });
    });
    const list = Object.keys(map)
      .map(function (k) {
        return map[k];
      })
      .filter(function (x) {
        return x.revenue > 0;
      })
      .sort(function (a, b) {
        return b.revenue - a.revenue;
      });
    return { top: list.slice(0, limit || 5), returnsWithoutItems: returnsWithoutItems, appliedReturns: appliedReturns };
  }

  /* Period-aware Top Customers: invoice totals in the period minus the   */
  /* customer's returns attributed to the same period.                    */
  function topCustomersForPeriod(invs, returns, limit) {
    const map = {};
    invs.forEach(function (inv) {
      if (inv.customerId == null) return;
      map[inv.customerId] = (map[inv.customerId] || 0) + (inv.total || 0);
    });
    returns.forEach(function (p) {
      if (p.customerId == null || map[p.customerId] == null) return;
      map[p.customerId] -= p.amount || 0;
    });
    const byId = {};
    (data.customers || []).forEach(function (c) {
      byId[c.id] = c;
    });
    return Object.keys(map)
      .map(function (id) {
        return { c: byId[id], net: map[id] };
      })
      .filter(function (x) {
        return x.c && x.net > 0;
      })
      .sort(function (a, b) {
        return b.net - a.net;
      })
      .slice(0, limit || 5);
  }

  /* ------------------------------------------------------------------ */
  /* Visits ↔ invoices. Only invoices with a RESOLVABLE visitId inside   */
  /* the same customer's visits, dated on/after the visit, are linked    */
  /* (same rule as calc.js _behaviorVisitInvoiceStats). No guessing.     */
  /* ------------------------------------------------------------------ */
  function visitStats(period, now) {
    let visits = 0;
    let linkedInPeriod = 0;
    let linkedEver = 0;
    const invByCustomer = {};
    (data.invoices || []).forEach(function (inv) {
      if (!inv || inv.customerId == null) return;
      if (!inv.visitId || typeof inv.visitId !== 'string' || !inv.visitId.trim()) return;
      (invByCustomer[inv.customerId] = invByCustomer[inv.customerId] || []).push(inv);
    });
    (data.customers || []).forEach(function (c) {
      const vs = c.visits || [];
      if (!vs.length) return;
      const linkedIds = {};
      (invByCustomer[c.id] || []).forEach(function (inv) {
        const v = vs.find(function (x) {
          return x.id === inv.visitId;
        });
        if (!v) return;
        if (key10(inv.date) < key10(v.date)) return;
        linkedIds[v.id] = true;
      });
      vs.forEach(function (v) {
        if (linkedIds[v.id]) linkedEver++;
        if (!dateInPeriod(v.date, period, now)) return;
        visits++;
        if (linkedIds[v.id]) linkedInPeriod++;
      });
    });
    return { visits: visits, linked: linkedInPeriod, linkedEver: linkedEver };
  }

  /* ------------------------------------------------------------------ */
  /* Trend series (local presentation bucketing; sums invoice.total only)*/
  /* ------------------------------------------------------------------ */
  function sumByDay(invs) {
    const m = {};
    invs.forEach(function (i) {
      const k = key10(i.date);
      m[k] = (m[k] || 0) + (i.total || 0);
    });
    return m;
  }

  function buildTrend(period, now, invsAll) {
    const byDay = sumByDay(invsAll);
    const pts = [];

    if (period === 'week') {
      const start = startOfWeek(now);
      const today0 = new Date(now);
      today0.setHours(0, 0, 0, 0);
      const elapsed = Math.min(7, Math.max(1, Math.round((today0 - start) / 86400000) + 1));
      for (let i = 0; i < elapsed; i++) {
        const d = new Date(start);
        d.setDate(d.getDate() + i);
        const p = new Date(start);
        p.setDate(p.getDate() + i - 7);
        pts.push({
          label: WEEKDAYS[i],
          title: WEEKDAYS[i] + ' ' + faDate(isoOfLocalDate(d)),
          value: byDay[isoOfLocalDate(d)] || 0,
          prev: byDay[isoOfLocalDate(p)] || 0,
        });
      }
      return { points: pts, hasPrev: true, prevLabel: 'هفته قبل' };
    }

    if (period === 'month') {
      const cur = _ccJalaliParts(now);
      if (!cur) return { points: [], hasPrev: false };
      const prev = _ccPreviousJalaliMonth(cur.jy, cur.jm);
      const prevLen = jalaliMonthLength(prev.jy, prev.jm);
      for (let d = 1; d <= cur.jd; d++) {
        pts.push({
          label: fa(d),
          title: fa(d) + ' ' + MONTHS[cur.jm - 1],
          value: byDay[jalaliToISO(cur.jy, cur.jm, d)] || 0,
          prev: d <= prevLen ? byDay[jalaliToISO(prev.jy, prev.jm, d)] || 0 : null,
        });
      }
      return { points: pts, hasPrev: true, prevLabel: 'ماه قبل' };
    }

    if (period === 'all') {
      const sums = {};
      let minKey = null;
      invsAll.forEach(function (i) {
        const j = isoToJalali(key10(i.date));
        if (!j) return;
        const k = j[0] * 100 + j[1];
        sums[k] = (sums[k] || 0) + (i.total || 0);
        if (minKey === null || k < minKey) minKey = k;
      });
      if (minKey === null) return { points: [], hasPrev: false };
      const cur = _ccJalaliParts(now);
      let y = Math.floor(minKey / 100);
      let m = minKey % 100;
      const list = [];
      while (y * 100 + m <= cur.jy * 100 + cur.jm && list.length < 600) {
        list.push({ y: y, m: m });
        m++;
        if (m > 12) {
          m = 1;
          y++;
        }
      }
      list.slice(-12).forEach(function (x) {
        pts.push({
          label: MONTHS[x.m - 1],
          title: MONTHS[x.m - 1] + ' ' + fa(x.y),
          value: sums[x.y * 100 + x.m] || 0,
          prev: null,
        });
      });
      return { points: pts, hasPrev: false };
    }

    if (period === 'range' && reportRange) {
      const n = rangeDays(reportRange);
      if (n > 62) return { points: [], hasPrev: false };
      for (let i = 0; i < n; i++) {
        const d = new Date(reportRange.from + 'T00:00:00');
        d.setDate(d.getDate() + i);
        const iso = isoOfLocalDate(d);
        pts.push({ label: fa(d.getDate()), title: faDate(iso), value: byDay[iso] || 0 });
      }
      return { points: pts, hasPrev: false };
    }

    // today: invoices carry a date only (no time) → no meaningful intra-day series
    return { points: [], hasPrev: false };
  }

  /* ------------------------------------------------------------------ */
  /* Sales comparison vs previous equivalent span — only where valid     */
  /*   month → existing commandCenterMetrics (same elapsed Jalali days)  */
  /*   week  → previous week, same elapsed days                          */
  /*   today / all → not shown (partial day / no baseline)               */
  /* ------------------------------------------------------------------ */
  function salesComparison(period, now, periodSales, trend, prevSum) {
    if (period === 'range') {
      if (prevSum > 0) return { pct: ((periodSales - prevSum) / prevSum) * 100, text: 'نسبت به ' + fa(rangeDays(reportRange)) + ' روز قبل از این بازه' };
      return null;
    }
    if (period === 'month' && typeof commandCenterMetrics === 'function') {
      const m = commandCenterMetrics(now);
      if (m && m.salesDeltaPct !== null && isFinite(m.salesDeltaPct) && Math.abs((m.mtdSales || 0) - periodSales) < 0.5) {
        return { pct: m.salesDeltaPct, text: 'نسبت به همین روزهای ماه قبل' };
      }
      return null;
    }
    if (period === 'week' && trend && trend.points.length) {
      const prevSum = trend.points.reduce(function (s, p) {
        return s + (p.prev || 0);
      }, 0);
      if (prevSum > 0) return { pct: ((periodSales - prevSum) / prevSum) * 100, text: 'نسبت به همین روزهای هفته قبل' };
    }
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* Period comparison: invoice count and net profit.                     */
  /* Both spans use one predicate per span, so the current figure and the */
  /* baseline are always counted with the same rule:                      */
  /*   range → equal-length span before it                                */
  /*   week  → same elapsed days of last week                             */
  /*   month → same elapsed Jalali days of last Jalali month             */
  /*   today / all → no valid baseline: no comparison is shown            */
  /* ------------------------------------------------------------------ */
  function createPreviousPeriodPredicate(period, now) {
    const DAY = 86400000;
    if (period === 'range' && reportRange) {
      const pr = prevRangeOf(reportRange);
      return function (iso) { return !!iso && inRange(iso, pr); };
    }
    if (period === 'week') {
      const start = startOfWeek(now);
      const startMs = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
      const todayMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const elapsed = Math.round((todayMs - startMs) / DAY) + 1;
      const prevStartMs = startMs - 7 * DAY;
      return function (iso) {
        if (!iso) return false;
        const t = new Date(String(iso).slice(0, 10) + 'T00:00:00').getTime();
        return t >= prevStartMs && t < prevStartMs + elapsed * DAY;
      };
    }
    if (period === 'month' && typeof _ccJalaliParts === 'function' && typeof _ccPreviousJalaliMonth === 'function') {
      const cur = _ccJalaliParts(now);
      if (!cur) return null;
      const prev = _ccPreviousJalaliMonth(cur.jy, cur.jm);
      return function (iso) {
        if (!iso) return false;
        const j = _ccJalaliParts(String(iso).slice(0, 10));
        /* jd <= today's jd: the previous month stops at the same elapsed day (or its own last day). */
        return !!j && j.jy === prev.jy && j.jm === prev.jm && j.jd <= cur.jd;
      };
    }
    return null;
  }

  /* Invoices by invoice date; returns and cash discounts by payment date; net profit through
     productProfitRows. Used for both the current span and the baseline. */
  function calculateTotalsForPredicate(test) {
    const pays = data.payments || [];
    const invs = (data.invoices || []).filter(function (i) { return test(i.date); });
    const rets = pays.filter(function (p) { return p && p.method === 'return' && test(p.date); });
    const disc = pays.reduce(function (sum, p) {
      return p && p.method === 'discount' && test(p.date) ? sum + (Number(p.amount) || 0) : sum;
    }, 0);
    return { count: invs.length, netProfit: productProfitRows(invs, rets, disc).netTotal };
  }

  function buildPeriodComparison(period, now) {
    const prevTest = createPreviousPeriodPredicate(period, now);
    if (!prevTest) return null;
    const curTest = function (iso) { return dateInPeriod(iso, period, now); };
    const label = period === 'range' ? 'بازهٔ قبل'
      : period === 'week' ? 'همین روزهای هفتهٔ قبل'
      : 'همین بازه از ماه قبل';
    return {
      label: label,
      current: calculateTotalsForPredicate(curTest),
      previous: calculateTotalsForPredicate(prevTest)
    };
  }

  /* Count: neutral colour with a direction arrow (more invoices is not automatically better). */
  function describeCountChange(current, previous, label) {
    const cur = Math.round(current), prev = Math.round(previous);
    if (cur === prev) return { text: 'بدون تغییر نسبت به ' + label, cls: '' };
    if (prev === 0) return { text: 'دورهٔ قبل صفر بوده (' + (cur > 0 ? '+' : '') + fa(cur) + ' فاکتور)', cls: '' };
    const pct = ((cur - prev) / prev) * 100;
    return { text: percentPhrase(pct) + ' نسبت به ' + label, cls: '', arrow: pct > 0 ? '↑ ' : '↓ ' };
  }

  /* Net profit: colour follows real improvement or decline; loss reduction counts as improvement. */
  function describeNetChange(current, previous, label) {
    const cur = Math.round(current), prev = Math.round(previous);
    if (cur === prev) return { text: 'بدون تغییر نسبت به ' + label, cls: '' };
    if (prev === 0) return cur > 0
      ? { text: 'دورهٔ قبل صفر بوده؛ سود این دوره ' + fullToman(cur), cls: '' }
      : { text: 'دورهٔ قبل صفر بوده؛ زیان این دوره ' + fullToman(-cur), cls: '' };
    if (cur === 0) {
      return prev > 0
        ? { text: 'سود به صفر رسید؛ افت ' + fullToman(prev), cls: 'is-down', arrow: '↓ ' }
        : { text: 'زیان به صفر رسید؛ بهبود ' + fullToman(-prev), cls: 'is-up', arrow: '↑ ' };
    }
    if (prev > 0 && cur > 0) {
      const pct = ((cur - prev) / prev) * 100;
      return { text: percentPhrase(pct) + ' نسبت به ' + label, cls: pct > 0 ? 'is-up' : 'is-down', arrow: pct > 0 ? '↑ ' : '↓ ' };
    }
    if (prev < 0 && cur > 0) return { text: 'از زیان به سود؛ بهبود ' + fullToman(cur - prev), cls: 'is-up', arrow: '↑ ' };
    if (prev > 0 && cur < 0) return { text: 'از سود به زیان؛ افت ' + fullToman(prev - cur), cls: 'is-down', arrow: '↓ ' };
    /* both negative */
    return cur > prev
      ? { text: 'کاهش زیان؛ بهبود ' + fullToman(cur - prev), cls: 'is-up', arrow: '↑ ' }
      : { text: 'افزایش زیان؛ افت ' + fullToman(prev - cur), cls: 'is-down', arrow: '↓ ' };
  }

  /* Percent with one decimal; a real but tiny change is never shown as «no change». */
  function percentPhrase(pct) {
    const abs = Math.abs(pct);
    if (abs < 0.1) return (pct > 0 ? 'افزایش' : 'کاهش') + ' کمتر از ۰٫۱٪';
    const p = Math.round(abs * 10) / 10;
    return (pct > 0 ? 'افزایش ' : 'کاهش ') + faNum(p, 1) + '٪';
  }

  /* One renderer for both metrics: { current, previous, metric: 'count' | 'net', label }. */
  function deltaTileHtml(args) {
    const model = args.metric === 'net'
      ? describeNetChange(args.current, args.previous, args.label)
      : describeCountChange(args.current, args.previous, args.label);
    /* Tiles carry only the short clause; the full baseline is named once under the card. */
    const text = args.short ? model.text.replace(/ نسبت به .*$/, '').split('؛')[0] : model.text;
    return '<div class="rp-delta' + (model.cls ? ' ' + model.cls : '') + '">' +
      (model.arrow || '') + text + '</div>';
  }

  /* ------------------------------------------------------------------ */
  /* Renderers                                                           */
  /* ------------------------------------------------------------------ */
  function segHtml() {
    return (
      '<div class="rp-seg" role="tablist" aria-label="بازه زمانی">' +
      PERIODS.map(function (p) {
        const on = reportPeriod === p.id;
        return (
          '<button type="button" role="tab" class="rp-seg-btn' +
          (on ? ' is-active' : '') +
          '" aria-selected="' +
          (on ? 'true' : 'false') +
          '" data-rp="' +
          p.id +
          '">' +
          p.label +
          '</button>'
        );
      }).join('') +
      '</div>'
    );
  }

  function rangeBarHtml() {
    if (!reportRange) reportRange = rangeDefault();
    return '<div class="rp-range" id="rp-range">' +
      '<label class="rp-range-item"><span>از</span>' + shamsiDateInputHTML('rp-range-from', reportRange.from, { mode: 'calendar' }) + '</label>' +
      '<label class="rp-range-item"><span>تا</span>' + shamsiDateInputHTML('rp-range-to', reportRange.to, { mode: 'calendar' }) + '</label>' +
      '</div>';
  }

  function contextText(period, now, hasCompare) {
    let main = PERIOD_LABEL[period];
    if (period === 'month') {
      const j = _ccJalaliParts(now);
      if (j) main = MONTHS[j.jm - 1] + ' ' + fa(j.jy);
    } else if (period === 'today') {
      main = 'امروز · ' + faDate(isoOfLocalDate(now));
    } else if (period === 'week') {
      main = 'این هفته · از ' + faDate(isoOfLocalDate(startOfWeek(now)));
    } else if (period === 'all') {
      main = 'از ابتدا تا امروز';
    } else if (period === 'range' && reportRange) {
      main = faDate(reportRange.from) + ' تا ' + faDate(reportRange.to);
    }
    return main + (hasCompare ? ' · مقایسه با دورهٔ قبل' : '');
  }

  function heroHtml(sales, count, avg, cmp) {
    const big = splitBig(sales);
    let delta = '';
    if (cmp) {
      const p = Math.round(cmp.pct * 10) / 10;
      const t = faNum(Math.abs(p), 1) + '٪ ' + cmp.text;
      if (p > 0) delta = '<div class="rp-delta is-up">↑ ' + t + '</div>';
      else if (p < 0) delta = '<div class="rp-delta is-down">↓ ' + t + '</div>';
      else delta = '<div class="rp-delta">بدون تغییر ' + cmp.text + '</div>';
    }
    return (
      '<section class="rp-hero" aria-label="فروش دوره">' +
      '<div class="rp-hero-label">فروش ' +
      esc(PERIOD_LABEL[reportPeriod]) +
      '</div>' +
      '<div class="rp-hero-value"><span class="rp-hero-num">' +
      big.num +
      '</span><span class="rp-hero-unit">' +
      big.unit +
      '</span></div>' +
      delta +
      (count
        ? '<div class="rp-hero-sub">' + fa(count) + ' فاکتور · میانگین ' + compact(avg) + ' تومان</div>'
        : '<div class="rp-hero-sub">در این بازه فاکتوری ثبت نشده است.</div>') +
      '</section>'
    );
  }

  function trendHtml(trend) {
    chartState = null;
    if (!trend || trend.points.length < 2) return '';
    const pts = trend.points;
    const n = pts.length;
    let max = 0;
    pts.forEach(function (p) {
      max = Math.max(max, p.value || 0, p.prev || 0);
    });
    if (max <= 0) return '';

    const X0 = 3;
    const X1 = 97;
    const Y0 = 8;
    const Y1 = 92;
    const step = (X1 - X0) / (n - 1);
    // RTL: the earliest point sits at the right edge. x is measured from the LEFT in the SVG.
    function px(i) {
      return X1 - i * step;
    }
    function py(v) {
      return Y1 - (v / max) * (Y1 - Y0);
    }
    /* Presentation: smooth monotone-cubic curve through the same points.
       Monotone interpolation never overshoots, so the line can't dip below
       the baseline or above the peak. Data, scale and touch logic unchanged. */
    function smoothPath(coords) {
      const m = coords.length;
      if (m === 0) return '';
      if (m === 1) return 'M ' + coords[0][0].toFixed(2) + ' ' + coords[0][1].toFixed(2);
      const dx = [], dy = [], sl = [];
      for (let k = 0; k < m - 1; k++) {
        dx.push(coords[k + 1][0] - coords[k][0]);
        dy.push(coords[k + 1][1] - coords[k][1]);
        sl.push(dy[k] / dx[k]);
      }
      const t = [sl[0]];
      for (let k = 1; k < m - 1; k++) {
        t.push(sl[k - 1] * sl[k] <= 0 ? 0 : (sl[k - 1] + sl[k]) / 2);
      }
      t.push(sl[m - 2]);
      for (let k = 0; k < m - 1; k++) {
        if (sl[k] === 0) { t[k] = 0; t[k + 1] = 0; continue; }
        const a = t[k] / sl[k], b2 = t[k + 1] / sl[k], h = Math.hypot(a, b2);
        if (h > 3) { const tau = 3 / h; t[k] = tau * a * sl[k]; t[k + 1] = tau * b2 * sl[k]; }
      }
      let d = 'M ' + coords[0][0].toFixed(2) + ' ' + coords[0][1].toFixed(2);
      for (let k = 0; k < m - 1; k++) {
        const x0 = coords[k][0], y0 = coords[k][1], x1 = coords[k + 1][0], y1 = coords[k + 1][1];
        const h3 = dx[k] / 3;
        d += ' C ' + (x0 + h3).toFixed(2) + ' ' + (y0 + t[k] * h3).toFixed(2) + ' ' +
          (x1 - h3).toFixed(2) + ' ' + (y1 - t[k + 1] * h3).toFixed(2) + ' ' + x1.toFixed(2) + ' ' + y1.toFixed(2);
      }
      return d;
    }
    const coords = pts.map(function (p, i) { return [px(i), py(p.value || 0)]; });
    const line = smoothPath(coords);
    const area = line + ' L ' + px(n - 1).toFixed(2) + ' ' + Y1 + ' L ' + px(0).toFixed(2) + ' ' + Y1 + ' Z';
    let prevLine = '';
    if (trend.hasPrev) {
      const seg = [];
      pts.forEach(function (p, i) {
        if (p.prev !== null && p.prev !== undefined) seg.push([px(i), py(p.prev)]);
      });
      if (seg.length > 1) prevLine = '<path class="rp-line-prev" d="' + smoothPath(seg) + '" vector-effect="non-scaling-stroke"/>';
    }

    chartState = { n: n, points: pts, max: max, X0: X0, X1: X1, Y0: Y0, Y1: Y1, step: step };

    const last = pts[n - 1];
    const labelIdx =
      n <= 7
        ? pts.map(function (_, i) {
            return i;
          })
        : [0, Math.round((n - 1) / 2), n - 1];
    const axis = labelIdx
      .map(function (i) {
        return '<span>' + esc(pts[i].label) + '</span>';
      })
      .join('');
    // HTML overlays are positioned from the RIGHT edge (RTL page).
    const lastRight = (100 - px(n - 1)).toFixed(2);

    return (
      '<section class="rp-card rp-trend" aria-label="روند فروش بر اساس مبلغ فاکتورها">' +
      '<div class="rp-sec-head"><div><h3 class="rp-sec-title">روند فروش</h3><div class="rp-chart-hint">مبلغ فاکتورها در هر روز</div></div>' +
      (prevLine
        ? '<span class="rp-legend"><i class="rp-legend-cur"></i>الان<i class="rp-legend-prev"></i>' + trend.prevLabel + '</span>'
        : '') +
      '</div>' +
      '<div class="rp-readout" id="rp-readout" aria-live="polite" aria-atomic="true"><span class="rp-readout-title">' +
      esc(last.title) +
      '</span><span class="rp-readout-val">' +
      fullToman(last.value) +
      '</span></div>' +
      '<div class="rp-chart" id="rp-chart" role="group" tabindex="0" aria-label="نمودار تعاملی روند فروش. برای جابه‌جایی بین روزها از کلیدهای جهت‌دار استفاده کنید." aria-controls="rp-readout">' +
      '<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">' +
      '<defs><linearGradient id="rp-fade" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" class="rp-fade-top"/><stop offset="1" class="rp-fade-bottom"/>' +
      '</linearGradient>' +
      '<linearGradient id="rp-stroke" gradientUnits="userSpaceOnUse" x1="100" y1="0" x2="0" y2="0">' +
      '<stop offset="0" class="rp-stroke-a"/><stop offset="1" class="rp-stroke-b"/>' +
      '</linearGradient></defs>' +
      '<line class="rp-grid" x1="0" x2="100" y1="' + Y0 + '" y2="' + Y0 + '" vector-effect="non-scaling-stroke"/>' +
      '<line class="rp-grid" x1="0" x2="100" y1="' + (Y0 + Y1) / 2 + '" y2="' + (Y0 + Y1) / 2 + '" vector-effect="non-scaling-stroke"/>' +
      '<line class="rp-grid is-base" x1="0" x2="100" y1="' + Y1 + '" y2="' + Y1 + '" vector-effect="non-scaling-stroke"/>' +
      '<path class="rp-area" d="' + area + '"/>' +
      prevLine +
      '<path class="rp-line" d="' + line + '" vector-effect="non-scaling-stroke"/>' +
      '</svg>' +
      '<span class="rp-ylab" style="top:' + Y0 + '%">' + compact(max) + '</span>' +
      '<span class="rp-guide" id="rp-guide" style="right:' + lastRight + '%"></span>' +
      '<span class="rp-dot" id="rp-dot" style="right:' + lastRight + '%;top:' + py(last.value || 0).toFixed(2) + '%"></span>' +
      '</div>' +
      '<div class="rp-axis">' + axis + '</div>' +
      '</section>'
    );
  }

  function snapshotHtml(count, avg, netProfit, returnsTotal, receipts, cmp) {
    const hasBaseline = !!(cmp && (cmp.previous.count || cmp.previous.netProfit));
    if (!count && !receipts && !netProfit && !returnsTotal && !hasBaseline) return '';
    return (
      '<section class="rp-card" aria-label="خلاصه عملکرد">' +
      '<div class="rp-stats rp-stats-2">' +
      '<div class="rp-stat"><div class="rp-stat-val">' + fa(count) + '</div><div class="rp-stat-lab">تعداد فاکتور</div>' + (cmp ? deltaTileHtml({ current: cmp.current.count, previous: cmp.previous.count, metric: 'count', label: cmp.label, short: true }) : '') + '</div>' +
      '<div class="rp-stat"><div class="rp-stat-val">' + compact(avg) + '</div><div class="rp-stat-lab">میانگین فاکتور</div></div>' +
      '<div class="rp-stat"><div class="rp-stat-val' + (netProfit < 0 ? ' is-neg' : '') + '">' + compact(netProfit) + '</div><div class="rp-stat-lab">سود خالص</div>' + (cmp ? deltaTileHtml({ current: cmp.current.netProfit, previous: cmp.previous.netProfit, metric: 'net', label: cmp.label, short: true }) : '') + '</div>' +
      '<div class="rp-stat"><div class="rp-stat-val">' + compact(receipts || 0) + '</div><div class="rp-stat-lab">دریافتی</div></div>' +
      '</div>' +
      (cmp ? '<div class="rp-note">مقایسه با ' + cmp.label + '</div>' : '') +
      '<div class="rp-note">سود خالص = سود فاکتورها − سود برگشتی‌ها (بهای خرید FIFO) − تخفیف‌های نقدی؛ همان تعریف «سود این ماه» داشبورد.</div>' +
      (returnsTotal > 0
        ? '<div class="rp-row rp-row-flat"><span>برگشت از فروش این دوره</span><span class="rp-row-val rp-neg">' + fullToman(returnsTotal) + '</span></div>'
        : '') +
      '</section>'
    );
  }

  function topProductsHtml(res, profit, opts) {
    opts = opts || {};
    const limit = opts.all ? profit.rows.length : 5;
    const prevByKey = {};
    if (opts.prev) opts.prev.rows.forEach(function (r) { prevByKey[r.productId || r.name] = r; });
    const deltaText = function (key, profitNow) {
      if (!opts.prev) return '';
      const pr = prevByKey[key];
      const model = describeNetChange(profitNow, pr ? pr.profit : 0, opts.label);
      const short = model.text.replace(/ نسبت به .*$/, '').split('؛')[0];
      return ' · <span class="rp-delta' + (model.cls ? ' ' + model.cls : '') + '">' + (model.arrow || '') + esc(short) + '</span>';
    };
    const byProfit = reportProductSort === 'profit';
    let list;
    let key;
    if (byProfit) {
      list = profit.rows.slice().sort(function (a, b) { return b.profit - a.profit; }).slice(0, limit);
      key = 'profit';
    } else {
      const byKey = {};
      profit.rows.forEach(function (r) { byKey[r.productId || r.name] = r; });
      list = res.top.map(function (p) {
        const pr = byKey[p.productId || p.name] || { profit: 0, margin: null };
        return { name: p.name, revenue: p.revenue, profit: pr.profit, margin: pr.margin, key: p.productId || p.name };
      });
      key = 'revenue';
    }
    if (!list.length) return '';
    const max = Math.max.apply(null, list.map(function (p) { return Math.abs(p[key]); })) || 1;
    const seg =
      '<div class="rp-seg rp-seg-sm" role="tablist" aria-label="ترتیب کالاها">' +
      '<button type="button" role="tab" class="rp-seg-btn' + (!byProfit ? ' is-active' : '') + '" aria-selected="' + (!byProfit) + '" data-pp="sales">بر اساس فروش</button>' +
      '<button type="button" role="tab" class="rp-seg-btn' + (byProfit ? ' is-active' : '') + '" aria-selected="' + byProfit + '" data-pp="profit">بر اساس سود</button>' +
      '</div>';
    return (
      '<section class="rp-card" aria-label="پرفروش‌ترین کالاها">' +
      '<div class="rp-sec-head"><h3 class="rp-sec-title">پرفروش‌ترین کالاها</h3></div>' +
      seg +
      '<div class="rp-bars">' +
      list
        .map(function (p) {
          const w = Math.max(3, Math.round((Math.abs(p[key]) / max) * 100));
          const margin = p.margin === null || p.margin === undefined ? '—' : faNum(p.margin, 1) + '٪';
          const sub = 'سود ' + compact(p.profit) + ' · حاشیه ' + margin;
          const delta = deltaText(p.key || p.productId || p.name, p.profit);
          return (
            '<div class="rp-bar">' +
            '<div class="rp-bar-top"><span class="rp-bar-name">' +
            esc(p.name) +
            '</span><span class="rp-bar-amt">' +
            compact(p[key]) +
            '</span></div>' +
            '<div class="rp-note" style="margin:0 0 4px">' + esc(sub) + delta + '</div>' +
            '<div class="rp-bar-track"><div class="rp-bar-fill" style="width:' +
            w +
            '%"></div></div></div>'
          );
        })
        .join('') +
      '</div>' +
      (profit.rows.length > 5
        ? '<div class="rp-more"><button type="button" class="btn secondary small" data-pp-all="1" aria-expanded="' + (opts.all ? 'true' : 'false') + '">' +
          (opts.all ? 'نمایش ۵ کالای برتر' : 'نمایش همه (' + faNum(profit.rows.length, 0) + ' کالا)') + '</button></div>'
        : '') +
      (res.appliedReturns || res.returnsWithoutItems
        ? '<div class="rp-note">مبالغ پس از کسر برگشتی‌های ثبت‌شده با ردیف کالا است' +
          (res.returnsWithoutItems ? ' (برگشتی‌های بدون ردیف کالا در این رتبه‌بندی لحاظ نشده‌اند).' : '.') +
          '</div>'
        : '') +
      '</section>'
    );
  }

  function customersHtml(topList, netTotal, debtorCount, customerDebt) {
    const rows = topList.length
      ? '<div class="rp-list">' +
        topList
          .map(function (x, idx) {
            const share = netTotal > 0 ? Math.round((x.net / netTotal) * 100) : null;
            return (
              '<a class="rp-row rp-link" href="#/customer?id=' +
              encodeURIComponent(x.c.id) +
              '"><span class="rp-rank">' +
              fa(idx + 1) +
              '</span><span class="rp-row-main"><span class="rp-row-title">' +
              esc(x.c.name) +
              '</span>' +
              (share !== null ? '<span class="rp-row-sub">سهم ' + fa(share) + '٪ از فروش دوره</span>' : '') +
              '</span><span class="rp-row-val">' +
              compact(x.net) +
              '</span><span class="rp-chev" aria-hidden="true">' +
              CHEVRON_SVG +
              '</span></a>'
            );
          })
          .join('') +
        '</div>'
      : '';
    return (
      '<section class="rp-card" aria-label="مشتریان">' +
      '<div class="rp-sec-head"><h3 class="rp-sec-title">مشتریان</h3>' +
      (topList.length ? '<span class="rp-sec-hint">۵ مشتری برتر دوره</span>' : '') +
      '</div>' +
      '<div class="rp-stats rp-stats-2">' +
      '<div class="rp-stat"><div class="rp-stat-val' + (customerDebt > 0 ? ' is-neg' : '') + '">' + compact(customerDebt) + '</div><div class="rp-stat-lab">مجموع مطالبات (اکنون)</div></div>' +
      '<div class="rp-stat"><div class="rp-stat-val">' + fa(debtorCount) + '</div><div class="rp-stat-lab">مشتری بدهکار</div></div>' +
      '</div>' +
      rows +
      '</section>'
    );
  }

  function collectionsHtml(received, byMethod, debtorCount, customerDebt, topDebtors) {
    const methodRows = [
      ['cash', 'نقد'],
      ['card', 'کارت'],
      ['transfer', 'انتقال'],
    ]
      .filter(function (m) {
        return byMethod[m[0]] > 0;
      })
      .map(function (m) {
        return '<div class="rp-row rp-row-flat"><span>' + m[1] + '</span><span class="rp-row-val">' + fullToman(byMethod[m[0]]) + '</span></div>';
      })
      .join('');
    const debtorRows = topDebtors.length
      ? '<div class="rp-sub-title">بیشترین مطالبات</div>' +
        topDebtors
          .map(function (x) {
            return (
              '<a class="rp-row rp-link" href="#/customer?id=' +
              encodeURIComponent(x.c.id) +
              '"><span class="rp-row-main"><span class="rp-row-title">' +
              esc(x.c.name) +
              '</span></span><span class="rp-row-val rp-neg">' +
              compact(x.t.balance) +
              '</span><span class="rp-chev" aria-hidden="true">' +
              CHEVRON_SVG +
              '</span></a>'
            );
          })
          .join('')
      : '';
    return (
      '<section class="rp-card" aria-label="وصول و مطالبات">' +
      '<div class="rp-sec-head"><h3 class="rp-sec-title">وصول و مطالبات</h3></div>' +
      '<div class="rp-row rp-row-flat"><span>مجموع مطالبات مشتریان <small>(اکنون)</small></span><span class="rp-row-val' + (customerDebt > 0 ? ' rp-neg' : '') + '">' + fullToman(customerDebt) + '</span></div>' +
      '<div class="rp-row rp-row-flat"><span>دریافت ' + esc(PERIOD_LABEL[reportPeriod]) + ' <small>(نقد، کارت، انتقال)</small></span><span class="rp-row-val">' + fullToman(received) + '</span></div>' +
      '<div class="rp-row rp-row-flat"><span>تعداد بدهکاران</span><span class="rp-row-val">' + fa(debtorCount) + '</span></div>' +
      (methodRows || debtorRows
        ? '<details class="rp-inner" data-rp-details="receipts"' +
          (openState.receipts ? ' open' : '') +
          '><summary>جزئیات<span class="rp-sum-chev" aria-hidden="true">' +
          CHEVRON_SVG +
          '</span></summary>' +
          (methodRows ? '<div class="rp-sub-title">دریافت بر اساس روش</div>' + methodRows : '') +
          debtorRows +
          '</details>'
        : '') +
      '</section>'
    );
  }

  function inventoryHtml(invVal, low, zero, negative) {
    const exceptions = [];
    if (negative.length) exceptions.push(['موجودی منفی', negative.length, 'is-danger']);
    if (zero.length) exceptions.push(['ناموجود', zero.length, '']);
    if (low.length) exceptions.push(['کم‌موجود', low.length, 'is-warn']);
    return (
      '<section class="rp-card" aria-label="وضعیت موجودی">' +
      '<div class="rp-sec-head"><h3 class="rp-sec-title">وضعیت موجودی</h3><a class="rp-sec-link" href="#/inventory">مشاهده جزئیات</a></div>' +
      '<div class="rp-row rp-row-flat"><span>ارزش موجودی <small>(تعداد × بهای خرید)</small></span><span class="rp-row-val">' + fullToman(invVal) + '</span></div>' +
      (exceptions.length
        ? exceptions
            .map(function (e) {
              return (
                '<a class="rp-row rp-link" href="#/inventory"><span class="rp-row-main"><span class="rp-row-title">' +
                e[0] +
                '</span></span><span class="rp-badge ' +
                e[2] +
                '">' +
                fa(e[1]) +
                ' کالا</span><span class="rp-chev" aria-hidden="true">' +
                CHEVRON_SVG +
                '</span></a>'
              );
            })
            .join('')
        : '<div class="rp-ok">همه کالاها در وضعیت عادی هستند.</div>') +
      '</section>'
    );
  }

  function fieldHtml(vs) {
    if (!vs.visits) return '';
    const canRate = vs.linkedEver > 0;
    return (
      '<section class="rp-card" aria-label="عملکرد ویزیت">' +
      '<div class="rp-sec-head"><h3 class="rp-sec-title">عملکرد ویزیت</h3><a class="rp-sec-link" href="#/visits">ویزیت‌ها</a></div>' +
      '<div class="rp-stats' + (canRate ? '' : ' rp-stats-1') + '">' +
      '<div class="rp-stat"><div class="rp-stat-val">' + fa(vs.visits) + '</div><div class="rp-stat-lab">ویزیت</div></div>' +
      (canRate
        ? '<div class="rp-stat"><div class="rp-stat-val">' + fa(vs.linked) + '</div><div class="rp-stat-lab">منجر به فاکتور</div></div>' +
          '<div class="rp-stat"><div class="rp-stat-val">' + fa(Math.round((vs.linked / vs.visits) * 100)) + '٪</div><div class="rp-stat-lab">نرخ تبدیل</div></div>'
        : '') +
      '</div>' +
      '<div class="rp-note">' +
      (canRate
        ? 'فقط فاکتورهایی که هنگام ثبت به همان ویزیت وصل شده‌اند شمرده می‌شوند؛ فاکتورهای بدون اتصال به ویزیت نسبت داده نمی‌شوند.'
        : 'هنوز فاکتوری به ویزیت وصل نشده؛ نرخ تبدیل قابل محاسبه نیست.') +
      '</div>' +
      '</section>'
    );
  }

  function financialHtml(g, received, topSuppliers) {
    const rows =
      '<div class="rp-row rp-row-flat"><span>سود کل <small>(از ابتدا، با احتساب برگشتی‌ها)</small></span><span class="rp-row-val">' + fullToman(g.totalProfit) + '</span></div>' +
      '<div class="rp-row rp-row-flat"><span>دریافتی ' + esc(PERIOD_LABEL[reportPeriod]) + '</span><span class="rp-row-val">' + fullToman(received) + '</span></div>' +
      '<a class="rp-row rp-link" href="#/checks"><span class="rp-row-main"><span class="rp-row-title">چک‌های در جریان</span></span><span class="rp-row-val">' + fullToman(g.outstandingChecks) + '</span><span class="rp-chev" aria-hidden="true">' + CHEVRON_SVG + '</span></a>' +
      '<a class="rp-row rp-link" href="#/suppliers"><span class="rp-row-main"><span class="rp-row-title">بدهی به تأمین‌کنندگان</span></span><span class="rp-row-val' + (g.supplierDebt > 0 ? ' rp-neg' : '') + '">' + fullToman(g.supplierDebt) + '</span><span class="rp-chev" aria-hidden="true">' + CHEVRON_SVG + '</span></a>' +
      (topSuppliers.length
        ? '<div class="rp-sub-title">بیشترین بدهی تأمین‌کننده</div>' +
          topSuppliers
            .map(function (x) {
              return (
                '<a class="rp-row rp-link" href="#/supplier?id=' +
                encodeURIComponent(x.s.id) +
                '"><span class="rp-row-main"><span class="rp-row-title">' +
                esc(x.s.name) +
                '</span></span><span class="rp-row-val rp-neg">' +
                compact(x.t.balance) +
                '</span><span class="rp-chev" aria-hidden="true">' +
                CHEVRON_SVG +
                '</span></a>'
              );
            })
            .join('')
        : '');
    return (
      '<details class="rp-card rp-details" data-rp-details="financial"' +
      (openState.financial ? ' open' : '') +
      '><summary><span class="rp-sec-title">مالی و تأمین</span><span class="rp-sum-chev" aria-hidden="true">' +
      CHEVRON_SVG +
      '</span></summary><div class="rp-details-body">' +
      rows +
      '</div></details>'
    );
  }

  function linksHtml() {
    const items = [
      ['همه فاکتورها', '#/invoices'],
      ['همه مشتریان', '#/customers'],
      ['همه کالاها', '#/products'],
      ['جزئیات موجودی', '#/inventory'],
      ['جزئیات دریافت‌ها', '#/payments'],
    ];
    return (
      '<section class="rp-card" aria-label="جزئیات">' +
      '<div class="rp-sec-head"><h3 class="rp-sec-title">جزئیات</h3></div>' +
      items
        .map(function (it) {
          return (
            '<a class="rp-row rp-link" href="' +
            it[1] +
            '"><span class="rp-row-main"><span class="rp-row-title">' +
            it[0] +
            '</span></span><span class="rp-chev" aria-hidden="true">' +
            CHEVRON_SVG +
            '</span></a>'
          );
        })
        .join('') +
      '</section>'
    );
  }

  /* ------------------------------------------------------------------ */
  /* Page body                                                           */
  /* ------------------------------------------------------------------ */
  function renderBody() {
    const body = document.getElementById('reports-body');
    if (!body) return;

    const now = new Date();
    const invsAll = data.invoices || [];
    const invsPeriod = invsAll.filter(function (i) {
      return dateInPeriod(i.date, reportPeriod, now);
    });
    const periodSales = invsPeriod.reduce(function (s, i) {
      return s + (i.total || 0);
    }, 0);
    const periodCount = invsPeriod.length;
    const periodAvg = periodCount ? periodSales / periodCount : 0;
    /* One rule for every return figure on this page: a return belongs to the period of its
       PAYMENT date (the dashboard KPI rule). Product bars, customer totals, the returns line
       and the profit all read the same list. */
    /* Receipts of the period: cash, card and transfer payments (same definition as the dashboard
       «دریافتی»). Returns and cash discounts are excluded; invoice-linked receipts are included. */
    const periodReceipts = (data.payments || []).reduce(function (sum, p) {
      return p && ['cash','card','transfer'].indexOf(p.method) !== -1 && dateInPeriod(p.date, reportPeriod, now)
        ? sum + (Number(p.amount) || 0) : sum;
    }, 0);
    const retPaysPeriod = (data.payments || []).filter(function (p) {
      return p && p.method === 'return' && dateInPeriod(p.date, reportPeriod, now);
    });
    const returns = retPaysPeriod;
    const discountTotal = (data.payments || []).reduce(function (s, p) {
      return p && p.method === 'discount' && dateInPeriod(p.date, reportPeriod, now) ? s + (Number(p.amount) || 0) : s;
    }, 0);
    const profitRes = productProfitRows(invsPeriod, retPaysPeriod, discountTotal);
    /* Same product profit for the previous equivalent span (for per-product change). */
    const prevTest = (reportPeriod === 'today' || reportPeriod === 'all') ? null : createPreviousPeriodPredicate(reportPeriod, now);
    const prevProfitRes = prevTest ? productProfitRows(
      (data.invoices || []).filter(function (i) { return prevTest(i.date); }),
      (data.payments || []).filter(function (p) { return p && p.method === 'return' && prevTest(p.date); }),
      (data.payments || []).reduce(function (s, p) { return p && p.method === 'discount' && prevTest(p.date) ? s + (Number(p.amount) || 0) : s; }, 0)
    ) : null;
    const prevLabel = reportPeriod === 'range' ? 'بازهٔ قبل' : reportPeriod === 'week' ? 'همین روزهای هفتهٔ قبل' : 'همین بازه از ماه قبل';
    const periodNetProfit = profitRes.netTotal;
    const comparison = (reportPeriod === 'today' || reportPeriod === 'all') ? null
      : buildPeriodComparison(reportPeriod, now);


    const returnsTotal = returns.reduce(function (s, p) {
      return s + (p.amount || 0);
    }, 0);

    const g = globalTotals();

    // دریافتی دوره: cash/card/transfer filtered by payment.date (same rule as globalTotals().totalReceived)
    const byMethod = { cash: 0, card: 0, transfer: 0 };
    (data.payments || []).forEach(function (p) {
      if (!p || !Object.prototype.hasOwnProperty.call(byMethod, p.method)) return;
      if (!dateInPeriod(p.date, reportPeriod, now)) return;
      byMethod[p.method] += p.amount || 0;
    });
    const received = byMethod.cash + byMethod.card + byMethod.transfer;

    const trend = buildTrend(reportPeriod, now, invsAll);
    const prevSum = reportPeriod === 'range' && reportRange
      ? invsAll.filter(function (i) { return inRange(i.date, prevRangeOf(reportRange)); })
          .reduce(function (s, i) { return s + (i.total || 0); }, 0)
      : null;
    const cmp = periodCount ? salesComparison(reportPeriod, now, periodSales, trend, prevSum) : null;

    const topProd = topProductsForPeriod(invsPeriod, returns, reportProductsAll ? 100000 : 5);
    const topCust = topCustomersForPeriod(invsPeriod, returns, 5);
    const netSales = periodSales - returnsTotal;

    const debtors = debtorList(9999);
    const topDebtors = debtors.slice(0, 5);

    // Exceptions are mutually exclusive: negative < 0, zero == 0, low = 0 < qty ≤ minStock
    const products = data.products || [];
    const negative = products.filter(function (p) {
      return (p.stockQty || 0) < 0;
    });
    const zero = products.filter(function (p) {
      return (p.stockQty || 0) === 0;
    });
    const low = lowStockProducts().filter(function (p) {
      return (p.stockQty || 0) > 0;
    });

    const topSuppliers = (data.suppliers || [])
      .map(function (s) {
        return { s: s, t: supplierTotals(s.id) };
      })
      .filter(function (x) {
        return x.t.balance > 0.5;
      })
      .sort(function (a, b) {
        return b.t.balance - a.t.balance;
      })
      .slice(0, 5);

    const vs = visitStats(reportPeriod, now);

    const ctx = document.getElementById('rp-context');
    if (ctx) ctx.textContent = contextText(reportPeriod, now, !!cmp);

    body.innerHTML =
      heroHtml(periodSales, periodCount, periodAvg, cmp) +
      (periodCount ? trendHtml(trend) : '') +
      snapshotHtml(periodCount, periodAvg, periodNetProfit, returnsTotal, periodReceipts, comparison) +
      (periodCount ? topProductsHtml(topProd, profitRes, { prev: prevProfitRes, label: prevLabel, all: reportProductsAll }) : '') +
      customersHtml(periodCount ? topCust : [], netSales, debtors.length, g.customerDebt) +
      collectionsHtml(received, byMethod, debtors.length, g.customerDebt, topDebtors) +
      inventoryHtml(inventoryValue(), low, zero, negative) +
      fieldHtml(vs) +
      financialHtml(g, received, topSuppliers) +
      linksHtml();

    if (!periodCount) chartState = null;
  }

  /* ------------------------------------------------------------------ */
  /* Chart interaction (tap / drag to read an exact value)               */
  /* ------------------------------------------------------------------ */
  function renderChartPoint(wrap, index) {
    if (!wrap || !chartState) return;
    const cs = chartState;
    const i = Math.max(0, Math.min(cs.n - 1, index));
    wrap.dataset.activeIndex = String(i);
    const p = cs.points[i];
    const rightPct = 100 - cs.X1 + i * cs.step;
    const topPct = cs.Y1 - ((p.value || 0) / cs.max) * (cs.Y1 - cs.Y0);
    const guide = document.getElementById('rp-guide');
    const dot = document.getElementById('rp-dot');
    const ro = document.getElementById('rp-readout');
    if (guide) guide.style.right = rightPct.toFixed(2) + '%';
    if (dot) {
      dot.style.right = rightPct.toFixed(2) + '%';
      dot.style.top = topPct.toFixed(2) + '%';
    }
    if (ro) ro.innerHTML = '<span class="rp-readout-title">' + esc(p.title) + '</span><span class="rp-readout-val">' + fullToman(p.value || 0) + '</span>';
  }

  function onChartPointer(e) {
    const wrap = e.target && e.target.closest ? e.target.closest('#rp-chart') : null;
    if (!wrap || !chartState) return;
    if (e.pointerType === 'mouse' && e.type === 'pointermove' && e.buttons === 0) return;
    const rect = wrap.getBoundingClientRect();
    if (!rect.width) return;
    const cs = chartState;
    const fromRight = ((rect.right - e.clientX) / rect.width) * 100;
    const i = Math.round((fromRight - (100 - cs.X1)) / cs.step);
    renderChartPoint(wrap, i);
  }

  function onChartKeydown(e) {
    const wrap = e.target && e.target.closest ? e.target.closest('#rp-chart') : null;
    if (!wrap || !chartState) return;
    const current = Number(wrap.dataset.activeIndex || 0);
    let next = current;
    if (e.key === 'ArrowLeft') next = current + 1;
    else if (e.key === 'ArrowRight') next = current - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = chartState.n - 1;
    else return;
    e.preventDefault();
    renderChartPoint(wrap, next);
  }

  /* ------------------------------------------------------------------ */
  /* Mount                                                               */
  /* ------------------------------------------------------------------ */
  function drawPage(root) {
    root.innerHTML =
      '<div class="rp-page">' +
      '<div class="rp-top">' +
      segHtml() +
      '<div class="rp-context" id="rp-context"></div>' +
      '</div>' +
      '<div id="reports-body" class="rp-body"></div>' +
      '</div>';

    rootClickHandler = function (e) {
      const all = e.target.closest ? e.target.closest('[data-pp-all]') : null;
      if (all) {
        reportProductsAll = !reportProductsAll;
        renderBody();
        return;
      }
      const pp = e.target.closest ? e.target.closest('[data-pp]') : null;
      if (pp) {
        reportProductSort = pp.getAttribute('data-pp') === 'profit' ? 'profit' : 'sales';
        renderBody();
        return;
      }
      const btn = e.target.closest ? e.target.closest('[data-rp]') : null;
      if (!btn) return;
      reportPeriod = btn.getAttribute('data-rp');
      const seg = root.querySelector('.rp-seg');
      const bar = root.querySelector('#rp-range');
      if (reportPeriod === 'range') {
        if (!bar && seg) seg.insertAdjacentHTML('afterend', rangeBarHtml());
      } else if (bar) {
        bar.remove();
      }
      root.querySelectorAll('.rp-seg-btn').forEach(function (b) {
        const on = b.getAttribute('data-rp') === reportPeriod;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      renderBody();
    };
    if (typeof window !== 'undefined' && window.__rpTest) {
      window.__rpDebug = { productProfitRows: productProfitRows, periodInvoiceGrossProfit: periodInvoiceGrossProfit, topProductsForPeriod: topProductsForPeriod, periodReturns: periodReturns, invoiceDiscountAmount: invoiceDiscountAmount };
    }
    root.addEventListener('click', rootClickHandler);
    root.addEventListener('change', function (e) {
      const t = e.target;
      if (!t || (t.id !== 'rp-range-from' && t.id !== 'rp-range-to')) return;
      if (!reportRange) reportRange = rangeDefault();
      const next = { from: t.id === 'rp-range-from' ? t.value : reportRange.from,
                     to: t.id === 'rp-range-to' ? t.value : reportRange.to };
      if (!next.from || !next.to || next.from > next.to) {
        showToast('تاریخ پایان نمی‌تواند قبل از تاریخ شروع باشد', { type: 'error' });
        const bar = document.getElementById('rp-range');
        if (bar) bar.outerHTML = rangeBarHtml();  /* redraw the pickers with the saved dates */
        return;
      }
      reportRange = next;
      renderBody();
    });

    // <details> 'toggle' does not bubble → capture, so open/closed state survives re-renders
    rootToggleHandler = function (e) {
      const d = e.target;
      if (!d || !d.getAttribute) return;
      const k = d.getAttribute('data-rp-details');
      if (k && Object.prototype.hasOwnProperty.call(openState, k)) openState[k] = !!d.open;
    };
    root.addEventListener('toggle', rootToggleHandler, true);

    chartPointerHandler = onChartPointer;
    root.addEventListener('pointerdown', chartPointerHandler);
    root.addEventListener('pointermove', chartPointerHandler);
    root.addEventListener('keydown', onChartKeydown);

    renderBody();
  }

  function mount(root, params) {
    if (!root) return function () {};
    let refreshToken = null;
    const fab = document.getElementById('fab');
    if (fab) {
      fab.style.display = 'none';
      fab.onclick = null;
    }
    const nav = document.getElementById('nav');
    if (nav) nav.style.display = '';

    openState = { receipts: false, financial: false };
    drawPage(root);

    // Mutation → render() → ViewHost.refreshCurrent() refreshes the body while still on Reports
    if (typeof ViewHost !== 'undefined' && ViewHost.setRefresh) {
      refreshToken = ViewHost.setRefresh(function () {
        renderBody();
      });
    }

    return function unmount() {
      if (typeof ViewHost !== 'undefined' && ViewHost.clearRefresh) {
        ViewHost.clearRefresh(refreshToken);
      }
      refreshToken = null;
      try {
        if (rootClickHandler) root.removeEventListener('click', rootClickHandler);
        if (rootToggleHandler) root.removeEventListener('toggle', rootToggleHandler, true);
        if (chartPointerHandler) {
          root.removeEventListener('pointerdown', chartPointerHandler);
          root.removeEventListener('pointermove', chartPointerHandler);
        }
        root.removeEventListener('keydown', onChartKeydown);
      } catch (e) {}
      rootClickHandler = rootToggleHandler = chartPointerHandler = null;
      chartState = null;
      root.innerHTML = '';
    };
  }

  global.ReportsView = { mount: mount, unmount: function () {} };
})(typeof window !== 'undefined' ? window : this);
