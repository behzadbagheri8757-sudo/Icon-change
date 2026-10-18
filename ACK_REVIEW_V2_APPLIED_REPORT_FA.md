# گزارش اجرای پرامپت Review v2 ACK

## وضعیت کلی

اصلاحات تأییدشده روی پروژه `BAGHERI-CRM-ACK-review-v2` اعمال شد. معماری جدیدی اضافه نشده و تغییرات فقط در لایهٔ ACK، محاسبهٔ Priority، متن Action و تست‌های مربوط انجام شده‌اند.

## تغییرات فایل‌به‌فایل

### `js/intelligence/ack.js`

- پس از ساخت ACKهای ویزیت در migration، همهٔ فاکتورهای بعدی همان مشتری بررسی می‌شوند.
- اگر فاکتور بعدی همان `productId` یا همان `familyId` را خریداری کرده باشد، ACK محصولی با وضعیت `superseded` ثبت می‌شود و `reversedReason: 'superseded_by_purchase'` و شناسهٔ فاکتور را نگه می‌دارد.
- این بررسی در اجرای تکراری migration نیز انجام می‌شود؛ بنابراین وجود ACK قبلی مانع بررسی خرید جدید نمی‌شود.
- fallback مربوط به `other` با `riskOverride: false` ساخته می‌شود؛ بنابراین `riskDelta: 0` modifier قبلی را صفر نمی‌کند.
- در migration مربوط به Watch، `other` بدون محصول اصلاً ACK نمی‌سازد؛ اگر محصول مشخص باشد، ACK فقط product-scoped و risk-neutral است و account-wide نمی‌شود.
- ذخیرهٔ localStorage در طول migration batch می‌شود و در پایان فقط یک serialize/write انجام می‌شود. در صورت exception، `finally` عملیات flush را انجام می‌دهد.
- متن ACK ویزیت از «بررسی‌شده در ویزیت امروز» به «بررسی‌شده در ویزیت اخیر» تغییر کرد.

### `js/intelligence/priority.js`

- مجموع اثر منفی ACKهای فعال مشتری در محاسبهٔ Priority به سقف `-10` محدود شد.
- اثرهای مثبت محدود نشده‌اند؛ فقط downside تجمعی یک ویزیت مهار می‌شود.

### `js/intelligence/action.js`

- متن Action مربوط به `visit_reviewed` دیگر برای ویزیت قدیمی ادعای «امروز» نمی‌کند و از عبارت «ویزیت اخیر» استفاده می‌کند.

### `tests/ack-review-v2.test.js`

۷ تست رفتاری جدید اضافه شد:

1. خرید بعد از ویزیت → ACK محصولی superseded.
2. نبود خرید بعد از ویزیت → ACK فعال باقی می‌ماند.
3. `other` در ویزیت → risk-neutral و بدون override.
4. `other` در Watch → بدون ACK account-wide.
5. migration پرتعداد → حداکثر یک localStorage write در طول migration.
6. وجود سقف Priority برابر `-10`.
7. حذف ادعای «امروز» از متن ویزیت قدیمی.

## نتیجهٔ تست‌ها

| مجموعه | نتیجه |
|---|---:|
| `tests/seller-ack.test.js` | 39 PASS / 0 FAIL |
| `tests/ack-storage.test.js` | 2 PASS / 0 FAIL |
| `tests/review-regression.test.js` | 4 PASS / 0 FAIL |
| `tests/ack-review-v2.test.js` | 7 PASS / 0 FAIL |
| **مجموع** | **52 PASS / 0 FAIL** |

همچنین `node --check` برای فایل‌های `ack.js`، `priority.js` و `action.js` با موفقیت انجام شد.

## تأیید موارد اصلی

- مشکل ۱، ACK stale پس از خرید: **رفع شد و تست شد**.
- مشکل ۲، صفر شدن modifier قبلی توسط `other`: **رفع شد و تست شد**.
- مشکل ۳، suppress شدن کل حساب توسط `other` در Watch: **رفع شد و تست شد**.
- مشکل ۴، serialize شدن صدهابارهٔ localStorage در migration: **رفع شد و تست شد**.
- سقف Priority: **اعمال شد؛ سقف اثر منفی تجمعی `-10`**.
- متن «امروز»: **اصلاح شد؛ «ویزیت اخیر» جایگزین شد**.

## محدودیت‌ها و موارد NOT PROVABLE

- تست‌های موجود و جدید در Node با محیط mock اجرا شده‌اند؛ اجرای دستی روی iPhone Safari یا مرورگر واقعی انجام نشده است، بنابراین performance واقعی دستگاه ضعیف **NOT PROVABLE** است.
- IndexedDB در تست‌های موجود با mock پوشش داده شده و تست regression مربوط به Restore/blocked/error موفق است؛ تست end-to-end در مرورگر واقعی **NOT PROVABLE** است.
- prune ACKهای قدیمی، تغییرات pagination، و تغییر در `signals.js`، `sku_intelligence.js` و `calc.js` انجام نشده‌اند.
- هیچ invoice، payment، check، stock یا دادهٔ مالی حذف یا بازنویسی نشده است.
