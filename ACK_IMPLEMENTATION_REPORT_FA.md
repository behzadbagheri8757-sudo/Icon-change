# گزارش تحویل — ACK یکپارچه و اصلاح پیگیری پرداخت

## نتیجه تست‌ها

- **PASS:** 31 آزمون خودکار در `tests/seller-ack.test.js`؛ 31 موفق، 0 ناموفق.
- **PASS:** بررسی نحوی 55 فایل JavaScript، به‌علاوه `sw.js` و فایل تست.
- **PASS (بازبینی ایستا):** منطق اصلی حسابداری، تخصیص بدهی، FIFO، موجودی و محاسبهٔ مالی در `calc.js`، `stock.js`، `signals.js` و `sku_intelligence.js` تغییر نکرده‌اند.
- **NOT PROVABLE:** اجرای کامل SPA روی iPhone/Safari، آزمون تعاملی واقعی IndexedDB v3→v4، بازگردانی بکاپ واقعی، و اندازه‌گیری زمان رندر داشبورد قبل/بعد در این محیط قابل اجرا نبود. آزمون‌های Node شامل تست رفتاری مصنوعی و چند assertion ایستا هستند؛ جای تست میدانی را نمی‌گیرند.
- **FAIL:** صفر شکست در آزمون‌های اجراشده.

## پیاده‌سازی

1. ماژول جدید `js/intelligence/ack.js` برای ACKهای موقت، حساب‌محور و محصول‌محور؛ ذخیره در `localStorage` و IndexedDB با نسخهٔ 4؛ لغو و supersede؛ انقضا؛ تطبیق دقیق شناسه/خانوادهٔ محصول.
2. ثبت خودکار `visit_reviewed` حساب‌محور پس از ثبت ویزیت، با مهلت ۷ روز و کاهش موقت Priority فقط برای ۳ روز و فقط در نبود چک برگشتی.
3. ACKهای مستقل برای پاسخ‌های محصولی و Watch؛ نمایش ACK فعال و دکمهٔ «لغو تصمیم» در صفحهٔ مشتری؛ دکمه در تصمیم‌های Watch، suppression متناظر را هم برمی‌گرداند.
4. تاریخ پیگیری دقیق برای پاسخ `follow_up_later` در فرم پاسخ Watch؛ در صورت خالی‌بودن تاریخ، مهلت پیش‌فرض ۵ روز است.
5. `CHECK_BOUNCED` همیشه فوری می‌ماند. `PAYMENT_OVERDUE` بدون دلیل حساب‌محور صریح فوری می‌ماند. ACK محصولی روی `PURCHASE_DECLINE_SEVERE/MILD` حساب‌محور اثر نمی‌گذارد.
6. ACK محصولی با خرید مجدد همان محصول/خانواده supersede می‌شود؛ فاکتور یا بدهی قبلی حذف یا بازنویسی نمی‌شود.
7. اصلاح چرخهٔ پیگیری پرداخت: فاکتور جدید مبنای پیگیری را تازه می‌کند؛ `dueDate` در صورت وجود استفاده می‌شود؛ در غیر این صورت مهلت ۱۰روزه اعمال می‌شود؛ تاریخ پیگیری انتخابی پرداخت، پیگیری قبلی را جایگزین می‌کند و فقط از همان تاریخ ظاهر می‌شود.
8. فیلدهای اختیاری `dueDate` در فاکتور و `followUpDate` در پرداخت در `normalizeData` حفظ می‌شوند؛ منطق مبلغ، تخصیص بدهی و FIFO تغییر نکرده است.
9. بکاپ/بازیابی Intelligence برای `seller_acks` توسعه داده شد؛ Service Worker به `v85` ارتقا یافت و `ack.js` به precache/critical shell اضافه شد.
10. مهاجرت افزایشی و idempotent از ویزیت‌های اخیر، پاسخ‌های Feedback و Watchهای ذخیره‌شده پیاده‌سازی شده است.

## فایل‌های تغییرکرده

- `css/visual-grammar-pages.css`
- `index.html`
- `js/app.js`
- `js/backup.js`
- `js/computation-bank.js`
- `js/db.js` — فقط حفظ دو فیلد اختیاری `invoices[].dueDate` و `payments[].followUpDate` هنگام normalize؛ بدون تغییر منطق حسابداری
- `js/intelligence/README.md`
- `js/intelligence/ack.js` — جدید
- `js/intelligence/action.js`
- `js/intelligence/baseline_manager.js`
- `js/intelligence/feedback.js`
- `js/intelligence/persistence.js`
- `js/intelligence/priority.js`
- `js/intelligence/watch_lifecycle.js`
- `js/views/customer.js`
- `js/views/dashboard.js`
- `js/views/watches.js`
- `sw.js`
- `tests/seller-ack.test.js` — جدید

## فایل‌های محافظت‌شده و عمداً تغییرنکرده

`js/intelligence/signals.js`, `js/intelligence/sku_intelligence.js`, `js/calc.js`, `js/stock.js`, `js/models.js`, `js/views/reports.js` و ساختار اصلی دیتابیس CRM تغییر نکردند. در `js/db.js` فقط دو فیلد اختیاری برای ماندگاری تاریخ‌ها حفظ شده‌اند.

## نکتهٔ باقیمانده

در مدل فعلی، فیلد مرجع و رسمی برای «محصول اصلی» وجود نداشت. برای تشخیص موقت محصول اصلی، پیاده‌سازی از `isCore`/`coreProduct` در صورت وجود و در غیر این صورت سه محصول اول `customerBehavior(...).topProducts` استفاده می‌کند. اگر تعریف کسب‌وکار شما از «محصول اصلی» معیار دیگری دارد، باید آن معیار صریحاً جایگزین این fallback شود.

## فایل تست

از ریشهٔ پروژه اجرا کنید:

```bash
node tests/seller-ack.test.js
```
