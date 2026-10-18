/* js/computation-bank.js — execution-scoped derived-data bank.
 *
 * A context is created at the start of a render/reconcile execution and
 * discarded when that execution finishes. It never writes to storage and it
 * never survives a data refresh. The small public surface is intentional:
 * callers pass the context explicitly to pure calculation layers.
 */
'use strict';

var RECEIVABLE_ATTENTION_DEFAULTS = {
  amountFloor: 10000000,
  daysFloor: 10
};

(function (global) {
  function createComputationContext(options) {
    options = options || {};
    var source = options.data || global.data || {};
    var values = Object.create(null);

    function memo(bucket, key, producer) {
      var group = values[bucket];
      if (!group) group = values[bucket] = Object.create(null);
      var normalized = String(key == null ? '__default__' : key);
      if (Object.prototype.hasOwnProperty.call(group, normalized)) return group[normalized];
      var value = producer();
      group[normalized] = value;
      return value;
    }

    var ctx = {
      data: source,
      values: values,
      memo: memo,
      aggregatePairMapCache: Object.create(null),

      customerInvoices: function (cid) {
        return memo('customerInvoices', cid, function () {
          return (source.invoices || []).filter(function (row) {
            return row && row.customerId === cid;
          });
        });
      },
      customerPayments: function (cid) {
        return memo('customerPayments', cid, function () {
          return (source.payments || []).filter(function (row) {
            return row && row.customerId === cid;
          });
        });
      },
      customerChecks: function (cid) {
        return memo('customerChecks', cid, function () {
          return (source.checks || []).filter(function (row) {
            return row && row.customerId === cid;
          });
        });
      },
      customerById: function (cid) {
        return memo('customerById', cid, function () {
          return (source.customers || []).find(function (row) {
            return row && row.id === cid;
          }) || null;
        });
      },
      productById: function (pid) {
        return memo('productById', pid, function () {
          return (source.products || []).find(function (row) {
            return row && row.id === pid;
          }) || null;
        });
      },
      receivableAttention: function (opts) {
        opts = opts || {};
        var amountFloor = Number.isFinite(Number(opts.amountFloor))
          ? Number(opts.amountFloor)
          : RECEIVABLE_ATTENTION_DEFAULTS.amountFloor;
        var daysFloor = Number.isFinite(Number(opts.daysFloor))
          ? Number(opts.daysFloor)
          : RECEIVABLE_ATTENTION_DEFAULTS.daysFloor;
        var memoKey = amountFloor + '|' + daysFloor;

        return memo('receivableAttention', memoKey, function () {
          var out = { count: 0, totalBalance: 0, rows: [], byCustomerId: {} };
          var customers = Array.isArray(source.customers) ? source.customers : [];

          for (var i = 0; i < customers.length; i++) {
            var c = customers[i];
            if (!c || c.active === false) continue;

            var t = null;
            try {
              t = (typeof customerTotals === 'function')
                ? customerTotals(c.id, ctx)
                : null;
            } catch (e) { t = null; }
            if (!t || !(t.balance >= amountFloor)) continue;

            var today = (typeof todayISO === 'function') ? todayISO() : new Date().toISOString().slice(0, 10);
            var invoices = (ctx.customerInvoices(c.id) || []).filter(function (inv) { return inv && inv.date; })
              .sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
            var latestInv = invoices[0] || null;
            var pays = (ctx.customerPayments(c.id) || []).filter(function (pay) {
              return pay && pay.date && ['cash', 'card', 'transfer'].indexOf(pay.method) !== -1;
            }).sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
            var checks = (ctx.customerChecks(c.id) || []).filter(function (ch) { return ch && ch.status === 'cleared' && (ch.dueDate || ch.date); })
              .sort(function (a, b) { return String(b.dueDate || b.date).localeCompare(String(a.dueDate || a.date)); });
            var latestPayment = pays[0] || null;
            var latestClearedCheck = checks[0] || null;
            var paidDate = latestPayment ? String(latestPayment.date) : null;
            if (latestClearedCheck) {
              var clearedDate = String(latestClearedCheck.dueDate || latestClearedCheck.date);
              if (!paidDate || clearedDate > paidDate) paidDate = clearedDate;
            }

            var refDate = null, refKind = 'payment', days = null, age = null;
            var paymentAfterInvoice = !!(latestPayment && (!latestInv || String(latestPayment.date) >= String(latestInv.date)));
            var explicitFollowUp = paymentAfterInvoice && latestPayment && latestPayment.followUpDate
              ? String(latestPayment.followUpDate).slice(0, 10) : null;

            // A seller-selected follow-up date supersedes the old payment cycle.
            // It becomes actionable only on/after that date; no duplicate earlier reminder.
            if (explicitFollowUp && /^\d{4}-\d{2}-\d{2}$/.test(explicitFollowUp)) {
              age = (typeof daysAgo === 'function') ? daysAgo(explicitFollowUp) : null;
              if (age == null || !isFinite(age) || age < 0) continue;
              refDate = explicitFollowUp; refKind = 'scheduled_followup'; days = Math.round(age);
            } else if (latestInv && (!paidDate || String(latestInv.date) >= paidDate)) {
              // New invoice resets the follow-up cycle. Respect an explicit dueDate;
              // otherwise apply a 10-day grace from invoice date.
              if (latestInv.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(String(latestInv.dueDate).slice(0, 10))) {
                refDate = String(latestInv.dueDate).slice(0, 10); refKind = 'invoice_due';
                age = (typeof daysAgo === 'function') ? daysAgo(refDate) : null;
                if (age == null || !isFinite(age) || age < 0) continue;
                days = Math.round(age);
              } else {
                refDate = String(latestInv.date).slice(0, 10); refKind = 'no_payment_history';
                age = (typeof daysAgo === 'function') ? daysAgo(refDate) : null;
                if (age == null || !isFinite(age) || age < daysFloor) continue;
                days = Math.round(age);
              }
            } else {
              // After a payment (or with no newer invoice), allow 10 days unless
              // the seller chose an explicit follow-up date above.
              var anchor = paidDate || (latestInv && String(latestInv.date));
              if (!anchor) continue;
              age = (typeof daysAgo === 'function') ? daysAgo(anchor) : null;
              if (age == null || !isFinite(age) || age < daysFloor) continue;
              refDate = anchor; refKind = latestPayment ? 'payment' : 'no_payment_history'; days = Math.round(age);
            }
            if (days == null || !isFinite(days)) continue;

            var row = {
              customerId: c.id,
              name: c.name || '—',
              balance: t.balance,
              refDate: refDate,
              refKind: refKind,
              daysSince: Math.round(days),
              dueDate: refDate,
              followUpDate: refKind === 'scheduled_followup' ? refDate : null
            };
            out.rows.push(row);
            out.byCustomerId[c.id] = row;
          }

          out.rows.sort(function (a, b) {
            return b.balance - a.balance
              || b.daysSince - a.daysSince
              || String(a.name).localeCompare(String(b.name), 'fa');
          });
          out.count = out.rows.length;
          out.totalBalance = out.rows.reduce(function (s, r) { return s + r.balance; }, 0);
          return out;
        });
      }
    };

    return ctx;
  }

  global.createComputationContext = createComputationContext;
})(typeof window !== 'undefined' ? window : this);