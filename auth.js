/* تكسي وين: الحسابات والبيانات عبر Supabase */
const SUPABASE_URL='https://hdrfzbjtristtqfbmjnk.supabase.co';
const SUPABASE_KEY='sb_publishable_IB9rMwPpf-tlOjCtR75wzg_iPWi0TUS'; // مفتاح عام، مصمم يظهر بالموقع
const EMAIL_DOMAIN='taxiwayn.app'; // رقم الموبايل يتحول لإيميل داخلي: 07xxxxxxxxx@taxiwayn.app
const Auth=(()=>{
const sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
const phoneOf=p=>String(p||'').replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/\D/g,'');
const emailOf=p=>p+'@'+EMAIL_DOMAIN;
const LABEL={customer:'زبون',driver:'كابتن',admin:'مدير'};
const STATUS_AR={new:'جديد',accepted:'مقبول',completed:'مكتمل',cancelled:'ملغي'};
function msgOf(e){
 const m=(e&&e.message)||'';
 if(/invalid login/i.test(m))return 'الرقم أو كلمة السر غلط';
 if(/already registered|already been registered/i.test(m))return 'هذا الرقم مسجل من قبل، سجّل دخول';
 if(/not confirmed/i.test(m))return 'لازم تعطّل Confirm email من إعدادات Supabase';
 if(/rate limit|too many/i.test(m))return 'محاولات كثيرة، انتظر شوية وجرّب';
 if(/invalid/i.test(m)&&/email/i.test(m))return 'تعذر إنشاء الحساب (إيميل داخلي مرفوض). غيّر EMAIL_DOMAIN بملف auth.js';
 if(/taken/i.test(m))return 'الطلب انقبل من كابتن ثاني';
 if(/failed to fetch|network/i.test(m))return 'ماكو اتصال بالإنترنت';
 return m||'صار خطأ، جرّب مرة ثانية';
}
async function profileOf(uid){const{data,error}=await sb.from('profiles').select('*').eq('id',uid).maybeSingle();if(error)throw Error(msgOf(error));return data}
async function register(o){
 const role=o.role,name=(o.name||'').trim(),phone=phoneOf(o.phone),pw=o.password||'';
 if(!['customer','driver'].includes(role))throw Error('نوع حساب غير صحيح');
 if(name.length<2)throw Error('اكتب اسمك');
 if(!/^07\d{9}$/.test(phone))throw Error('رقم الموبايل لازم يكون مثل 07701234567');
 if(pw.length<6)throw Error('كلمة السر 6 رموز على الأقل');
 if(role==='driver'&&(!(o.car||'').trim()||!(o.plate||'').trim()))throw Error('اكتب نوع السيارة ورقم اللوحة');
 const{data,error}=await sb.auth.signUp({email:emailOf(phone),password:pw,options:{data:{role,name,phone,car:(o.car||'').trim(),plate:(o.plate||'').trim()}}});
 if(error)throw Error(msgOf(error));
 if(!data.session)throw Error('لازم تعطّل Confirm email من إعدادات Supabase');
 if(role==='driver'){await sb.auth.signOut();return{status:'pending'}}
 return{status:'active'};
}
async function login(role,phoneRaw,pw){
 const{data,error}=await sb.auth.signInWithPassword({email:emailOf(phoneOf(phoneRaw)),password:pw||''});
 if(error)throw Error(msgOf(error));
 const p=await profileOf(data.user.id);
 const bad=async m=>{await sb.auth.signOut();throw Error(m)};
 if(!p||p.role!==role)await bad('هذا الحساب مو حساب '+LABEL[role]);
 if(p.status==='pending')await bad('حسابك بانتظار موافقة المدير');
 if(p.status==='blocked')await bad('هذا الحساب موقوف');
 return p;
}
async function current(role){
 try{const{data:{session}}=await sb.auth.getSession();if(!session)return null;
 const p=await profileOf(session.user.id);return p&&p.role===role&&p.status==='active'?p:null}catch(e){return null}
}
async function guard(role){
 const p=await current(role);
 if(!p){location.replace('login.html?role='+role);return null}
 document.body.hidden=false;
 const el=document.getElementById('userbar');
 if(el){const s=document.createElement('span');s.textContent='👤 '+p.name;const b=document.createElement('button');b.className='secondary';b.textContent='خروج';b.onclick=()=>logout();el.replaceChildren(s,b)}
 return p;
}
async function logout(){await sb.auth.signOut();location.replace('index.html')}
async function rides(){const{data,error}=await sb.from('rides').select('*').order('created_at',{ascending:false});if(error)throw Error(msgOf(error));return data||[]}
async function addRide(r){const{error}=await sb.from('rides').insert(r);if(error)throw Error(msgOf(error))}
async function rpc(fn,id){const{error}=await sb.rpc(fn,{p_id:id});if(error)throw Error(msgOf(error))}
async function profiles(){const{data,error}=await sb.from('profiles').select('*').order('created_at',{ascending:false});if(error)throw Error(msgOf(error));return data||[]}
async function setStatus(id,status){const{error}=await sb.from('profiles').update({status}).eq('id',id);if(error)throw Error(msgOf(error))}
return{register,login,current,guard,logout,rides,addRide,rpc,profiles,setStatus,STATUS_AR,LABEL};
})();
