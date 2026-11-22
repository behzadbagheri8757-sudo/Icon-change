/* models.js — constants, schema, emptyData, shared state
   Phase 0 extract: no logic changes.
*/
/* =======================================================================
   حبوبات و خشکبار باقری — دفتر حساب
   فایل تک‌صفحه‌ای، بدون سرور، بدون نیاز به اینترنت برای کارکرد اصلی.
   (فونت وزیرمتن و کتابخانه‌های اکسل/تصویر فقط برای همان قابلیت‌های
   اختیاری از CDN لود می‌شوند؛ اگر اینترنت نبود، بقیه‌ی برنامه عادی کار می‌کند.)
   ======================================================================= */

// Logo assets (external files — not inlined; load only when print/export needs them)
// NOTE: logo-export.png lives at the project root (next to the SPA shell) — there is
// no assets/ folder in this project. The path below matches the real file location.
const APP_LOGO_DATA_URI = './logo-export.png';
const EXPORT_LOGO_DATA_URI = './logo-export.png';

const DB_NAME = 'baqeriDB';
const DB_VERSION = 1;
const STORE = 'appdata';
const RECORD_KEY = 'main';
const PRERESTORE_KEY = 'preRestoreSnapshot';

// schema versioning (data shape itself is unchanged/backward-compatible;
// this is just a marker so future migrations can tell old saves apart)
const CURRENT_SCHEMA_VERSION = 3;

// simple rotating auto-backup, stored as extra rows in the same IndexedDB
// object store — no new library, no new database
const AUTO_BACKUP_PREFIX = 'autoBackup_';
const AUTO_BACKUP_LIST_KEY = 'autoBackupList';
const AUTO_BACKUP_MAX = 5;
const AUTO_BACKUP_INTERVAL_MS = 12*60*60*1000; // حداکثر هر ۱۲ ساعت یک نسخه

const ROUTES = ['شرق','مرکز','غرب'];
const REGION_SUGGESTIONS = ['رویان','نوشهر','چالوس','سیسنگان','متل‌قو'];
const CATEGORY_SUGGESTIONS = ['حبوبات','خشکبار','آجیل','برنج','ادویه','سایر'];
const VISIT_RESULTS = ['سفارش گرفته شد','سفارش گرفته نشد','فروشگاه بسته بود','فقط بازدید/سرکشی'];

/* Optional visit observation fields (Customer Behavior) — all optional, no migration */
const VISIT_REASONS = [
  'قیمت','موجودی','کیفیت','رقیب','عدم نیاز','مشکل نقدینگی','زمان نامناسب','سایر'
];
const VISIT_OPPORTUNITIES = [
  'افزایش حجم','کالای جدید','کالای مکمل','معرفی محصول','فروش بیشتر','سایر'
];
const VISIT_THREATS = [
  'رقیب جدید','کاهش تقاضا','قیمت رقیب','نارضایتی','کاهش خرید','تغییر تأمین‌کننده','سایر'
];
const VISIT_NEXT_ACTIONS = [
  'پیگیری قیمت','ارائه نمونه','تماس','پیشنهاد محصول','مراجعه مجدد','پیگیری بدهی','سایر'
];

let data = emptyData();
let activeTab = 'dashboard';
let dbInstance = null;
let custFilter = 'all';
let custSortByDebt = false;

/* مشتری یک‌بار‌مصرف («متفرقه»): فروش‌های پراکندهٔ آدم‌های مختلف زیر یک حساب.
   - موتورهای رفتاری (پیشنهاد روزانه، اولویت، Watch) آن را نمی‌بینند → isTrackedCustomer
   - حسابداری، بدهی و هشدار وصول مثل بقیه می‌ماند
   - روی فاکتور «نام خریدار» (buyerName) دارد تا بدهی‌ها قاطی نشوند */
function isOneOffCustomer(c){ return !!(c && c.oneOff); }
function isTrackedCustomer(c){ return !!(c && c.active !== false && !c.oneOff); }

function emptyData(){
  // suppliers[].payments: legacy {date, amount} or extended
  //   {id, date, amount, method:'cash'|'check', note?,
  //    // when method==='check':
  //    faceAmount, checkNumber?, bank?, issueDate?, dueDate?, status:'pending'|'cleared'|'bounced'}
  // Customer receivable checks remain only in top-level data.checks (unchanged).
  // inventoryLayers: FIFO cost layers for stock (purchase / manual / sale-return orphans)
  // { id, purchaseId, productId, itemId?, qtyOriginal, qtyRemaining, unitCost,
  //   status:'open'|'depleted'|'voided', source:'purchase'|'manual-in'|'manual-adjust'|'sale-return'|'sale-revert',
  //   date?, note? }
  // paymentPromises: oral payment promises {id, customerId, date, promiseDate, amount(0=unspecified), note,
  //   status:'pending'|'kept'|'broken'|'superseded', keptAmount, keptAt, createdAt}. Promise is NOT money:
  //   it never touches payments/balance (see js/payment-promises.js).
  // deliveryPromises: oral delivery promises («فردا نخود و عدس بیار») {id, customerId, date, deliveryDate,
  //   items:[{productId, name, qty(0=unspecified)}], note, status:'pending'|'done'|'cancelled', doneAt, invoiceId|null, createdAt}.
  //   A promise is NOT a sale: it never touches stock, invoices or balances (see js/delivery-promises.js).
  // regions/routes/neighborhoods: shared Location System (see js/location.js).
  // Kept as plain arrays on the same data blob — new, additive, empty by
  // default, and automatically covered by the existing backup/restore.
  return { products: [], customers: [], invoices: [], payments: [], checks: [], paymentPromises: [], deliveryPromises: [], suppliers: [], inventoryLayers: [], invoiceSeq: 1000, schemaVersion: CURRENT_SCHEMA_VERSION, regions: [], routes: [], neighborhoods: [], analysisGroups: [] };
}

