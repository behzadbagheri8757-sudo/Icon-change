# BAGHERI CRM v117 — Changelog

مبنا: `BAGHERI-CRM-stage2-ui-followup-urgent-fix-candidate.zip` (دست‌نخورده؛ تغییرات روی کپی کاری).
هفت اصلاح رفتاری، فقط در لایهٔ تحلیل (Intelligence) و Restore. بدون تغییر CSS/UI، Schema، مالی، موجودی، Service Worker.

## ۱. زیرساخت تاریخ مشترک (`asOfDate`)
- `createComputationContext`: فیلد `ctx.asOfDate`؛ ترتیب: `options.asOfDate` > `options.referenceDate` (فقط سازگاری) > `todayISO()` > تاریخ سیستم. تاریخ نامعتبر نادیده گرفته می‌شود؛ مقدار به روز `YYYY-MM-DD` نرمال می‌شود.
- helperهای مشترک (`computation-bank.js`): `analysisDaysAgo(iso, ctx)` (تفاضل روز تقویمی با `Date.UTC`، اعتبار تقویمی واقعی، نامعتبر → `null`، آینده → منفی)، `analysisToday(ctx)`، `analysisISODaysAgo(n, ctx)`.
- `referenceDate` در baseline SKU (تاریخ آخرین خرید منبع) **عوض نشد**.
- `ctx.memo` تاریخ جاری context را هنگام فراخوانی در کلید می‌گذارد (A→B→A درست است). indexهای خام (`customerInvoices`, `customerPayments`, `customerChecks`, `activePromise`, `customerById`, `productById`) با `memoStable` بدون وابستگی به تاریخ ماندند.
- مسیرهای تاریخ‌پذیر: فاصله از آخرین خرید (با clamp به ۰ مطابق رفتار قبلی)، `visitOverdueDays`، تازگی ویزیت و واکنش محصول در action، فاصلهٔ ویزیت در priority/signals، سررسید چک در signals، محاسبات زمانی SKU، `receivableAttention`، ماه فصلی در seasonality، موعد پیگیری Watch.
- پنجره‌های فروش (ابتدا و انتها شامل): `sales30 = asOf-29..asOf`، `salesPrev30 = asOf-59..asOf-30`، `sales90 = asOf-89..asOf`. (قبلاً sales30 در عمل ۳۱ روز بود.) قواعد مبلغ و تخصیص برگشتی عوض نشد.
- منطق انقضای دقیق timestamp در ACK دست‌نخورده است.

## ۲. انتخاب اقدام و وقفهٔ ویزیت (`action.js`)
- ترتیب جدید: نامزد عادی → فیلتر زمینه → **eligibility تک‌تک نامزدها** → افزودن استثناهای مستقل → وقفه → رتبه‌بندی. دیگر «برنده انتخاب و بعد حذف» نیست؛ نامزد معتبر بعدی می‌تواند برنده شود. سیگنال‌ها/امتیاز/شواهد دست‌کاری نمی‌شوند.
- منطق در `_chooseAction` متمرکز است و هر چهار API (`calculateCustomerAction`، `calculateAllCustomerActions`، `calculateAllActions`، `_visitAckHidesFromSuggested`) رفتار یکسان دارند.
- وقفه = ACK زنده با `decision=visit_reviewed`, `source=visit`, `scope=account`, `status=active` (از API فعلی ACK).
- استثناها: `CHECK_BOUNCED` معتبر، `PAYMENT_OVERDUE` معتبر، فاکتور با `refKind==='invoice_due' && daysSince>0` (از `receivableAttention`؛ `invoice_date` و سررسید «امروز» استثنا نیست) و پیگیری Watch موعددار.
- **دسته‌بندی جدید `WATCH_FOLLOWUP_DUE`** (فقط داخل action.js، سیگنال ذخیره‌شده نیست) با رتبه‌ای درست بالاتر از `OFFER_DEFERRED_FOLLOWUP`.

