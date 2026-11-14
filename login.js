/* Dedicated role login pages; the role is fixed by the actual page, not by a URL parameter. */
(async()=>{
 const role=document.body.dataset.role;
 const C={customer:{title:'🚕 الزبون',next:'customer.html',reg:true,desc:'احجز مشوارك بسهولة'},driver:{title:'🚗 الكابتن',next:'driver.html',reg:true,desc:'استقبل الطلبات وتحكم باتصالك'},admin:{title:'⚙️ الإدارة',next:'admin.html',reg:false,desc:'تابع رحلاتك وأدر الكباتن والخصومات'}}[role];
 if(!C){location.replace('index.html');return;}
 const box=document.getElementById('box');
 if(await Auth.current(role)){location.replace(C.next);return;}
 function el(id){return document.getElementById(id)}
 function field(id,label,type='text',placeholder='',autocomplete='off'){
  const labelEl=document.createElement('label');labelEl.htmlFor=id;labelEl.textContent=label;
  const input=document.createElement('input');Object.assign(input,{id,type,placeholder,autocomplete});input.required=true;
  labelEl.append(input);return labelEl;
 }
 function render(mode){
  const reg=mode==='register'&&C.reg;
  box.replaceChildren();
  const header=document.createElement('div');header.className='login-hero';
  const logo=document.createElement('div');logo.className='login-icon';logo.textContent=role==='driver'?'🚗':role==='admin'?'⚙️':'🚕';
  const title=document.createElement('h1');title.textContent=C.title+(reg?' — حساب جديد':' — تسجيل الدخول');
  const lead=document.createElement('p');lead.textContent=C.desc;header.append(logo,title,lead);box.append(header);
  const form=document.createElement('form');form.className='login-form';form.noValidate=true;
  if(reg)form.append(field('name','الاسم الكامل','text','اسمك الكامل','name'));
  form.append(field('phone','رقم الموبايل','tel','07xxxxxxxxx','tel'));
  if(reg&&role==='driver'){form.append(field('car','نوع السيارة','text','مثلاً: تويوتا كورولا'));form.append(field('plate','رقم اللوحة','text','رقم اللوحة'));}
  form.append(field('pw','كلمة السر','password','6 رموز على الأقل',reg?'new-password':'current-password'));
  if(reg)form.append(field('pw2','تأكيد كلمة السر','password','أعد كتابة كلمة السر','new-password'));
  const go=document.createElement('button');go.type='submit';go.className='accent full-btn';go.textContent=reg?'إنشاء الحساب':'دخول إلى '+(role==='customer'?'واجهة الزبون':role==='driver'?'لوحة الكابتن':'الإدارة');
  const msg=document.createElement('p');msg.id='msg';msg.className='notice err';msg.setAttribute('role','alert');form.append(go,msg);
  if(C.reg){const switcher=document.createElement('p');switcher.className='login-switch';
   const sw=document.createElement('a');sw.href='#';sw.textContent=reg?'عندك حساب؟ سجّل دخول':'أول مرة؟ سوّي حساب جديد';
   sw.onclick=e=>{e.preventDefault();history.replaceState(null,'',location.pathname+(reg?'':'?mode=register'));render(reg?'login':'register')};switcher.append(sw);form.append(switcher);
  }
  form.onsubmit=async e=>{
   e.preventDefault();msg.textContent='';msg.className='notice err';go.disabled=true;
   try{
    if(reg){
     if(el('pw').value!==el('pw2').value)throw Error('كلمتي السر مو متطابقتين');
     const result=await Auth.register({role,name:el('name').value,phone:el('phone').value,password:el('pw').value,car:el('car')?.value,plate:el('plate')?.value});
     if(result.status==='pending'){history.replaceState(null,'',location.pathname);render('login');el('msg').className='notice ok';el('msg').textContent='✅ انرسل طلبك. تقدر تدخل بعد ما المدير يوافق على حسابك.';return;}
    }else await Auth.login(role,el('phone').value,el('pw').value);
    location.replace(C.next);
   }catch(error){msg.textContent='⚠️ '+error.message;go.disabled=false;}
  };
  box.append(form);
 }
 render(new URLSearchParams(location.search).get('mode')==='register'?'register':'login');
})();
