# گزارش Review مستقل پچ ACK — نسخه v2

## خلاصه اجرایی

- نتیجه تست‌های رفتاری/رگرسیون: **45 PASS، 0 FAIL** (39 تست اصلی + 4 تست Restore/Orphan + 2 تست IndexedDB blocked/error).
- بررسی نحوی: تمام فایل‌های JavaScript زیر `js/` و `tests/` و فایل `sw.js` با `node --check` قبول شدند.
- فایل‌های محافظت‌شده `js/intelligence/signals.js`، `js/intelligence/sku_intelligence.js` و `js/calc.js` نسبت به فایل ZIP اصلی کاربر بدون تغییر باقی مانده‌اند.
- این تست‌ها شبیه‌سازی Node و تست‌های واحد هستند؛ اجرای واقعی iPhone/Safari، IndexedDB واقعی با چند تب، و Restore روی دیتابیس عملیاتی **NOT PROVABLE** است.

## جدول بررسی موارد ۱ تا ۶

| مورد | وضعیت بررسی | آیا مشکل واقعی بود؟ | شواهد کد | اقدام انجام‌شده | نتیجه تست |
|---|---|---|---|---|---|
| ۱. Restore بکاپ v3 بدون `seller_acks` | کد هر دو مسیر Restore و تراکنش بررسی شد | **بله، تأیید شد** | `runIntelligenceRestoreTx` همهٔ Storeها را پاک می‌کرد و در نبود `seller_acks` آرایهٔ خالی جایگزین می‌شد؛ mirror در localStorage هم بدون شرط بازنویسی می‌شد | Store مربوط به ACK در نبود آرایه از تراکنش Restore کنار گذاشته می‌شود؛ localStorage ACK فقط وقتی `seller_acks` آرایهٔ معتبر دارد بازنویسی می‌شود؛ پرچم `window.__sellerAckMigrationDone` پس از Restore ریست می‌شود | PASS: تست تراکنش mock ثابت کرد v3 بدون ACK، Store را پاک نمی‌کند؛ تست کد Restore نیز حفظ localStorage و ریست migration را بررسی می‌کند |
| ۲. گستردگی ACK حساب‌محور | `matchSignal` و مسیرهای `Risk/Feedback/Priority` بررسی شدند | **بله، تأیید شد** | ACK حساب‌محور قبلاً برای چند منبع/تصمیم بدون بررسی دستهٔ Signal برمی‌گشت | نگاشت صریح `decision → allowedCategories` اضافه شد. `visit_reviewed` فقط دسته‌های عادی حساب را می‌پوشاند؛ `price/no_need/not_wanted/competitor/still_stock` فقط دسته‌های مرتبط با خرید را می‌پوشانند؛ ACK هیچ‌وقت `CHECK_BOUNCED` یا `PAYMENT_OVERDUE` را match نمی‌کند؛ ACK محصولی روی هر `PURCHASE_DECLINE*` حساب‌محور اثر ندارد | PASS: تست‌های 32–34 و 27؛ شامل قیمت/عدم نیاز در برابر `LONG_NO_VISIT`، و عدم suppress هشدار مالی |
| ۳. IndexedDB و تب دوم | مسیر `indexedDB.open`، نوشتن و connection lifecycle بررسی شد | **بله، تأیید شد** | `ack.js` پیش از این `onblocked` و `onerror` نداشت و خطاهای نوشتن IndexedDB را بی‌صدا نادیده می‌گرفت | `onblocked/onerror`، کنترل خطای تراکنش read/write، وضعیت قابل‌خواندن ذخیره‌سازی، هشدار UI و fallback صریح localStorage اضافه شد؛ اتصال‌های Intelligence هنگام `versionchange` بسته می‌شوند تا مانع ارتقا نباشند | PASS: دو تست mock برای blocked/error؛ رفتار واقعی Safari و دو تب **NOT PROVABLE** در این محیط |
| ۴. ACK محصولی یتیم | اعتبارسنجی bundle و تطبیق ACK بررسی شد | **بله، تأیید شد** | شرط `productIds.has(productId)` باعث رد کل bundle می‌شد | ACK محصولی که محصولش دیگر وجود ندارد قبل از Restore با `status='orphan'` و دلیل مشخص علامت‌گذاری می‌شود؛ وضعیت orphan در validator پذیرفته و در `active()` غیرفعال است | PASS: تست orphan در `review-regression.test.js` و تست عدم match در تست‌های ACK |
| ۵. `daysFloor` و عدد ۱۰ | همهٔ شاخه‌های آستانهٔ پیگیری پرداخت بررسی شد | **بله، تأیید شد** | `daysFloor` محاسبه و وارد کلید memo می‌شد ولی مقایسه‌ها مقدار ثابت ۱۰ را استفاده می‌کردند | هر دو شاخهٔ مهلت پیش‌فرض از `daysFloor` استفاده می‌کنند؛ مقدار پیش‌فرض همچنان ۱۰ روز است و بنابراین رفتار پیش‌فرض تغییر نمی‌کند | PASS: تست 35 نشان می‌دهد مقدار پیش‌فرض ۱۰ روز حفظ شده و `daysFloor: 3` به‌صورت قابل‌تنظیم اثر دارد |
| ۶a. تکرار `ack.js` در precache | `PRECACHE_URLS` بررسی شد | **بله، تأیید شد** | مسیر `./js/intelligence/ack.js` دو بار وجود داشت | ورودی تکراری حذف شد؛ `CACHE_NAME` برای انتشار تغییرات به `v86` افزایش یافت | PASS: تست 36 و بررسی تعداد یک‌بارهٔ ورودی |
| ۶b. تاریخ پیگیری برای روش پرداخت `discount` | فرم تراکنش و محاسبهٔ پیگیری بررسی شد | **بله، تأیید شد** | فرم تاریخ پیگیری را برای `discount` نشان می‌داد و ذخیره می‌کرد، اما `computation-bank.js` آن را مانند پرداخت نقدی/کارت/انتقال مصرف نمی‌کرد | تاریخ پیگیری در UI و ذخیره فقط برای `cash/card/transfer` ارائه می‌شود؛ منطق تخصیص مالی تغییر نکرد | PASS: تست 37 |
| ۶c. prune کردن ACKهای قدیمی | وضعیت‌های `reversed/superseded/expired` و تاریخچه بررسی شد | **تجمع رکوردها تأیید شد؛ باگ قطعی NOT PROVABLE** | تاریخچه در `mem` و storage باقی می‌ماند؛ expiry فقط match فعال را غیرفعال می‌کند | **عمداً تغییر نکرد**؛ حذف رکوردها نیازمند سیاست نگهداشت مشخص است و حذف خودسرانه می‌تواند تاریخچهٔ تصمیم و امکان ممیزی را از بین ببرد. رشد بلندمدت storage همچنان یک ریسک ثبت‌شده است | NOT PROVABLE به‌عنوان نقص عملکردی بدون تعیین دورهٔ نگهداشت؛ آزمون پاک‌سازی اجرا نشد چون پاک‌سازی پیاده‌سازی نشده است |
| ۶d. یکدستی `days <= 5` در `priorityUntil` | محل تولید ACK در Watch و مصرف‌کنندگان فیلد بررسی شد | **ناسازگاری تأیید شد؛ اصلاح شد** | Watch فقط در مدت حداکثر ۵ روز `priorityUntil` می‌گذاشت، حتی وقتی ACK اثر Priority غیرصفر و انقضای بلندتر داشت | `priorityUntil` اکنون هر زمان `priorityDelta` غیرصفر باشد با تاریخ انقضا هم‌راستا است؛ منطق امتیازدهی اصلی تغییر نکرد | PASS: تست 39 و بررسی نحوی |
| ۶e. نمایش `expiresAt=null` | رندر پنل ACK مشتری بررسی شد | **بله، تأیید شد به‌عنوان edge case** | fallback رشته‌ای می‌توانست `null` را مستقیم نمایش دهد | متن جایگزین «بدون تاریخ انقضا» اضافه شد | PASS: تست 38 |
| ۶f. تست‌های مبتنی بر regex | کیفیت تست‌های موجود بررسی شد | **بخشی از ادعا تأیید شد** | چند تست قدیمی wiring را با regex روی سورس بررسی می‌کردند، نه رفتار runtime | تست‌های رفتاری برای تطبیق تصمیم‌ها، Restore mock، orphan ACK، آستانهٔ پیگیری و blocked/error IndexedDB افزوده شدند. تست‌های regex موجود حذف نشدند چون برای بررسی wiring هنوز مفیدند | PASS: 45 تست؛ پوشش کامل DOM/Safari/دادهٔ واقعی همچنان NOT PROVABLE |

