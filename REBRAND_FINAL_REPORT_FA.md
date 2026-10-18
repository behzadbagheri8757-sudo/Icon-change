# گزارش نهایی ریبرند CRM باقری

## دامنه تغییر

ریبرند رنگی و بهبود محدود هویت بصری روی آخرین نسخهٔ تحویلی اعمال شد. منطق داده، بکاپ/Restore، ACK، Watch، Risk، Priority، محاسبات مالی و موجودی دست‌نخورده باقی ماندند.

رنگ‌های قدیمی UI به توکن‌های `visual-grammar.css` منتقل شدند:

| کاربرد | توکن نهایی |
|---|---|
| برند، لوگو، Splash و لهجه | `--vg-color-brand` = `#EC7728` |
| دکمه، لینک، Focus و active icon | `--vg-color-primary` = `#B65415` |
| پس‌زمینهٔ ملایم | `--vg-color-brand-soft` / `--vg-color-primary-soft` = `#FDEFE3` |
| آیکون، Badge و Progress | `--vg-color-success` = `#3F8E69` |
| متن سبز روی زمینهٔ روشن | `--vg-color-success-text` = `#2F6B50` |
| خاکی | `--vg-color-earth` = `#915933` |
| هشدار/سررسید | `--vg-color-gold` و `--vg-color-warning` |
| خطا، حذف و بدهی | `--vg-color-danger` = `#C0392B` |

هاردکد آبی قبلی `#0070D2` و مشتقات آن در UI اصلی، اجزای مشترک، app.css، تقویم و Pin Lock حذف و به توکن primary/RGB آن منتقل شد. رنگ‌های باقی‌مانده در ممیزی عمدتاً خودِ تعریف توکن‌ها، shadow/overlayهای خنثی و رنگ‌های داخلی چاپ فاکتور هستند. `invoiceDocHtml` عمداً تغییر نکرد و با نسخهٔ مبنا مقایسه شد.

## فایل‌های تغییرکرده

- `css/visual-grammar.css`: توکن‌های برند، RGB tokenها و نسخه‌های دارک مود؛ Header دارک بر اساس `--vg-color-surface`.
- `css/app.css`: انتقال رنگ‌های UI، Header یکپارچه، نشان برند و Splash.
- `css/visual-grammar-components.css`: انتقال رنگ‌های اجزای مشترک و Focus قدیمی.
- `css/visual-grammar-pages.css`: انتقال رنگ‌های صفحه‌ها.
- `css/shamsi-calendar.css`: انتقال رنگ‌های قدیمی تقویم به توکن‌ها.
- `js/pin-lock.js`: انتقال رنگ‌های قفل PIN به توکن‌های برند در لایت/دارک.
- `js/app.js`: انتقال رنگ نمایشی سود و fallbackهای QA به توکن‌ها؛ محاسبات بدون تغییر.
- `js/nav.js`: مخفی‌کردن Splash پس از آماده‌شدن داده‌ها؛ منطق داده و مسیرها تغییر نکرده‌اند.
- `index.html`: meta theme-color، Header برند و Splash ساده.
- `manifest.json`: `theme_color=#B65415` و `background_color=#FDEFE3`.
- `icons/apple-touch-icon.png`, `icons/icon-152.png`, `icons/icon-192.png`, `icons/icon-512.png`: باز‌رنگ‌آمیزی برند و اصلاح ابعاد واقعی مطابق manifest.

## Header، Splash، آیکون و Pin Lock

Header همهٔ صفحات همچنان از Header مشترک استفاده می‌کند. نشان برند با کلاس `header-root` فقط در داشبورد نمایش داده می‌شود و در صفحات داخلی مخفی است؛ Header داخلی فقط عنوان صفحه و actionها را دارد. Splash ساده با همان آیکون برند هنگام آماده‌سازی نمایش داده می‌شود و پس از boot مخفی می‌گردد.

Pin Lock حذف نشد و همچنان اختیاری است؛ دکمه‌های تنظیم، تغییر، حذف و قفل فوری در تنظیمات باقی مانده‌اند. مسیر فعال‌سازی و حذف PIN در مرورگر با PIN آزمایشی اجرا و سپس پاک‌سازی شد.

## نتایج تست خودکار

- Syntax برای `app.js`, `nav.js`, `pin-lock.js`, `icons.js`: **PASS**
- اعتبار JSON در `manifest.json`: **PASS**
- `seller-ack.test.js`: **41/41 PASS**
- `ack-storage.test.js`: **2/2 PASS**
- `review-regression.test.js`: **4/4 PASS**
- `ack-review-v2.test.js`: **7/7 PASS**
- `two-approved-fixes.test.js`: **3/3 PASS**
- `restore-v3-e2e.test.js`: **1/1 PASS**
- جمع تست‌ها: **58 PASS / 0 FAIL**
- `invoiceDocHtml` نسبت به نسخهٔ مبنا: **UNCHANGED**
- `signals.js`, `sku_intelligence.js`, `calc.js`, `backup.js`, `ack.js`, `risk.js`, `priority.js`: **UNCHANGED**

## تست مرورگری

- اجرای اپ از سرور محلی: **PASS**
- RTL فارسی: **PASS**؛ `dir=rtl` مشاهده شد.
- لایت مود: **PASS**؛ Header با سطح `#FFFFFF` و primary `#B65415` مشاهده شد.
- دارک مود: **PASS**؛ Header با سطح `#241A13` و primary `#E17A36` مشاهده شد.
- داشبورد: **PASS**؛ آیکون برند در Header دیده شد.
- صفحه‌های داخلی فاکتورها و ویزیت‌ها: **PASS**؛ آیکون برند در Header داخلی مخفی بود و عنوان صفحه باقی ماند.
- Splash: **PASS**؛ عنصر Splash وجود داشت و پس از boot مخفی شد.
- آیکون PWA و manifest: **PASS**؛ آیکون‌ها PNG واقعی با ابعاد 152، 180، 192 و 512 هستند.
- Pin Lock: **PASS**؛ فعال‌سازی PIN شش‌رقمی، پیام «PIN فعال است»، حذف PIN و بازگشت به «PIN تنظیم نشده» اجرا شد.
- دکمه‌ها و کنتراست: **PASS** در مرورگر لایت/دارک با توکن‌های جدید بررسی شد.

## موارد NOT PROVABLE

- تست viewport واقعی موبایل کوچک: **NOT PROVABLE**؛ ابزار مرورگر این اجرا امکان تغییر viewport به ابعاد 375×812 را نداشت. CSS و breakpointهای موجود دست‌نخورده/قابل بارگذاری هستند، اما تست تعاملی دستگاه کوچک انجام نشد.
- تقویم شمسی با داده و بازکردن date-picker: **NOT PROVABLE**؛ محیط تست فاقد دادهٔ مشتری/ویزیت بود و مسیر فهرست ویزیت خالی ماند. فایل CSS تقویم ممیزی و رنگ‌های آن توکنی شد.
- چاپ/پیش‌نمایش فاکتور با داده واقعی: **NOT PROVABLE**؛ دادهٔ فاکتور در محیط تست صفر بود. تابع `invoiceDocHtml` عمداً بدون تغییر باقی ماند.

هیچ داده‌ای حذف یا بازنویسی نشده و تغییرات خارج از دامنهٔ ریبرند بصری و Header/Splash/PWA/PIN اعمال نشده است.
