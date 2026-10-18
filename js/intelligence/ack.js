/* js/intelligence/ack.js — unified, reversible seller ACK lifecycle.
   Intelligence-only metadata. Never mutates CRM invoices, payments, checks, stock or FIFO. */
'use strict';
(function (global) {
  var DB = 'bagheri_intelligence_db', STORE = 'seller_acks', VERSION = 4;
  var LS = 'bagheri_seller_acks_v1';
  var mem = [], idb = null, idbStatus = 'opening', storageWarningShown = false;
  var batchDepth = 0, batchDirty = false;
  function storageWarning(reason){ idbStatus = reason; if(storageWarningShown)return; storageWarningShown=true; try{ if(typeof global.showToast==='function')global.showToast('ذخیرهٔ ACK در حافظهٔ محلی فعال است؛ همگام‌سازی IndexedDB در دسترس نیست.'); }catch(e){} try{ if(global.console&&console.warn)console.warn('Seller ACK IndexedDB unavailable; localStorage mirror remains active:',reason); }catch(e){} }
  var ACCOUNT_ONLY = {
    PURCHASE_DECLINE_SEVERE:1, PURCHASE_DECLINE_MILD:1, MULTI_SKU_DECLINE:1,
    CONSECUTIVE_NO_ORDER:1, BEHIND_PATTERN:1, LONG_NO_VISIT:1, VISIT_OVERDUE:1,
    VISIT_CONVERSION_LOW:1, CHECK_BOUNCED:1, PAYMENT_OVERDUE:1
  };
  var NEVER_DEFER = { CHECK_BOUNCED:1, PAYMENT_OVERDUE:1 };
  function appData(){ try { if (typeof data !== 'undefined' && data) return data; } catch(e) {} return global.data || {}; }
  function isoDay(v){ var s=String(v||'').slice(0,10); return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:null; }
  function dayAdd(day,n){ var d=new Date(String(day||today()).slice(0,10)+'T12:00:00'); d.setDate(d.getDate()+Number(n||0)); return d.toISOString().slice(0,10); }
  function today(){ return typeof global.todayISO==='function' ? global.todayISO() : new Date().toISOString().slice(0,10); }
  function uid(){ return 'ack_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,9); }
  function save(){ try{ if(global.localStorage) global.localStorage.setItem(LS,JSON.stringify(mem)); batchDirty=false; return true; }catch(e){ storageWarning('localStorage-write-failed'); return false; } }
  function persist(rec){ if(rec) rec.updatedAt=new Date().toISOString(); if(batchDepth){ batchDirty=true; } else { save(); } if(idb){ try{ var tx=idb.transaction(STORE,'readwrite'); tx.objectStore(STORE).put(rec); tx.onerror=function(){storageWarning('indexeddb-write-failed');}; tx.onabort=function(){storageWarning('indexeddb-write-aborted');}; }catch(e){storageWarning('indexeddb-write-failed');} } else if(!batchDepth && idbStatus!=='opening') storageWarning(idbStatus); }
  function open(){ if(!global.indexedDB){storageWarning('indexeddb-unavailable');return;} try { var r=indexedDB.open(DB,VERSION); r.onupgradeneeded=function(ev){ var db=ev.target.result; if(!db.objectStoreNames.contains('occurrences'))db.createObjectStore('occurrences',{keyPath:'key'}); if(!db.objectStoreNames.contains('seller_feedback'))db.createObjectStore('seller_feedback',{keyPath:'id'}); if(!db.objectStoreNames.contains('baseline_cache'))db.createObjectStore('baseline_cache',{keyPath:'key'}); if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE,{keyPath:'id'}); }; r.onblocked=function(){storageWarning('indexeddb-upgrade-blocked-by-another-tab');}; r.onerror=function(){storageWarning('indexeddb-open-failed');}; r.onsuccess=function(ev){ idb=ev.target.result; idbStatus='ready'; storageWarningShown=false; idb.onversionchange=function(){try{idb.close();}catch(e){} idb=null; storageWarning('indexeddb-versionchange');}; try{ var q=idb.transaction(STORE,'readonly').objectStore(STORE).getAll(); q.onsuccess=function(){ var by={}; mem.forEach(function(x){if(x&&x.id)by[x.id]=x;}); (q.result||[]).forEach(function(x){if(!x||!x.id)return; var cur=by[x.id]; var xt=String(x.updatedAt||x.reversedAt||x.supersededAt||x.createdAt||''); var ct=cur?String(cur.updatedAt||cur.reversedAt||cur.supersededAt||cur.createdAt||''):''; if(!cur||xt>ct)by[x.id]=x;}); mem=Object.keys(by).map(function(k){return by[k];}); save(); }; q.onerror=function(){storageWarning('indexeddb-read-failed');}; }catch(e){storageWarning('indexeddb-read-failed');} }; }catch(e){storageWarning('indexeddb-open-failed');} }
  try{ var raw=global.localStorage&&localStorage.getItem(LS); var parsed=raw&&JSON.parse(raw); if(Array.isArray(parsed))mem=parsed; }catch(e){}
  open();
  function active(a, asOf){ if(!a||a.status==='reversed'||a.status==='superseded'||a.status==='orphan')return false; var d=isoDay(asOf||today()), exp=isoDay(a.expiresAt); return !exp||!d||exp>=d; }
  function list(cid, includeInactive){ return mem.filter(function(a){return a&&String(a.customerId)===String(cid)&&(includeInactive||active(a));}).sort(function(a,b){return String(b.createdAt||'').localeCompare(String(a.createdAt||''));}); }
  function create(input){ if(!input||input.customerId==null||!input.decision)return null; var start=isoDay(input.createdAt)||today(), days=Math.max(0,Number(input.durationDays==null?7:input.durationDays)||0); var subject=(input.subjectKey||'');
    var existing=mem.find(function(a){return a&&String(a.customerId)===String(input.customerId)&&a.subjectKey===subject&&a.decision===input.decision&&a.sourceId===input.sourceId&&active(a,start);});
    if(existing){ existing.createdAt=new Date().toISOString(); existing.expiresAt=dayAdd(start,days); existing.updatedAt=existing.createdAt; Object.keys(input).forEach(function(k){existing[k]=input[k];}); persist(existing); return existing; }
    var rec={id:input.id||uid(),customerId:String(input.customerId),scope:input.scope==='product'?'product':'account',productId:input.productId==null?null:String(input.productId),familyId:input.familyId==null?null:String(input.familyId),decision:String(input.decision),createdAt:input.createdAt||new Date().toISOString(),expiresAt:input.expiresAt||dayAdd(start,days),durationDays:days,status:'active',source:input.source||'seller',sourceId:input.sourceId||null,subjectKey:subject,reason:input.reason||'',comment:input.comment||'',riskDelta:Number(input.riskDelta)||0,priorityDelta:Number(input.priorityDelta)||0,priorityUntil:input.priorityUntil||null,visitDate:input.visitDate||null,actionText:input.actionText||'',watchMode:input.watchMode||'defer',riskOverride:input.riskOverride!==false,coreProduct:!!input.coreProduct};
    mem.push(rec); persist(rec); return rec;
  }
  function reverse(id){ var a=mem.find(function(x){return x&&x.id===id;}); if(!a||a.status==='reversed')return null; a.status='reversed'; a.reversedAt=new Date().toISOString(); persist(a); return a; }
  function supersede(id, sourceId, reason){ var a=mem.find(function(x){return x&&x.id===id;}); if(!a||a.status==='reversed'||a.status==='superseded')return null; a.status='superseded'; a.supersededAt=new Date().toISOString(); a.supersededBy=sourceId||null; a.reversedReason=reason||'superseded'; persist(a); return a; }
  function family(pid){ try{ if(typeof global.resolveFamilyId==='function')return String(global.resolveFamilyId(pid)); }catch(e){} try{ var p=(appData().products||[]).find(function(x){return x&&String(x.id)===String(pid);}); if(p&&p.analysisGroupId!=null&&p.analysisGroupId!=='')return String(p.analysisGroupId); }catch(e){} return pid==null?null:String(pid); }
  function productMatch(a,s){ if(a.productId==null||s.productId==null||s.productId==='')return false; if(String(a.productId)===String(s.productId))return true; var af=a.familyId||family(a.productId), sf=s.familyId||family(s.productId); return af!=null&&sf!=null&&String(af)===String(sf); }
  function isImmediate(s){ if(!s)return false; var cat=String(s.category||''); if(/CHECK_BOUNCED/.test(cat))return true; if(/PAYMENT_OVERDUE/.test(cat)){ if(s.recordedReasonCode || s.paymentReasonCode) return false; var explicit=false; try{ explicit=list(s.customerId,false).some(function(a){return a.scope==='account'&&a.decision!=='visit_reviewed'&&a.source!=='visit'&&!!a.reason;}); }catch(e){} return !explicit; } if(NEVER_DEFER[cat])return true; return false; }
  function isCoreCompetitor(a){ return !!(a&&a.decision==='competitor'&&a.coreProduct); }
  var PURCHASE_CATEGORIES = { PURCHASE_DECLINE_SEVERE:1, PURCHASE_DECLINE_MILD:1, PURCHASE_DECLINE_WATCH:1, MULTI_SKU_DECLINE:1, PURCHASE_GROWTH:1, BASKET_SHRINK:1, BASKET_SHRINK_WATCH:1, LINE_DROP:1, LINE_DROP_WATCH:1, KEY_PRODUCT_LOST:1, KEY_PRODUCT_LOST_WATCH:1, CONSECUTIVE_NO_ORDER:1, BEHIND_PATTERN:1, BEHIND_PATTERN_WATCH:1, VISIT_CONVERSION_LOW:1 };
  var NORMAL_ACCOUNT_CATEGORIES = { PURCHASE_DECLINE_SEVERE:1, PURCHASE_DECLINE_MILD:1, PURCHASE_DECLINE_WATCH:1, MULTI_SKU_DECLINE:1, PURCHASE_GROWTH:1, BASKET_SHRINK:1, BASKET_SHRINK_WATCH:1, LINE_DROP:1, LINE_DROP_WATCH:1, KEY_PRODUCT_LOST:1, KEY_PRODUCT_LOST_WATCH:1, CONSECUTIVE_NO_ORDER:1, BEHIND_PATTERN:1, BEHIND_PATTERN_WATCH:1, LONG_NO_VISIT:1, VISIT_OVERDUE:1, VISIT_CONVERSION_LOW:1, COMBINED_SKU_DETERIORATION:1, COMBINED_SKU_WATCH:1 };
  function accountDecisionAllows(a, category){
    if(!a || !category || NEVER_DEFER[category] || category==='CHECK_BOUNCED' || category==='PAYMENT_OVERDUE') return false;
    if(a.decision==='visit_reviewed') return !!NORMAL_ACCOUNT_CATEGORIES[category];
    if(a.decision==='no_need' || a.decision==='not_wanted' || a.decision==='price' || a.decision==='competitor' || a.decision==='still_stock') return !!PURCHASE_CATEGORIES[category];
    if(a.decision==='follow_up_later' || a.decision==='other') return !!NORMAL_ACCOUNT_CATEGORIES[category];
    return false;
  }
  function matchSignal(s){ if(!s||s.customerId==null||!s.category)return null; var rows=list(s.customerId,false); for(var i=0;i<rows.length;i++){var a=rows[i]; if(isImmediate(s))continue; if(a.scope==='account') { if(s.sourceLevel==='sku'||s.productId!=null)continue; if(!accountDecisionAllows(a,String(s.category)))continue; if(isCoreCompetitor(a))continue; return a; }
      // Product ACKs must never touch account-level decline/financial signals, even if a legacy signal carries a product id.
      if(/^PURCHASE_DECLINE/.test(String(s.category))||ACCOUNT_ONLY[s.category]||s.sourceLevel==='account'||s.productId==null||!productMatch(a,s))continue; return a;
    } return null; }
  function activePriorityAck(cid){ var rows=list(cid,false), now=today(); return rows.find(function(a){return a.scope==='account'&&a.decision==='visit_reviewed'&&a.priorityUntil&&isoDay(a.priorityUntil)>=now;})||null; }
  function createVisitAcks(cid, visit, products, coreProductIds){ if(!cid||!visit)return []; var out=[]; var day=isoDay(visit.date)||today();
    out.push(create({customerId:cid,scope:'account',decision:'visit_reviewed',durationDays:7,createdAt:new Date().toISOString(),expiresAt:dayAdd(day,7),source:'visit',sourceId:visit.id,subjectKey:'visit:'+visit.id,reason:'ویزیت معمولی',riskDelta:0,priorityDelta:-5,priorityUntil:dayAdd(day,3),visitDate:visit.date||day,riskOverride:false,actionText:'بررسی‌شده در ویزیت اخیر؛ پیگیری بعدی: '+dayAdd(day,7),watchMode:'defer'}));
    (products||[]).forEach(function(op){ if(!op||!op.productId||op.reaction!=='rejected'||!op.rejectionReason)return; var reason=op.rejectionReason, source=op.stockSource||'unknown', core=!!(coreProductIds&&coreProductIds[String(op.productId)]); var spec={decision:reason,durationDays:7,riskDelta:0,priorityDelta:0,riskOverride:false,actionText:'بررسی علت نامشخص — پیگیری بعدی',watchMode:'defer'};
      if(reason==='still_stock'&&source==='ours')spec={decision:'still_stock',durationDays:7,riskDelta:-30,priorityDelta:-5,actionText:'موجودی نزد مشتری؛ بررسی مجدد پس از ۷ روز',watchMode:'defer'};
      else if(reason==='still_stock'&&source==='competitor'&&core)spec={decision:'competitor',durationDays:7,riskDelta:10,priorityDelta:5,actionText:'بازگرداندن مشتری — خرید از رقیب',watchMode:'active',coreProduct:true};
      else if(reason==='still_stock'&&source==='competitor')spec={decision:'still_stock_competitor_noncore',durationDays:7,riskDelta:-10,priorityDelta:0,actionText:'موجودی از رقیب؛ بررسی مجدد پس از ۷ روز',watchMode:'defer'};
      else if(reason==='still_stock')spec={decision:'still_stock_unknown',durationDays:7,riskDelta:-10,priorityDelta:-3,actionText:'بپرس از ما دارد یا رقیب',watchMode:'defer'};
      else if(reason==='no_need')spec={decision:'no_need',durationDays:14,riskDelta:-30,priorityDelta:-5,actionText:'فعلاً نیاز ندارد؛ بررسی بعد از ۱۴ روز',watchMode:'defer'};
      else if(reason==='not_wanted')spec={decision:'not_wanted',durationDays:14,riskDelta:-40,priorityDelta:-8,actionText:'محصول را نمی‌خواهد؛ بازبینی پس از ۱۴ روز',watchMode:'defer'};
      else if(reason==='price')spec={decision:'price',durationDays:5,riskDelta:0,priorityDelta:0,actionText:'پیگیری قیمت / پیدا کردن راهکار',watchMode:'active'};
      else if(reason==='quality')spec={decision:'quality',durationDays:7,riskDelta:0,priorityDelta:0,actionText:'بررسی مشکل کیفیت محصول',watchMode:'active'};
      else if(reason==='competitor')spec={decision:'competitor',durationDays:7,riskDelta:core?10:0,priorityDelta:core?5:0,actionText:core?'بازگرداندن مشتری — خرید از رقیب':'برو بپرس این جنس را دیگر نمی‌خواهد؟',watchMode:'active',coreProduct:core};
      else if(reason==='unavailable')spec={decision:'unavailable',durationDays:7,riskDelta:0,priorityDelta:0,actionText:'موجودی کالا را بررسی کن',watchMode:'active'};
      else if(reason==='follow_up_later')spec={decision:'follow_up_later',durationDays:5,riskDelta:-10,priorityDelta:-3,actionText:'پیگیری مجدد',watchMode:'defer'};
      var p=(appData().products||[]).find(function(x){return x&&String(x.id)===String(op.productId);});
      out.push(create({customerId:cid,scope:'product',productId:op.productId,familyId:family(op.productId),decision:spec.decision,durationDays:spec.durationDays,createdAt:new Date().toISOString(),expiresAt:dayAdd(day,spec.durationDays),source:'visit',sourceId:visit.id,subjectKey:'visit:'+visit.id+':product:'+String(family(op.productId)),reason:reason,comment:source, riskDelta:spec.riskDelta,priorityDelta:spec.priorityDelta,priorityUntil:dayAdd(day,spec.durationDays),riskOverride:spec.riskOverride!==false,actionText:spec.actionText,watchMode:spec.watchMode,coreProduct:!!spec.coreProduct,productName:p&&p.name||''}));
    }); return out.filter(Boolean); }

  function migrateLegacy(){
    var app = appData();
    if(!app||!Array.isArray(app.customers))return {visits:0,feedback:0,watches:0};
    var counts={visits:0,feedback:0,watches:0};
    var existing={}; mem.forEach(function(a){if(a&&a.sourceId&&a.decision)existing[String(a.source||'')+'|'+String(a.sourceId)+'|'+String(a.subjectKey||'')]=true;});
    function supersedePurchasedVisitAcks(cid, visit, created){
      var invoices=Array.isArray(app.invoices)?app.invoices:[], visitDay=String(visit&&visit.date||'').slice(0,10);
      if(!visitDay)return;
      (created||[]).forEach(function(a){ if(!a||a.scope!=='product'||!a.productId)return;
        var hit=null;
        invoices.some(function(inv){ if(!inv||String(inv.customerId)!==String(cid))return false; var invDay=String(inv.date||inv.createdAt||inv.timestamp||'').slice(0,10); if(!invDay||invDay<visitDay)return false; return (inv.items||[]).some(function(it){ if(!it||!it.productId)return false; var same=String(it.productId)===String(a.productId)||(a.familyId!=null&&String(family(it.productId))===String(a.familyId)); if(same)hit=inv; return same; }); });
        if(hit) supersede(a.id,hit.id,'superseded_by_purchase');
      });
    }
    batchDepth++;
    try { (app.customers||[]).forEach(function(c){
      if(!c||!c.id)return;
      (c.visits||[]).slice().sort(function(a,b){return String(a&&a.date||'').localeCompare(String(b&&b.date||''));}).forEach(function(v){
        if(!v||!v.id||!v.date)return;
        var age=(new Date(today()+'T12:00:00').getTime()-new Date(String(v.date).slice(0,10)+'T12:00:00').getTime())/86400000;
        if(!isFinite(age)||age<0||age>14)return;
        var key='visit|'+String(v.id)+'|visit:'+String(v.id); if(existing[key]){
          var prior=mem.filter(function(a){return a&&a.source==='visit'&&String(a.sourceId)===String(v.id)&&String(a.customerId)===String(c.id);});
          supersedePurchasedVisitAcks(c.id,v,prior); return;
        }
        var cores=Object.create(null); (app.products||[]).forEach(function(p){if(p&&(p.isCore===true||p.coreProduct===true))cores[String(p.id)]=true;});
        var created=createVisitAcks(c.id,v,v.offeredProducts||[],cores); supersedePurchasedVisitAcks(c.id,v,created); counts.visits++; existing[key]=true;
      });
    });
    var feedback=[]; try{var raw=global.localStorage&&global.localStorage.getItem('bagheri_intelligence_seller_feedback'); var arr=raw&&JSON.parse(raw); if(Array.isArray(arr))feedback=arr;}catch(e){}
    feedback.forEach(function(f){ if(!f||!f.customerId||!f.reasonCode||!f.createdAt)return; var pid=f.productId==null?null:String(f.productId); var code=String(f.reasonCode); var days=code==='no_need'?14:code==='price_issue'?5:code==='still_stock'?7:code==='competitor_bought'?7:7; var decision=code==='competitor_bought'?'competitor':code==='price_issue'?'price':code==='liquidity'?'other':code; var scope=pid?'product':'account'; if(!pid&&decision!=='visit_reviewed') { /* explicit legacy account response is retained as an account ACK */ }
      var subject='legacy-feedback:'+String(f.id); var key='feedback|'+String(f.id)+'|'+subject; if(existing[key])return;
      create({customerId:f.customerId,scope:scope,productId:pid,familyId:pid?family(pid):null,decision:decision,durationDays:days,createdAt:f.createdAt,expiresAt:dayAdd(isoDay(f.createdAt)||today(),days),source:'feedback',sourceId:f.id,subjectKey:subject,reason:code,comment:f.comment||'',riskDelta:code==='still_stock'?-30:code==='competitor_bought'?20:0,priorityDelta:0,actionText:code==='price_issue'?'پیگیری قیمت / پیدا کردن راهکار':code==='competitor_bought'?'پیگیری خرید از رقیب':code==='no_need'?'فعلاً نیاز ندارد':'بررسی پاسخ ثبت‌شده',watchMode:code==='price_issue'||code==='competitor_bought'?'active':'defer'}); counts.feedback++; existing[key]=true;
    });
    var watches=[]; try{var wr=global.localStorage&&global.localStorage.getItem('bagheri_watch_occurrences_v1'); var wa=wr&&JSON.parse(wr); if(Array.isArray(wa))watches=wa; else if(wa&&typeof wa==='object')watches=Object.keys(wa).map(function(k){return wa[k];}).filter(Boolean);}catch(e){}
    watches.forEach(function(w){ if(!w||!w.id||!w.customerId||!w.reason||!w.reason.code)return; var code=String(w.reason.code); var allowed={still_stock:1,not_wanted:1,follow_up_later:1,price:1,competitor:1,no_need:1,quality:1,other:1}; if(!allowed[code])return; var subject='legacy-watch:'+String(w.id); var key='watch_migration|'+String(w.id)+'|'+subject; if(existing[key])return; var pid=w.productId==null?null:String(w.productId); if(code==='other'&&!pid)return; var days=code==='not_wanted'||code==='no_need'?14:code==='price'?5:code==='follow_up_later'?5:7;
      create({customerId:w.customerId,scope:pid?'product':'account',productId:pid,familyId:pid?family(pid):null,decision:code,durationDays:days,createdAt:(w.reason.recordedAt||w.lastEvaluatedAt||w.createdAt||new Date().toISOString()),expiresAt:dayAdd(isoDay(w.reason.recordedAt||w.lastEvaluatedAt||w.createdAt)||today(),days),source:'watch_migration',sourceId:w.id,subjectKey:subject,reason:code,comment:w.reason.comment||'',riskDelta:code==='still_stock'?-30:code==='not_wanted'?-40:0,priorityDelta:code==='still_stock'?-5:code==='not_wanted'?-8:0,riskOverride:code!=='other',actionText:code==='price'?'پیگیری قیمت / پیدا کردن راهکار':code==='follow_up_later'?'پیگیری مجدد':'بررسی تصمیم ثبت‌شده',watchMode:code==='price'||code==='competitor'?'active':'defer'}); counts.watches++; existing[key]=true;
    });
    } finally { batchDepth--; if(!batchDepth && batchDirty) save(); }
    return counts;
  }

  global.migrateSellerAcksFromLegacy=migrateLegacy;
  global.createSellerAck=create; global.listSellerAcks=list; global.reverseSellerAck=reverse; global.supersedeSellerAck=supersede; global.getSellerAckForSignal=matchSignal; global.getSellerAckPriorityAdjustment=activePriorityAck; global.createVisitSellerAcks=createVisitAcks; global.SELLER_ACK_VERSION=VERSION; global.SELLER_ACK_LS_KEY=LS; global.getSellerAckStorageStatus=function(){return idbStatus;};
})(typeof window!=='undefined'?window:this);