## فایل‌های تغییر یافته نسبت به `BAGHERI-CRM-ACK-unified-v1.zip`

1. `js/app.js` — تاریخ پیگیری برای `discount` حذف شد.
2. `js/backup.js` — حفظ ACK در Restore قدیمی، orphan کردن ACKهای محصولی و ریست پرچم migration.
3. `js/computation-bank.js` — استفادهٔ واقعی از `daysFloor`.
4. `js/intelligence/ack.js` — نگاشت مجاز دسته‌ها، عدم suppress هشدارهای مالی، مدیریت blocked/error و fallback ذخیره‌سازی، غیرفعال‌کردن orphan.
5. `js/intelligence/baseline_manager.js` — بستن اتصال هنگام `versionchange`.
6. `js/intelligence/feedback.js` — بستن اتصال هنگام `versionchange`.
7. `js/intelligence/persistence.js` — بستن اتصال هنگام `versionchange`.
8. `js/intelligence/watch_lifecycle.js` — هم‌راستاسازی `priorityUntil` با انقضا.
9. `js/views/customer.js` — نمایش امن ACK بدون تاریخ انقضا.
10. `sw.js` — حذف مسیر تکراری ACK و افزایش cache به `v86`.
11. `tests/seller-ack.test.js` — تغییر تست PAYMENT_OVERDUE و افزودن تست‌های 32–39.
12. `tests/review-regression.test.js` — **فایل جدید**؛ Restore بدون ACK و ACK یتیم.
13. `tests/ack-storage.test.js` — **فایل جدید**؛ آزمون blocked/error IndexedDB.
14. `REVIEW-ACK-PATCH-v2-REPORT-FA.md` — **فایل جدید**؛ این گزارش.

