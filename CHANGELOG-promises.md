# تغییرات نسخهٔ کامل (روی v105-account-summary)

1. **وعدهٔ پرداخت** — ثبت قول پرداخت مشتری، کارت صفحهٔ مشتری، بلوک داشبورد با «دریافت شد» یک‌تپی، «بستن بدون پرداخت»، تمدید. (js/payment-promises.js، js/views/payment-promises.js)
2. **قول تحویل** — «فردا/۳ روز دیگه نخود و عدس بیار»: اقلام + تاریخ، بلوک داشبورد، «بارگیری» (جمع هر کالا برای امروز/فردا با هشدار کمبود)، «تحویل شد» = فاکتور پیش‌پر. (js/delivery-promises.js، js/views/delivery-promises.js)
3. **ویزیت بعدی** — تاریخ «ویزیت بعدی» برای هر ویزیت اختیاری شد؛ یادآوری از روی آخرین ویزیت مشتری ساخته می‌شود (بدون داده‌ی جدید). (js/visit-plan.js، js/views/visit-plan.js)

4. **مشتری یک‌بار‌مصرف («متفرقه»)** — علامت `oneOff` روی مشتری (تیک در فرم مشتری؛ مشتری با نام دقیق «متفرقه» پیش‌فرض تیک می‌خورد، قابل خاموش‌کردن). اثرها:
   - پیشنهاد روزانه، اولویت/ریسک و Watch آن را نمی‌بینند (`isTrackedCustomer`)؛ **بدهی و هشدار وصول مثل قبل می‌ماند**.
   - فاکتور «نام خریدار» (اختیاری) می‌گیرد؛ در صفحهٔ فاکتور، لیست فاکتورها (و جست‌وجو)، حساب مشتری و ردیف‌های صفحهٔ مشتری دیده می‌شود.
   - وعدهٔ پرداخت: چند وعده هم‌زمان (هر نفر یکی)، «تمدید» فقط همان وعده را جایگزین می‌کند، بستن خودکار با پرداخت/فاکتور خاموش است (فقط «دریافت شد/تحویل شد» صریح)، بدهی متفرقه با وعدهٔ یک نفر ساکت نمی‌شود، نام شخص (یادداشت) در داشبورد دیده می‌شود.
   - برای متفرقه «ویزیت بعدی» و کارت امتیاز/وضعیت رفتاری نشان داده نمی‌شود.

فایل‌های موجود تغییرکرده: models.js، db.js (customers.oneOff، invoices.buyerName)، backup.js، computation-bank.js، intelligence/action.js، priority.js، watch_lifecycle.js (فقط شرط مشتری فعال → isTrackedCustomer)، views/invoice.js، invoices.js، customers.js، watches.js، app.js (openAddTransaction، فرم فاکتور، فرم ویزیت)، views/customer.js، views/dashboard.js، css/visual-grammar-pages.css، index.html، sw.js (precache چهار فایل جدید + CACHE_NAME = baqeri-shell-v110).

تست‌ها: `node tests/payment-promises/run.js` · `tests/delivery-promises/run.js` · `tests/visit-plan/run.js` · `tests/one-off-customer/run.js`
