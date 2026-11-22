# BAGHERI CRM — Stage 2 UX Change Report

## Baseline
- Source: `BAGHERI-CRM-stage1-ios-ui.zip` (the delivered Stage 1 build).
- Scope: presentation, navigation, sheet interaction, accessibility, chart/table presentation only.
- No accounting, FIFO, stock, check, allocation, backup, IndexedDB schema, or financial calculation code was changed.

## Changes

### 1. Button consistency
- Unified `.btn` geometry, typography, alignment, radius, disabled state, and touch feedback.
- Standardized common action controls and segmented controls to at least 44px target height where applicable (invoice header actions, report/game segmented controls, Quick View actions, promise actions, and dashboard quick actions).
- Added consistent keyboard focus indicators, including dark-theme focus contrast.

### 2. Empty / Loading / Error
- Empty states receive polite live-region semantics; existing `role="alert"` states announce assertively.
- Error empty states use the semantic danger token rather than an amber hard-coded color.
- Added a shared spinner treatment for `aria-busy` empty states and loading buttons.
- The CRM data-load retry button now exposes its loading state with `aria-busy` and a spinner.
- Toast messages expose a polite live region.

### 3. Navigation and Sheets
- Generic sheets are exposed as modal dialogs, labelled from their heading when available.
- Added keyboard Tab focus containment, Escape dismissal (respecting the existing dirty-form guard), initial focus, and focus restoration after closing.
- Generic sheet re-renders update the dialog's accessible name.
- Confirmation dialogs now have an accessible name, focus containment, Escape-to-cancel, and focus restoration.
- The More sheet now has keyboard focus containment, Escape dismissal, and focus restoration; its decorative icons are hidden from assistive technology.
- Bottom navigation has a clearer accessible label; active destinations continue to use `aria-current="page"`.
- Corrected the generic sheet corner rule so the bottom sheet retains its raised top corners.

### 4. Customer Detail
- Removed the disclosure accordion around «سایر عملیات»; all five secondary actions are visible in the existing two-column action layout.
- Moved «تصمیم‌های ثبت‌شده»، «کالاهای ردشده» and closed payment/delivery promise histories off the overview into dedicated customer push pages. The overview now uses navigation rows rather than disclosure accordions for these sections.
- Kept existing action IDs and click handlers; no customer/accounting behavior was changed.
- Customer purchase trend chart now has an accessible image label.

### 5. Accessibility
- Added focus-visible treatment for keyboard-operable controls.
- Standardized common tap targets to 44px where practical.
- Added live-region semantics to empty/error states and toast messages.
- Added accessible names and focus management for sheets and confirmation dialogs.
- Added keyboard controls to the interactive sales trend chart: Left/Right, Home, End. Its changing readout is announced politely.
- Added table labels and column scopes to invoice and customer-statement preview tables.

### 6. Charts and Tables
- Preserved the chart's pointer/touch interaction and added keyboard parity.
- Improved preview-table spacing, row separators, and tabular number presentation; print output retains its previous table styling.

## Files changed
- `css/visual-grammar-components.css`
- `css/visual-grammar-pages.css`
- `index.html`
- `js/app.js` (table semantics only)
- `js/nav.js`
- `js/ui.js`
- `js/views/customer.js` (presentation/accessibility only)
- `js/views/payment-promises.js` (history presentation only)
- `js/views/delivery-promises.js` (history presentation only)
- `js/views/reports.js` (chart interaction/accessibility only)
- `sw.js` (cache version `v112` → `v113`)

No new CSS or JavaScript files were added.

## Verification
- JavaScript syntax: PASS for all JavaScript files.
- CSS brace-balance check: PASS for all 7 CSS files.
- Delivery Promises: 51 passed, 0 failed.
- One-off Customer: 21 passed, 0 failed.
- Payment Promises: 50 passed, 0 failed.
- Visit Plan: 28 passed, 0 failed.
- Watch/ACK Integrity: 56 passed, 0 failed.
- Quick View Summary: 18 passed, 3 failed. Failures: unknown stock/null state; product rejected then later purchased; last reaction deferred. The exact same three failures were reproduced against the Stage 1 source ZIP, confirming they pre-existed this stage and remain unchanged.
- `audit-v7_8`: not runnable because `tests/audit-v7_8/baqeri-backup-2026-10-27_2.json` is absent.
- A Chromium headless smoke attempt timed out in this environment, so no browser screenshot/interaction verification is claimed.
- Real Safari/iPhone 13 Pro Max verification remains outstanding.

## Confidence / limitations
The tested financial and promise suites passed, and the source diff is confined to the files and presentation changes listed above. This does not prove absence of visual regressions on the target iPhone. In particular, the sheet focus lifecycle, customer action layout, and report-chart keyboard behavior should receive a final on-device pass.