## تست‌های اجراشده

| مجموعه | نتیجه |
|---|---:|
| `tests/seller-ack.test.js` | PASS 39 / FAIL 0 |
| `tests/review-regression.test.js` | PASS 4 / FAIL 0 |
| `tests/ack-storage.test.js` | PASS 2 / FAIL 0 |
| بررسی نحوی `js/**/*.js`, `tests/**/*.js`, `sw.js` | PASS |
| بررسی عدم تغییر `signals.js`, `sku_intelligence.js`, `calc.js` | PASS |
| مجموع تست‌های واحد/رگرسیون | **PASS 45 / FAIL 0** |

## موارد NOT PROVABLE / محدودیت

- اجرای واقعی در iPhone Safari و رفتار هم‌زمان چند تب واقعی انجام نشده است.
- Restore کامل با IndexedDB واقعی و دیتای عملیاتی CRM انجام نشده؛ تراکنش Restore با mock رفتاری آزموده شده است.
- زمان رندر داشبورد اندازه‌گیری نشده؛ این پچ برای بررسی رگرسیون‌هاست و benchmark داشبورد در scope این review نبود.
- برای prune رکوردهای تاریخی ACK سیاست retention مشخص نشده است؛ پاک‌سازی خودکار اضافه نشد تا تاریخچهٔ تصمیم‌ها بی‌اجازه حذف نشود.

## قاعدهٔ حفظ‌شده

هیچ تغییری در `js/intelligence/signals.js`، `js/intelligence/sku_intelligence.js` یا `js/calc.js` اعمال نشده و هیچ دادهٔ مالی، فاکتور، پرداخت، چک، FIFO یا موجودی حذف یا بازنویسی نشده است.
