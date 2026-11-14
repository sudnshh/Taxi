/* Admin interface with driver approval and server-protected promo management. */
(async()=>{
 if(!await Auth.guard('admin'))return;
 const $=id=>document.getElementById(id),msg=$('msg');
 const lbl={pending:'بانتظار الموافقة',active:'فعّال',blocked:'موقوف'},cls={pending:'new',active:'ok',blocked:'bad'};
 const money=n=>Number(n).toLocaleString('en-US')+' د.ع';
 function action(label,fn,style='secondary'){
  const b=document.createElement('button');b.type='button';b.className=style;b.textContent=label;
  b.onclick=async()=>{b.disabled=true;msg.textContent='';try{await fn();}catch(e){msg.textContent='⚠️ '+e.message;}await render();};
  return b;
 }
 function drawPromotions(promos){
  const box=$('promo-list');box.replaceChildren();
  if(!promos.length){box.className='empty-state';box.textContent='ماكو أكواد خصم بعد. أنشئ أول كود من النموذج أعلاه.';return;}
  box.className='';
  promos.forEach(p=>{
   const row=document.createElement('div');row.className='promo-row row';
   const text=document.createElement('div');
   const code=document.createElement('strong');code.textContent=p.code+' — خصم '+p.discount_percent+'%';
   const details=document.createElement('div');details.className='trip-meta';
   details.textContent='استخدامات: '+p.uses_count+(p.max_uses!==null?' / '+p.max_uses:' / غير محدود')+(p.expires_at?' · ينتهي '+new Date(p.expires_at).toLocaleString('ar-IQ'):' · بدون انتهاء');
   text.append(code,details);row.append(text,action(p.active?'إيقاف الكود':'تفعيل الكود',()=>Auth.setPromotionActive(p.id,!p.active),p.active?'secondary':'accent'));box.append(row);
  });
 }
 async function render(){
  try{
   const [users,rides,promos]=await Promise.all([Auth.profiles(),Auth.rides(),Auth.promotions()]);
   const drivers=users.filter(x=>x.role==='driver');
   const on=drivers.filter(x=>x.status==='active'&&x.driver_online&&x.driver_last_seen_at&&Date.now()-Date.parse(x.driver_last_seen_at)<90000).length;
   const stats=$('stats');stats.className='stats-grid';stats.replaceChildren();
   for(const [label,value] of [['الزبائن',users.filter(x=>x.role==='customer').length],['الكباتن',drivers.length],['متصلين الآن',on],['طلبات جديدة',rides.filter(r=>r.status==='new').length],['الرحلات المكتملة',rides.filter(r=>r.status==='completed').length]]){
    const item=document.createElement('div');item.className='stat-box';const number=document.createElement('strong');number.textContent=value;const t=document.createElement('span');t.textContent=label;item.append(number,t);stats.append(item);
   }
   drawPromotions(promos);
   const d=$('drivers');d.replaceChildren();
   drivers.forEach(x=>{
    const row=document.createElement('div');row.className='row driver-admin-row';
    const info=document.createElement('div');
    const badge=document.createElement('span');badge.className='badge '+cls[x.status];badge.textContent=lbl[x.status];
    const name=document.createElement('span');name.textContent=' '+x.name+' — '+x.phone+' — '+(x.car||'')+' — '+(x.plate||'');
    info.append(badge,name);
    if(x.status==='active'){
     const online=x.driver_online&&x.driver_last_seen_at&&Date.now()-Date.parse(x.driver_last_seen_at)<90000;
     const dot=document.createElement('span');dot.className='badge '+(online?'ok':'');dot.textContent=online?'● متصل':'○ غير متصل';info.append(' ',dot);
    }
    row.append(info);
    if(x.status==='pending')row.append(action('موافقة',()=>Auth.setStatus(x.id,'active'),'accent'),action('رفض',()=>Auth.setStatus(x.id,'blocked')));
    if(x.status==='active')row.append(action('إيقاف الحساب',()=>Auth.setStatus(x.id,'blocked')));
    if(x.status==='blocked')row.append(action('تفعيل الحساب',()=>Auth.setStatus(x.id,'active'),'accent'));
    d.append(row);
   });
   if(!drivers.length){d.textContent='ماكو كباتن مسجلين بعد';}
   const r=$('rides');r.replaceChildren();
   rides.forEach(x=>{
    const row=document.createElement('div');row.className='row';
    const badge=document.createElement('span');badge.className='badge '+({new:'new',accepted:'ok',completed:'ok',cancelled:'bad'}[x.status]||'');badge.textContent=Auth.STATUS_AR[x.status]||x.status;
    const data=document.createElement('span');data.textContent=' '+x.customer_name+' — '+(x.fare!=null?money(x.fare):'غير متوفر')+(x.driver_name?' — الكابتن: '+x.driver_name:'')+(x.promo_code?' — كود: '+x.promo_code:'');row.append(badge,data);r.append(row);
   });
   if(!rides.length)r.textContent='ماكو رحلات بعد';
  }catch(e){msg.textContent='⚠️ '+e.message;}
 }
 $('promo-form').onsubmit=async e=>{
  e.preventDefault();msg.textContent='';
  const submit=$('promo-form').querySelector('button[type=submit]');submit.disabled=true;
  try{
   const code=$('code').value.trim().toUpperCase(),percent=Number($('percent').value),max=$('max-uses').value.trim();
   if(!/^[A-Z0-9_-]{3,24}$/.test(code))throw Error('كود الخصم لازم يكون 3–24 حرف إنكليزي أو رقم');
   if(!Number.isInteger(percent)||percent<1||percent>100)throw Error('نسبة الخصم لازم تكون من 1 إلى 100');
   if(max&&(!Number.isInteger(Number(max))||Number(max)<1))throw Error('عدد الاستخدامات لازم يكون رقم موجب');
   const expires=$('expires').value;
   if(expires&&new Date(expires).getTime()<=Date.now())throw Error('تاريخ الانتهاء لازم يكون بالمستقبل');
   await Auth.addPromotion({code,discount_percent:percent,max_uses:max?Number(max):null,expires_at:expires?new Date(expires).toISOString():null,active:true});
   $('promo-form').reset();msg.className='notice ok';msg.textContent='✅ تم إنشاء كود الخصم';await render();
  }catch(err){msg.className='notice err';msg.textContent='⚠️ '+err.message;}
  finally{submit.disabled=false;}
 };
 render();setInterval(render,10000);
})();