## ۳. پیگیری Watch مستقل از ACK
- نامزد از `getPendingWatchFollowUps` (مدل واقعی lifecycle) ساخته می‌شود؛ موعد = `suppression.followUpDate` در مقایسه با `ctx.asOfDate`؛ آینده وارد نمی‌شود، امروز/گذشته می‌ماند؛ تاریخ نامعتبر → هیچ وظیفهٔ حدسی. نامزد به `followUpOccurrenceId` وصل است.
- **ریشهٔ واقعی مشکل در `ack.js`**: انقضای ACK آینه‌شده، suppression پیگیری را آزاد می‌کرد. اکنون در مسیر انقضا (`_releaseWatchFor(a,'expiry')`) پیگیری pending آزاد نمی‌شود؛ فقط با تکمیل (`completeWatchFollowUp`) یا لغو فروشنده (`reverseWatchDecision`) پایان می‌یابد. سایر مسیرهای آزادسازی بدون تغییر.

## ۴. توقف خرید در برابر خرید خالص صفر/منفی (`calc.js`، `signals.js`)
- `_behaviorProductSplit` (جدید): خرید ناخالص، برگشتی و خالص هر محصول به تفکیک نیمهٔ اولیه/اخیر. فیلدهای `decliningProducts`: `earlyQty, lateQty, lateGrossQty, lateReturnQty, lateNetQty, latePurchaseState (no_purchase|net_positive|net_nonpositive|uncertain), quantityQuality, uncertaintyReasons`.
- برگشتی متصل به نیمهٔ **فاکتور منبع** تخصیص می‌یابد (نه تاریخ ثبت برگشتی). برگشتی نامتصل / منبع حل‌نشده / منبع مشتری دیگر / کالا در فاکتور منبع نیست / واحد مبهم کشمش پلویی (ردیف‌های ترکیبی وزن‌دار و قدیمی) → هیچ مقدار حدسی، `uncertain` با `code`, `paymentId`, `invoiceId`. برگشتی نامتصلی که قبل از شروع نیمهٔ اخیر ثبت شده فقط کیفیت مقدار نیمهٔ اولیه را مشکوک می‌کند.
- `KEY_PRODUCT_LOST` و `KEY_PRODUCT_LOST_WATCH` فقط برای `no_purchase`. `BASKET_SHRINK` (و Watch آن) شواهد خرید/برگشتی/خالص/عدم‌قطعیت هر محصول را در `evidence.affectedProducts` نگه می‌دارد.
- SKU (`sku_intelligence.js`): برگشتی پنجرهٔ اخیر با فاکتور منبع تخصیص می‌یابد؛ `evidence.quantityQuality/uncertaintyReasons` به سیگنال منتقل می‌شود و سیگنال مشکوک با ضریب موجود `lowHistoryConfidenceFactor` اطمینان کامل نمی‌گیرد (مدل امتیازدهی جدید نیست).

## ۵. حذف هم‌پوشانی SKU/حساب (`signals.js`)
- شاهد معتبر فقط: `category==='LINE_DROP'`, `status==='active'`, `productId===affectedProductId`, `evidence.currentBasketPresence===0` (عدد صریح؛ `null/undefined/''/false/'0'` شاهد نیست؛ `Number()` اضافه نشد؛ producer از قبل عدد تولید می‌کند).
- `SKU_DELAY`، pending، هم‌خانواده بدون SKU یکسان و پوشش بخشی `BASKET_SHRINK` حذف نمی‌کنند. در `KEY_PRODUCT_LOST` فقط اقلام واقعاً پوشش‌داده‌شده از hard-lost خارج می‌شوند؛ شمارش/evidence/متن با باقی‌مانده هماهنگ می‌شود و `retainedLost` دست‌نخورده می‌ماند.
- برای اینکه `status` سیگنال SKU قبل از dedupe معلوم باشد، persistence سیگنال‌های SKU قبل از dedupe (و فقط یک‌بار) اجرا می‌شود.
- اگر `asOfDate` برابر روز سیستم نباشد، تاریخ occurrence ثبت‌شده در persistence همان `asOfDate` است.

