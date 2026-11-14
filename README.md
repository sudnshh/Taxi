# تكسي وين — نسخة Supabase

## الإعداد (مرة وحدة)
1. Supabase > Authentication > Sign In / Providers > Email: عطّل **Confirm email** واحفظ.
2. Supabase > SQL Editor: الصق محتوى `setup.sql` واضغط Run.
3. ارفع كل الملفات لجذر مستودع GitHub Pages.
4. سجّل حساب من صفحة الزبون برقمك، وبعدها شغّل بـ SQL Editor:
   `update public.profiles set role='admin', status='active' where phone='07XXXXXXXXX';`
   وادخل من "مدير" بنفس الرقم وكلمة السر.

## ملاحظات
- رقم الموبايل يتحول داخلياً لإيميل `07xxxxxxxxx@taxiwayn.app` (غيّر `EMAIL_DOMAIN` بـ auth.js إذا رفضه Supabase).
- حساب واحد لكل رقم، ودوره ثابت (زبون / كابتن / مدير).
- المتصفح يحمل جلسة وحدة، فجرّب كل دور بمتصفح أو نافذة خاصة مختلفة.
- المفتاح بـ auth.js هو publishable العام. لا تحط secret / service_role أبداً.
- الصفحات تتحدث كل 5 ثواني. لا يوجد SMS ولا استرجاع كلمة سر بعد.
