/* Passenger screen: text search + manual map selection + server-verified promotional fares. */
(async () => {
  const me = await Auth.guard('customer');
  if (!me) return;
  const $ = id => document.getElementById(id);
  const status = $('status'), message = $('message'), promoMsg = $('promo-msg'), book = $('book');
  const money = n => Number(n).toLocaleString('en-US') + ' د.ع';
  const map = L.map('map', {zoomControl: false}).setView([33.1, 44.0], 7);
  L.control.zoom({position:'bottomleft'}).addTo(map);
  const streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom: 19, attribution:'&copy; OpenStreetMap contributors'}).addTo(map);
  const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {maxZoom: 18, attribution:'Tiles &copy; Esri'});
  L.control.layers({'🗺️ خريطة': streets, '🛰️ قمر صناعي': satellite}, null, {position:'topleft'}).addTo(map);
  const icons = {
    pickup:L.divIcon({className:'',html:'<div class="map-pin-pick"></div>',iconSize:[27,27],iconAnchor:[13,13]}),
    destination:L.divIcon({className:'',html:'<div class="map-pin-dest">🏁</div>',iconSize:[34,34],iconAnchor:[17,17]})
  };
  const points = {pickup:null,destination:null}, markers = {pickup:null,destination:null};
  let active = 'pickup', line = null, routeKm = null, quote = null, appliedPromo = null;
  let routeController = null, routeRevision = 0, quoteRevision = 0, nextGeocodeAt = 0, booked = false;
  const fields = {
    pickup:{input:$('pickup-input'),results:$('pickup-results'),helper:$('pickup-helper'),wrap:$('pickup-wrap')},
    destination:{input:$('destination-input'),results:$('destination-results'),helper:$('destination-helper'),wrap:$('destination-wrap')}
  };
  function chooseMode(kind) {
    active=kind;
    Object.keys(fields).forEach(k=>fields[k].wrap.classList.toggle('map-pick-active', k===kind));
    status.textContent=kind==='pickup'?'📍 اضغط على الخريطة حتى تحدد مكان الانطلاق':'🏁 اضغط على الخريطة حتى تحدد الوجهة';
  }
  $('pickup-map').onclick=()=>{chooseMode('pickup');$('map').scrollIntoView({behavior:'smooth',block:'center'});};
  $('destination-map').onclick=()=>{chooseMode('destination');$('map').scrollIntoView({behavior:'smooth',block:'center'});};
  const validCoords = ll => ll && Number.isFinite(ll.lat) && Number.isFinite(ll.lng) && Math.abs(ll.lat)<=90 && Math.abs(ll.lng)<=180;
  const coordsText = ll => `${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}`;
  const niceName = text => String(text||'').split(',').slice(0,3).join('،').trim();
  function clearRoute() {
    routeRevision++; quoteRevision++;
    if (routeController) routeController.abort();
    if (line) {map.removeLayer(line);line=null;}
    routeKm=null;quote=null;booked=false;book.disabled=true;
    $('distance-label').textContent='—';$('base-label').textContent='—';$('discount-label').textContent='—';$('fare').textContent='حدد وجهتك';
  }
  function displayQuote() {
    if (!quote) return;
    $('distance-label').textContent=routeKm.toFixed(1)+' كم';
    $('base-label').textContent=money(quote.base_fare);
    $('discount-label').textContent=quote.discount_amount ? '− '+money(quote.discount_amount) : 'لا يوجد';
    $('fare').textContent=money(quote.fare);
    book.disabled=false;
  }
  async function fetchGeocode(url) {
    // Nominatim public usage requires explicit search and maximum one request/second.
    const pause=Math.max(0,nextGeocodeAt-Date.now());
    nextGeocodeAt=Date.now()+pause+1200;
    if(pause) await new Promise(resolve=>setTimeout(resolve,pause));
    const response=await fetch(url,{headers:{'Accept':'application/json'}});
    if(!response.ok) throw Error('خدمة البحث عن المواقع غير متوفرة حالياً');
    return response.json();
  }
  async function reverseName(kind, ll) {
    try {
      const url='https://nominatim.openstreetmap.org/reverse?format=jsonv2&accept-language=ar&zoom=17&lat='+ll.lat+'&lon='+ll.lng;
      const data=await fetchGeocode(url);
      if(points[kind]!==ll)return;
      fields[kind].input.value=niceName(data.display_name)||coordsText(ll);
    } catch(_) { /* Coordinates remain usable even when geocoding is unavailable. */ }
  }
  function setPoint(kind,ll,label=null) {
    if(!validCoords(ll))return;
    clearRoute();points[kind]=L.latLng(ll.lat,ll.lng);
    if(markers[kind]) markers[kind].setLatLng(points[kind]);
    else {
      markers[kind]=L.marker(points[kind],{icon:icons[kind],draggable:true}).addTo(map);
      markers[kind].on('dragend',()=>setPoint(kind,markers[kind].getLatLng()));
    }
    fields[kind].results.replaceChildren();
    fields[kind].input.value=label||coordsText(points[kind]);
    fields[kind].helper.textContent='✓ تم تحديد الموقع — تكدر تسحب العلامة لتغييره';
    fields[kind].helper.style.color='#17835b';
    if(!label) reverseName(kind,points[kind]);
    message.textContent='';
    if(points.pickup&&points.destination){chooseMode('destination');calculateRoute();}
    else if(kind==='pickup')chooseMode('destination');
    else chooseMode('pickup');
  }
  map.on('click',e=>setPoint(active,e.latlng));
  for(const kind of Object.keys(fields)){
    const f=fields[kind];
    f.input.addEventListener('input',()=>{
      if(points[kind]){
        points[kind]=null;
        if(markers[kind]){map.removeLayer(markers[kind]);markers[kind]=null;}
        clearRoute();
        chooseMode(kind);
      }
      f.results.replaceChildren();
      f.helper.textContent='اضغط بحث للعثور على هذا المكان أو اختاره من الخريطة';
      f.helper.style.color='';
    });
    f.input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();searchPlace(kind);}});
    $(kind+'-search').onclick=()=>searchPlace(kind);
  }
  async function searchPlace(kind) {
    const f=fields[kind],term=f.input.value.trim();
    if(term.length<2){f.helper.textContent='اكتب اسم منطقة أو شارع على الأقل';return;}
    f.results.replaceChildren(); f.helper.textContent='⏳ دا نبحث عن المكان...';
    const original=term;
    try {
      const results=await fetchGeocode('https://nominatim.openstreetmap.org/search?format=jsonv2&accept-language=ar&countrycodes=iq&limit=5&q='+encodeURIComponent(term));
      if(f.input.value.trim()!==original)return;
      if(!results.length){f.helper.textContent='ما لكينا المكان. جرّب اسم أقرب منطقة أو حدد بالخريطة.';return;}
      f.helper.textContent='اختار النتيجة الصحيحة:';
      results.forEach(place=>{
        const li=document.createElement('li'),button=document.createElement('button');button.type='button';
        button.textContent='📍 '+niceName(place.display_name);
        button.onclick=()=>{const ll=L.latLng(Number(place.lat),Number(place.lon));setPoint(kind,ll,niceName(place.display_name));map.setView(ll,15);};
        li.append(button);f.results.append(li);
      });
    }catch(e){f.helper.textContent='⚠️ '+e.message+' — تگدر تستخدم الخريطة بدلاً عنها.';}
  }
  async function getQuote(promo=null) {
    const revision=++quoteRevision, km=routeKm;
    if(km===null)return;
    book.disabled=true;
    $('fare').textContent='دا نحسب السعر...';
    try {
      const result=await Auth.quoteRide(km,promo);
      if(revision!==quoteRevision||routeKm!==km)return;
      quote=result;
      displayQuote();
      if(promo)promoMsg.textContent='✅ تم تطبيق كود '+promo+' — وفرت '+money(result.discount_amount);
    }catch(e){
      if(revision!==quoteRevision)return;
      quote=null;book.disabled=true;
      $('fare').textContent='السعر غير متاح';
      if(promo){promoMsg.textContent='⚠️ '+e.message;promoMsg.style.color='#b43535';appliedPromo=null;getQuote();}
      else message.textContent='⚠️ '+e.message;
    }
  }
  async function calculateRoute() {
    if(!points.pickup||!points.destination)return;
    const revision=++routeRevision;
    const from=points.pickup,to=points.destination;
    routeKm=null;quote=null;book.disabled=true;
    $('fare').textContent='⏳ دا نحسب المشوار';
    status.textContent='دا نحسب الطريق والمسافة...';
    if(routeController) routeController.abort();
    routeController=new AbortController();
    try{
      const path=`https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
      const res=await fetch(path,{signal:routeController.signal});
      if(!res.ok)throw Error('routing');
      const data=await res.json();
      if(!data.routes?.length)throw Error('no route');
      if(revision!==routeRevision)return;
      routeKm=data.routes[0].distance/1000;
      if(line)map.removeLayer(line);
      const geometry=data.routes[0].geometry;
      line=L.featureGroup([
        L.geoJSON(geometry,{style:{color:'#273326',weight:9,opacity:.9}}),
        L.geoJSON(geometry,{style:{color:'#f6c538',weight:5,opacity:1}})
      ]).addTo(map);
      map.fitBounds(line.getBounds(),{padding:[40,40],maxZoom:16});
      $('distance-label').textContent=routeKm.toFixed(1)+' كم';
      status.textContent='✅ تم تحديد الطريق بنجاح';
      await getQuote(appliedPromo);
    }catch(e){
      if(e.name==='AbortError'||revision!==routeRevision)return;
      status.textContent='⚠️ ما كدرنا نحدد طريق بين المكانين';
      $('fare').textContent='المسافة غير متوفرة';
      message.textContent='جرّب تغيّر المكان أو تعيد التحديد. ما ممكن نطلب بدون سعر.';
    }
  }
  $('locate').onclick=()=>{
    if(!navigator.geolocation){status.textContent='تحديد الموقع غير مدعوم بالمتصفح';return;}
    status.textContent='⏳ دا نحدد موقعك...';
    navigator.geolocation.getCurrentPosition(pos=>{
      const ll=L.latLng(pos.coords.latitude,pos.coords.longitude);
      setPoint('pickup',ll);map.setView(ll,15);
    },()=>{status.textContent='ما كدرنا نوصل لموقعك. اسمح للموقع أو اختار من الخريطة.';},{enableHighAccuracy:true,timeout:12000});
  };
  $('reset').onclick=()=>{
    clearRoute();
    for(const kind of Object.keys(fields)){
      if(markers[kind]){map.removeLayer(markers[kind]);markers[kind]=null;}
      points[kind]=null;fields[kind].input.value='';fields[kind].results.replaceChildren();fields[kind].helper.textContent='اختار من الخريطة أو ابحث عن منطقتك';fields[kind].helper.style.color='';
    }
    appliedPromo=null;$('promo-input').value='';promoMsg.textContent='الخصم ينحسب قبل تأكيد الحجز';promoMsg.style.color='';message.textContent='';chooseMode('pickup');
  };
  $('promo-input').oninput=()=>{
    if(appliedPromo){appliedPromo=null;promoMsg.textContent='اضغط تطبيق لتفعيل الكود الجديد';promoMsg.style.color='';if(routeKm!==null)getQuote();}
  };
  $('apply-promo').onclick=async()=>{
    const entered=$('promo-input').value.trim().toUpperCase();
    const kmAtStart=routeKm, routeAtStart=routeRevision;
    if(!entered){appliedPromo=null;promoMsg.textContent='تم إزالة كود الخصم';promoMsg.style.color='';if(routeKm!==null)await getQuote();return;}
    if(routeKm===null){promoMsg.textContent='حدد من وين ولوين، وانتظر حساب المسافة أولاً';return;}
    promoMsg.style.color='';promoMsg.textContent='⏳ دا نتحقق من الكود...';
    // Only activate a promotion after the server confirms its validity.
    try{
      const result=await Auth.quoteRide(routeKm,entered);
      if(!points.pickup||!points.destination||routeKm!==kmAtStart||routeRevision!==routeAtStart)return;
      appliedPromo=entered;
      quote=result;quoteRevision++;displayQuote();
      promoMsg.textContent='✅ كود فعال — وفرت '+money(result.discount_amount);
      promoMsg.style.color='#13875a';
    }catch(e){appliedPromo=null;promoMsg.textContent='⚠️ '+e.message;promoMsg.style.color='#bd3535';await getQuote();}
  };
  book.onclick=async()=>{
    if(!points.pickup||!points.destination||routeKm===null||!quote){message.textContent='حدد الطريق والسعر أولاً';return;}
    if(booked)return;
    book.disabled=true;message.textContent='⏳ دا نرسل طلبك...';
    try{
      await Auth.createRide({pickup_lat:points.pickup.lat,pickup_lng:points.pickup.lng,dest_lat:points.destination.lat,dest_lng:points.destination.lng,distance_km:Number(routeKm.toFixed(2)),promo_code:appliedPromo});
      booked=true;message.className='notice ok';message.textContent='✅ انرسل الطلب بنجاح! دا ننتظر كابتن يقبله.';
      await renderMine();
    }catch(e){message.className='notice err';message.textContent='⚠️ '+e.message;book.disabled=false;}
  };
  async function renderMine(){
    const box=$('mine');
    try{
      const list=await Auth.rides();
      if(!list.length){box.className='empty-state';box.textContent='بعدك ما عندك رحلات. أول مشوار ينتظرك 🚕';return;}
      box.className='';
      box.replaceChildren(...list.map(r=>{
        const div=document.createElement('div');div.className='trip-row';
        const top=document.createElement('div');top.className='trip-top';
        const badge=document.createElement('span');badge.className='badge '+({new:'new',accepted:'ok',completed:'ok',cancelled:'bad'}[r.status]||'');badge.textContent=Auth.STATUS_AR[r.status]||r.status;
        const price=document.createElement('b');price.textContent=r.fare!=null?money(r.fare):'—';top.append(badge,price);
        const meta=document.createElement('div');meta.className='trip-meta';meta.textContent=(r.distance_km??'؟')+' كم'+(r.driver_name?' · الكابتن '+r.driver_name+' · '+(r.driver_car||''):'')+(r.discount_amount?' · خصم '+money(r.discount_amount):'');
        div.append(top,meta);
        if(r.status==='new'){
          const cancel=document.createElement('button');cancel.className='secondary mini-btn';cancel.textContent='إلغاء الطلب';
          cancel.onclick=async()=>{cancel.disabled=true;try{await Auth.rpc('cancel_ride',r.id);}catch(e){message.textContent='⚠️ '+e.message;}renderMine();};
          div.append(cancel);
        }
        return div;
      }));
    }catch(e){box.className='empty-state';box.textContent='⚠️ '+e.message;}
  }
  renderMine();setInterval(renderMine,5000);
})();
