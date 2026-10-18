# گزارش اصلاح regression روی آخرین ZIP تحویلی

## مبنای تغییر

این نسخه فقط از فایل تحویلی قبلی خودم، یعنی `BAGHERI-CRM-ACK-review-v2-applied.zip`، استخراج و اصلاح شده است. هیچ نسخه یا فایل قدیمی دیگری مبنای تغییر قرار نگرفت.

## ایرادهای پیدا و اصلاح‌شده

### ۱. migration و خرید همان‌روز

در نسخهٔ قبلی، تابع داخلی `stamp` فاکتور را با ساعت `00:00` و ویزیت را با ساعت واقعی مقایسه می‌کرد. چون مدل invoice فقط `date` دارد، فاکتور همان‌روزِ ویزیت اشتباهاً قبل از ویزیت تلقی و skip می‌شد.

اصلاح انجام‌شده:

- `stamp` کاملاً حذف شد؛ کد مرده باقی نماند.
- مقایسه فقط بر اساس `YYYY-MM-DD` انجام می‌شود.
- فاکتور با تاریخ مساوی یا بعد از تاریخ ویزیت، خرید بعد از ویزیت محسوب می‌شود.
- خرید قبل از ویزیت همچنان ACK را supersede نمی‌کند.
- منطق retroactive در اجرای دوم migration حفظ شد.

### ۲. نگهداری تاریخ واقعی ویزیت روی ACK

فیلد `visitDate` به رکورد ACK اضافه شد و ACK حساب‌محور `visit_reviewed` مقدار `visit.date || day` را ذخیره می‌کند. این کار بدون تغییر schema مستقل یا رفتارهای قبلی انجام شده و merge موجود نیز خودکار این فیلد را حفظ می‌کند.

### ۳. متن دقیق Action و تاریخ شمسی

در `action.js`:

- اگر ویزیت مربوط به امروز باشد: `ویزیت امروز` نمایش داده می‌شود.
- اگر ویزیت قدیمی باشد: `ویزیت مورخ [تاریخ شمسی]` نمایش داده می‌شود.
- اگر تاریخ قابل اثبات نباشد: `ویزیت اخیر` نمایش داده می‌شود.
- تاریخ پیگیری نیز با `_fmtDateFa` نمایش داده می‌شود.
- `winnerReason` نیز با تاریخ شمسی ساخته می‌شود.

در نتیجه دیگر برای ویزیت قدیمی ادعای «امروز» تولید نمی‌شود.

### ۴. clamp متقارن Priority

اثر تجمعی ACKها اکنون در بازهٔ زیر محدود است:

```text
[-10, +5]
```

یعنی یک رویداد نمی‌تواند با چند ACK محصولی، Priority را بیش از حد پایین یا بالا ببرد.

## بهبودهای قبلی که حفظ شدند

- `riskOverride: false` در fallback اولیهٔ `other` حفظ شد.
- `other` در Watch بدون محصول، ACK account-wide تولید نمی‌کند.
- `other` محصولی در Watch با `riskOverride: false` باقی ماند.
- batching مربوط به localStorage در migration حفظ شد.
- `supersede(id, sourceId, reason)` و `reversedReason` حفظ شد.
- retroactive migration حفظ شد.
- منطق `matchSignal`، `accountDecisionAllows`، `productMatch` و `family` تغییر نکرد.
- `signals.js`، `sku_intelligence.js` و `calc.js` تغییر نکردند.
- داده‌های مالی، invoice، payment، check و stock حذف یا بازنویسی نشدند.

## تست‌ها

| مجموعه | نتیجه |
|---|---:|
| `tests/seller-ack.test.js` | 41 PASS / 0 FAIL |
| `tests/ack-storage.test.js` | 2 PASS / 0 FAIL |
| `tests/review-regression.test.js` | 4 PASS / 0 FAIL |
| `tests/ack-review-v2.test.js` | 7 PASS / 0 FAIL |
| **مجموع** | **54 PASS / 0 FAIL** |

تست‌های جدید در `tests/seller-ack.test.js`:

- خرید همان‌روز با invoice بدون `time` برای دو محصول → هر دو ACK محصولی `superseded` و ACK حسابی `active`.
- خرید قبل از ویزیت → ACK محصولی `active` باقی می‌ماند.

همچنین `node --check` برای `ack.js`، `action.js` و `priority.js` موفق شد.

## وضعیت نهایی

- باگ واقعی migration همان‌روز اصلاح شد.
- کد مردهٔ `stamp` حذف شد.
- regression جدید در تست‌های قبلی مشاهده نشد.
- assertion قدیمی که متن منسوخ «ویزیت اخیر» را الزام می‌کرد، به assertion رفتاری دقیق‌تر برای «ویزیت امروز/ویزیت مورخ/تاریخ شمسی» تبدیل شد.
- موارد قبلی `NOT PROVABLE` دربارهٔ performance واقعی iPhone Safari و اجرای end-to-end IndexedDB در مرورگر واقعی همچنان برقرارند.
