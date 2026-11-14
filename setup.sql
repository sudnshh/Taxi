-- تكسي وين: إنشاء الجداول والصلاحيات (شغّله مرة وحدة من Supabase > SQL Editor)

-- 1) الجداول
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('customer','driver','admin')),
  name text not null default '',
  phone text not null default '',
  car text,
  plate text,
  status text not null default 'active' check (status in ('pending','active','blocked')),
  created_at timestamptz not null default now()
);

create table if not exists public.rides (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id),
  customer_name text not null,
  customer_phone text,
  pickup_lat double precision not null,
  pickup_lng double precision not null,
  dest_lat double precision not null,
  dest_lng double precision not null,
  distance_km numeric,
  fare integer,
  status text not null default 'new' check (status in ('new','accepted','completed','cancelled')),
  driver_id uuid references public.profiles(id),
  driver_name text,
  driver_car text,
  driver_plate text,
  created_at timestamptz not null default now()
);

-- 2) دوال مساعدة
create or replace function public.my_role() returns text
language sql security definer set search_path = public stable as
$$ select role from public.profiles where id = auth.uid() and status = 'active' $$;

create or replace function public.is_admin() returns boolean
language sql security definer set search_path = public stable as
$$ select coalesce(public.my_role() = 'admin', false) $$;

create or replace function public.is_active_driver() returns boolean
language sql security definer set search_path = public stable as
$$ select coalesce(public.my_role() = 'driver', false) $$;

-- 3) إنشاء البروفايل تلقائياً عند التسجيل (الدور المسموح: زبون أو كابتن فقط)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare r text := coalesce(new.raw_user_meta_data->>'role','customer');
begin
  if r not in ('customer','driver') then r := 'customer'; end if;
  insert into public.profiles (id, role, name, phone, car, plate, status)
  values (new.id, r,
          coalesce(new.raw_user_meta_data->>'name',''),
          coalesce(new.raw_user_meta_data->>'phone',''),
          new.raw_user_meta_data->>'car',
          new.raw_user_meta_data->>'plate',
          case when r = 'driver' then 'pending' else 'active' end);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- 4) تحويلات حالة الرحلة (بدوال محمية حتى ما أحد يعدّل بيانات غيره)
create or replace function public.accept_ride(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare d public.profiles%rowtype;
begin
  select * into d from public.profiles where id = auth.uid() and role = 'driver' and status = 'active';
  if not found then raise exception 'not allowed'; end if;
  update public.rides set status='accepted', driver_id=d.id, driver_name=d.name, driver_car=d.car, driver_plate=d.plate
   where id = p_id and status = 'new';
  if not found then raise exception 'taken'; end if;
end $$;

create or replace function public.complete_ride(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.rides set status='completed' where id = p_id and driver_id = auth.uid() and status = 'accepted';
  if not found then raise exception 'not allowed'; end if;
end $$;

create or replace function public.cancel_ride(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.rides set status='cancelled' where id = p_id and customer_id = auth.uid() and status = 'new';
  if not found then raise exception 'not allowed'; end if;
end $$;

-- 5) الأمان (RLS)
alter table public.profiles enable row level security;
alter table public.rides enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists rides_select on public.rides;
create policy rides_select on public.rides for select to authenticated
  using (customer_id = auth.uid()
         or public.is_admin()
         or (public.is_active_driver() and (status = 'new' or driver_id = auth.uid())));

drop policy if exists rides_insert on public.rides;
create policy rides_insert on public.rides for insert to authenticated
  with check (customer_id = auth.uid() and status = 'new' and driver_id is null and public.my_role() = 'customer');

-- 6) الصلاحيات الصريحة (لأن الكشف التلقائي للجداول مطفي)
grant usage on schema public to anon, authenticated;
grant select on public.profiles to authenticated;
grant update (status) on public.profiles to authenticated;
grant select, insert on public.rides to authenticated;
grant execute on function public.accept_ride(uuid), public.complete_ride(uuid), public.cancel_ride(uuid) to authenticated;