## ۶. Restore و Hydration ایمن (`ack.js`, `baseline_manager.js`, `feedback.js`, `persistence.js`)
- توابع جایگزینی: `replaceAllAcks`, `replaceAllBaselines`, `replaceAllFeedback`, `replaceAllOccurrences` (و `js/backup.js` پس از Restore آن‌ها را صدا می‌زند تا memory هر ماژول دقیقاً snapshot بازیابی‌شده باشد).
- epoch ↑، memory دقیقاً snapshot جدید (بدون merge)، mirror محلی هماهنگ، pending ثبت، نوشتن در **یک transaction** (`clear` + همهٔ `put`ها).
- pending فقط در `transaction.oncomplete` و فقط اگر epoch هنوز همان snapshot باشد پاک می‌شود؛ `onerror/onabort`/خطای همگام pending را نگه می‌دارند (در خطای همگام transaction `abort` می‌شود)؛ callback موفقیت فقط پس از oncomplete؛ snapshot جایگزین‌شده به callback قبلی `false` می‌دهد. تلاش مجدد = hydration یا نوشتن بعدی (بدون timer/صف).
- هر hydration epoch شروع را ثبت می‌کند؛ پاسخ دیررس نه memory، نه LocalStorage، نه DB را عوض نمی‌کند. Restore قبل از آماده‌شدن DB → اولین hydration snapshot را به DB می‌نویسد.
- GC اولیهٔ persistence پس از Restore اجرا نمی‌شود؛ بدون Restore مثل قبل اجرا می‌شود.
- Schema و کلیدهای ذخیره‌سازی عوض نشد.

## فایل‌های تغییرکرده
| فایل | دلیل |
|---|---|
| `js/computation-bank.js` | `asOfDate`، helperهای روز تقویمی، memo تاریخ‌محور / `memoStable`، `receivableAttention` تاریخ‌پذیر |
| `js/calc.js` | پنجره‌های فروش، `visitOverdueDays`، `daysSinceLast`، `_behaviorProductSplit` و شواهد جدید `decliningProducts` |
| `js/intelligence/action.js` | `_chooseAction`، وقفهٔ مشتری، استثناها، `WATCH_FOLLOWUP_DUE`، تاریخ‌پذیری |
| `js/intelligence/signals.js` | تاریخ‌پذیری، Lost فقط `no_purchase`، شواهد افت سبد، dedupe جدید، ترتیب persistence |
| `js/intelligence/sku_intelligence.js` | تاریخ‌پذیری، تخصیص برگشتی با فاکتور منبع، کیفیت مقدار و confidence |
| `js/intelligence/priority.js`, `seasonality.js` | تاریخ مرجع مشترک |
| `js/intelligence/ack.js` | عدم آزادسازی پیگیری pending در انقضا؛ Restore ایمن |
| `js/intelligence/baseline_manager.js`, `feedback.js`, `persistence.js` | Restore/hydration ایمن؛ GC بوت‌استرپ |
| `js/backup.js` | فراخوانی توابع replace ماژول‌ها پس از Restore (۳ نقطهٔ کوچک) |
| `tests/v117/*` | suite پذیرش جدید (شامل fake IndexedDB) |

## محدودیت‌ها (صادقانه)
- **مرورگر واقعی، Safari/iPhone و IndexedDB واقعی تست نشده‌اند.** تست‌های Restore با fake DB هستند؛ شبیه‌سازی ترتیب و خطا هستند و جایگزین تست IndexedDB واقعی نیستند.
- بکاپ واقعی در ورودی نبود؛ `tests/audit-v7_8` (نیازمند بکاپ واقعی) روی مبنا هم قابل اجرا نبود. تحلیل فقط روی دادهٔ مصنوعی سنجیده شد؛ عدم تغییر دادهٔ CRM توسط تحلیل روی دادهٔ مصنوعی تأیید شد، نه روی بکاپ واقعی.
- `asOfDate` تاریخ مرجع محاسبات زمانی است؛ **بازپخش کامل تاریخی ادعا نمی‌شود** (وضعیت ACK/Watch و داده‌های CRM به لحظهٔ `asOfDate` برنمی‌گردند).
- سه شکست Quick View («موجودی نامعلوم»، «ردشده و سپس خریداری‌شده»، «آخرین واکنش deferred») روی مبنا نیز بازتولید شد؛ دست‌نخورده ماندند.
- بخش‌های مالی، موجودی/FIFO، Schema، CSS و Service Worker: Diff هیچ تغییری در آن‌ها نشان نمی‌دهد (hunkهای `calc.js` فقط از خط ~۹۹۵ به بعد، در ناحیهٔ رفتار مشتری؛ `customerTotals`/FIFO دست‌نخورده).
