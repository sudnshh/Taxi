/* Captain screen. Presence is held in Supabase, not localStorage. */
(async()=>{
  const me=await Auth.guard('driver');if(!me)return;
  const $=id=>document.getElementById(id),msg=$('msg'),toggle=$('presence-toggle');
  // A stale browser/session must not count as connected.
  let online=!!(me.driver_online&&me.driver_last_seen_at&&Date.now()-Date.parse(me.driver_last_seen_at)<90000);
  let busy=false;
  const money=n=>Number(n).toLocaleString('en-US')+' د.ع';
  function paint(){
    $('presence-dot').className='presence-dot'+(online?' online':'');
    $('presence-text').textContent=online?'متصل الآن · جاهز للطلبات':'غير متصل · ما تستقبل طلبات';
    toggle.className='presence-button'+(online?' online':'');
    toggle.textContent=online?'⏻ إيقاف الاستقبال':'⏻ تشغيل الاستقبال';
    toggle.disabled=busy;
    $('presence-help').textContent=online?'✅ أنت الآن Online. طلبات الزبائن تظهر بالأسفل. خليك فاتح الصفحة واتصالك بالإنترنت شغّال.':'إذا ضغطت تشغيل، تصير Online وتبدأ تستقبل الطلبات. إطفاء الزر يمنع قبول طلبات جديدة.';
  }
  async function changePresence(value){
    if(busy)return;busy=true;paint();msg.textContent='';
    try{
      await Auth.setDriverOnline(value);
      online=value;
      await render();
    }catch(e){msg.textContent='⚠️ '+e.message;}
    finally{busy=false;paint();}
  }
  toggle.onclick=()=>changePresence(!online);
  function mapLink(r){
    const a=document.createElement('a');a.href='https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route='+encodeURIComponent(r.pickup_lat+','+r.pickup_lng+';'+r.dest_lat+','+r.dest_lng);
    a.target='_blank';a.rel='noopener noreferrer';a.textContent='🗺️ افتح طريق الرحلة';return a;
  }
  function rideCard(r,canAccept){
    const x=document.createElement('div');x.className='captain-ride';
    const top=document.createElement('div');top.className='trip-top';
    const name=document.createElement('strong');name.textContent=r.customer_name||'زبون';
    const badge=document.createElement('span');badge.className='badge '+({new:'new',accepted:'ok',completed:'ok',cancelled:'bad'}[r.status]||'');badge.textContent=Auth.STATUS_AR[r.status]||r.status;
    top.append(name,badge);
    const detail=document.createElement('div');detail.className='ride-details';
    detail.textContent='📞 '+(r.customer_phone||'—')+'   ·   🛣️ '+(r.distance_km??'؟')+' كم   ·   💰 '+(r.fare!=null?money(r.fare):'غير متوفر');
    x.append(top,detail,mapLink(r));
    if(canAccept)x.append(action('قبول الطلب',()=>Auth.rpc('accept_ride',r.id),'accent'));
    if(r.status==='accepted'&&r.driver_id===me.id)x.append(action('إنهاء الرحلة',()=>Auth.rpc('complete_ride',r.id)));
    return x;
  }
  function action(label,fn,kind='secondary'){
    const b=document.createElement('button');b.className=kind;b.textContent=label;
    b.onclick=async()=>{b.disabled=true;msg.textContent='';try{await fn();}catch(e){msg.textContent='⚠️ '+e.message;}await render();};
    return b;
  }
  async function render(){
    try{
      const all=await Auth.rides(),open=online?all.filter(r=>r.status==='new'):[],mine=all.filter(r=>r.driver_id===me.id);
      $('new-count').textContent=open.length+' طلب';
      const o=$('open'),m=$('mine');
      if(online&&open.length){o.className='';o.replaceChildren(...open.map(r=>rideCard(r,true)));}
      else{o.className='empty-state';o.textContent=online?'ماكو طلبات جديدة حالياً. أول ما يجي طلب راح يظهر هنا.':'أنت حالياً غير متصل. شغّل استقبال الطلبات من الزر أعلاه.';}
      if(mine.length){m.className='';m.replaceChildren(...mine.map(r=>rideCard(r,false)));}
      else{m.className='empty-state';m.textContent='ما عندك رحلات لحد الآن';}
    }catch(e){msg.textContent='⚠️ '+e.message;}
  }
  async function heartbeat(){
    if(!online||busy)return;
    try{await Auth.setDriverOnline(true);}
    catch(e){online=false;msg.textContent='⚠️ انقطع الاتصال بالخادم. فعّل الاستقبال من جديد.';paint();await render();}
  }
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)heartbeat();});
  paint();toggle.disabled=false;render();
  setInterval(()=>{render();},5000);
  setInterval(heartbeat,30000);
})();
