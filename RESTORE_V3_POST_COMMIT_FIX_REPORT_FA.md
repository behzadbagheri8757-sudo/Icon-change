# گزارش اصلاح قطعی Restore بکاپ v3 روی کد v4

## مبنای کار

مبنای کار فقط آخرین ZIP تحویل‌شدهٔ قبلی بود:

`BAGHERI-CRM-ACK-review-v2-sameday-date-fix.zip`

## اصلاح اعمال‌شده

در `js/backup.js` و فقط در مسیر `_restoreParsedBackup`، ساخت `expected.intelligence` برای post-commit verification اصلاح شد.

رفتار جدید:

- `dbVersion` همیشه از `INTELLIGENCE_DB_VERSION` نسخهٔ فعلی برنامه گرفته می‌شود.
- `occurrences`، `seller_feedback` و `baseline_cache` از بکاپ با fallback آرایهٔ خالی ساخته می‌شوند.
- اگر `seller_acks` در بکاپ v3 وجود نداشته باشد، `previous.intelligence.seller_acks` حفظ می‌شود.
- اگر `seller_acks` در بکاپ وجود داشته باشد، همان آرایه مبنای expected قرار می‌گیرد.

این باعث می‌شود post-commit verification حالت نهایی واقعی را با حالت نهایی واقعی مقایسه کند، نه `dbVersion:3` و ساختار ناقص بکاپ خام را با خروجی v4.

## مواردی که تغییر نکردند

- `watchLifecycle` تغییر نکرد؛ بعد از اصلاح intelligence، تست Restore موفق شد.
- هیچ تغییری در ACK، Risk، Priority، Action، Watch، Migration یا محاسبات مالی داده نشد.
- `signals.js`، `sku_intelligence.js` و `calc.js` دست‌نخورده باقی ماندند.
- هیچ داده‌ای حذف یا بازنویسی نشد.

## تست end-to-end Restore

فایل تست جدید:

`tests/restore-v3-e2e.test.js`

سناریو:

1. یک ACK فعال در snapshot قبلی وجود دارد.
2. بکاپ v3 با `dbVersion:3` و بدون `seller_acks` Restore می‌شود.
3. post-commit verification با نسخهٔ فعلی intelligence انجام می‌شود.
4. Restore موفق می‌شود.
5. ACK فعال قبلی حذف نمی‌شود.
6. دادهٔ CRM جدید Restore می‌شود.
7. `dbVersion` نهایی برابر ۴ می‌ماند.
8. snapshot دارای فیلد اضافه در Watch Lifecycle است و verification بدون شکست انجام می‌شود.
9. journal پس از verification موفق حذف می‌شود.

نتیجه:

```text
PASS | v3 restore keeps existing ACKs and verifies v4 semantic state
TOTAL 1 | PASS 1 | FAIL 0
```

## نتیجهٔ تمام تست‌ها

| مجموعه | نتیجه |
|---|---:|
| `tests/seller-ack.test.js` | 41 PASS / 0 FAIL |
| `tests/ack-storage.test.js` | 2 PASS / 0 FAIL |
| `tests/review-regression.test.js` | 4 PASS / 0 FAIL |
| `tests/ack-review-v2.test.js` | 7 PASS / 0 FAIL |
| `tests/two-approved-fixes.test.js` | 3 PASS / 0 FAIL |
| `tests/restore-v3-e2e.test.js` | 1 PASS / 0 FAIL |
| **مجموع** | **58 PASS / 0 FAIL** |

`node --check js/backup.js` نیز موفق شد.

## کنترل تغییرات

نسبت به ZIP مبنا، تغییرات اجرایی فقط در این فایل‌هاست:

1. `js/backup.js` — اصلاح expected intelligence در post-commit verification.
2. `tests/restore-v3-e2e.test.js` — تست Restore v3 بدون seller_acks.

این گزارش نیز برای مستندسازی به پروژه افزوده شده است.

## PASS / FAIL / NOT PROVABLE

- اصلاح اجباری expected intelligence: **PASS**
- حفظ ACK فعال قبلی در Restore v3: **PASS**
- dbVersion نهایی برابر ۴: **PASS**
- Restore دادهٔ CRM: **PASS**
- عدم شکست با فیلد اضافهٔ Watch Lifecycle: **PASS**
- تست‌های قبلی: **PASS — 57 تست بدون خطا**
- تست end-to-end مسیر Restore: **PASS — 1 تست بدون خطا**
- اجرای واقعی روی مرورگر/IndexedDB دستگاه کاربر و بکاپ واقعی attach‌شده: **NOT PROVABLE**؛ تست موجود مسیر Restore را با harness کنترل‌شدهٔ end-to-end بررسی می‌کند، نه اجرای مرورگر واقعی.
- لاگ شکست Restore پس از اصلاح: **وجود ندارد**؛ Restore موفق شد و rollback اجرا نشد.
