# Action Engine Ack Patch — v18 base

## Scope

Changed only:
- `js/intelligence/action.js`
- `js/intelligence/watch_lifecycle.js`
- `js/app.js`

Added QA harness: `tests/action-ack/run.js`.
No changes to `js/calc.js`, `js/stock.js`, `js/db.js`, invoice math, inventory mutation, FIFO allocation, `sales30`, or `salesPrev30` implementations.

## Behavior

- Action acknowledgements are stored under localStorage key `bagheri_action_ack_v1`, indexed by `customerId|signalTopic`.
- Ack filtering happens in `_pickActionSignal` after existing pending and seasonality filters.
- Visits without offered products acknowledge only customer-level `purchase_decline` and `behind_pattern` topics.
- Visits with offered products acknowledge only product-family topics corresponding to those products.
- New invoices acknowledge `purchase_decline` and the product-family topics represented by invoice items.
- Customer payments acknowledge `payment_overdue`; sales-return records are excluded.
- Manual Watch dismiss records a separate dismiss response and action acknowledgement while retaining the prior Watch reason/comment.
- Watch rows are not deleted by Action acknowledgement filtering.
- Cooldown windows: no_order 3 days; ordered 7; invoice_created 5; payment 7; dismissed 14; deferred 5.
- If a signal has no recognized topic / cannot be scoped safely, no Ack is written and it is not suppressed.

## Code-diff counts

Compared with the supplied v18 ZIP:
- `js/intelligence/action.js`: 130 added lines, 2 removed lines.
- `js/intelligence/watch_lifecycle.js`: 12 added lines, 2 removed lines.
- `js/app.js`: 11 added lines, 0 removed lines.
- Total: 153 added, 4 removed (157 changed lines by diff counting).

## Tests

`node tests/action-ack/run.js`: 11/11 PASS.
`node tests/limited-history/run.js`: 78/78 PASS.
`node --check` passed for all three changed JavaScript files.

`python tests/invoice-fixes/run.py` could not start because Playwright Chromium is not installed in this runtime. This is an environment limitation, not a test assertion failure. Consequently, a full browser/iPhone regression run is NOT PROVABLE here.

## Limitations / evidence boundaries

- No existing customer-call recording/persistence event was found in the source (`call` is an action recommendation type, not a recorded event), so call Acks are not fabricated.
- Watch dismissal mapping is made only for Watch categories with explicit category mapping. If a Watch category cannot be mapped to a concrete Action topic, it does not create an Ack.
- Acks are UI/operational state in localStorage and do not change the CRM database schema or accounting data.


## Follow-up patch: visit subject classification and final cooldowns

- `no_order`: 5 days; `ordered`: 7 days; `invoice_created`: 5 days; `payment`: 7 days; `dismissed`: 7 days; `deferred`: 5 days.
- A visit without `offeredProducts` now creates customer-level Acks only when persisted `result`, `note`, or `nextAction` explicitly identifies purchase decline / behind-pattern. The exact result `سفارش گرفته نشد` acknowledges both customer-level topics unless an explicitly unrelated payment/check/invoice/information-gathering subject is present. Unknown subjects fail closed.
- A visit with offered products acknowledges only related product/family topics. `ordered` is taken from the real persisted field; absence of products is not treated as absence of an order.
- Action Ack test suite expanded to 16 checks; all pass under Node.js.
- No financial, FIFO, inventory, invoice-calculation, or sales-window source files changed. Browser/iPhone runtime testing remains not performed in this environment.
