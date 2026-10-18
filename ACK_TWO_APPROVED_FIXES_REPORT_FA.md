# گزارش دو اصلاح کوچک و تأییدشده

## مبنای کار

مبنای کار فقط آخرین ZIP تحویل‌شدهٔ قبلی بود:

`BAGHERI-CRM-ACK-review-v2-regression-fixed.zip`

## تغییرات اعمال‌شده

### اصلاح ۱ — `action.js::_isActionEligible`

این اصلاح در ZIP مبنا از قبل وجود داشت و با عبارت زیر در همان نسخه حاضر بود:

```js
if (!inv || inv.customerId !== cid || typeof inv.date !== 'string' || !(inv.date > latest.date)) continue;
```

بنابراین برای جلوگیری از تغییر تکراری یا رگرسیون، هیچ خط جدیدی در `action.js` ایجاد نشد. تست جدید وجود customer scoping را تأیید می‌کند: invoice مشتری دیگر مبنای پوشش ویزیت مشتری جاری قرار نمی‌گیرد.

### اصلاح ۲ — `watch_lifecycle.js::_recordUnifiedSellerAckFromWatch`

تنها تغییر کدی جدید اعمال‌شده:

```js
riskOverride: code !== 'other'
```

در نتیجه Watch با reason=`other`:

- `riskDelta: 0` را به‌عنوان صفرکنندهٔ modifier قبلی اعمال نمی‌کند.
- فقط Watch را به‌صورت امن defer می‌کند.
- رفتار آن با ACK ویزیت یکدست می‌شود.

## تست‌های اضافه‌شده

فایل جدید `tests/two-approved-fixes.test.js` شامل دو تست است:

1. invoice مشتری دیگر نمی‌تواند در `_isActionEligible` مبنای مقایسه/پوشش مشتری جاری شود.
2. Watch با reason=`other` در کنار سابقهٔ `competitor_bought +20`، `riskOverride:false` و `watchMode:'defer'` تولید می‌کند و modifier قبلی را صفر نمی‌کند.

## کنترل عدم تغییر اضافی

مقایسهٔ کامل با ZIP مبنا انجام شد. فقط این موارد تغییر کرده‌اند:

1. `js/intelligence/watch_lifecycle.js` — یک مقدار `riskOverride` اصلاح شد.
2. `tests/two-approved-fixes.test.js` — دو تست جدید اضافه شد.
3. این گزارش به‌عنوان فایل مستندات اضافه شد.

`action.js`، `ack.js`، `priority.js`، `signals.js`، `sku_intelligence.js`، `calc.js`، migration و محاسبات مالی تغییر نکرده‌اند.

## نتیجهٔ تست‌ها

| مجموعه | نتیجه |
|---|---:|
| `tests/seller-ack.test.js` | 41 PASS / 0 FAIL |
| `tests/ack-storage.test.js` | 2 PASS / 0 FAIL |
| `tests/review-regression.test.js` | 4 PASS / 0 FAIL |
| `tests/ack-review-v2.test.js` | 7 PASS / 0 FAIL |
| `tests/two-approved-fixes.test.js` | 2 PASS / 0 FAIL |
| **مجموع** | **56 PASS / 0 FAIL** |

بررسی syntax فایل‌های `action.js` و `watch_lifecycle.js` نیز موفق بود.
