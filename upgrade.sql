-- Taxi Wayn upgrade for EXISTING Supabase projects.
-- Run setup.sql only on a new database. Run this upgrade.sql on both new and existing projects.
-- Retains accounts, existing rides and current role-based access control.

begin;

-- Driver presence is persisted and considered online only while heartbeats are fresh.
alter table public.profiles
  add column if not exists driver_online boolean not null default false;
alter table public.profiles
  add column if not exists driver_last_seen_at timestamptz;

-- Promo codes are managed exclusively by administrators; public validation happens by RPC.
create table if not exists public.promotions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  discount_percent integer not null check (discount_percent between 1 and 100),
  active boolean not null default true,
  max_uses integer check (max_uses is null or max_uses > 0),
  uses_count integer not null default 0 check (uses_count >= 0),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  constraint promo_code_chars check (code ~ '^[A-Z0-9_-]{3,24}$')
);

alter table public.rides add column if not exists base_fare integer;
alter table public.rides add column if not exists discount_amount integer not null default 0;
alter table public.rides add column if not exists promo_code text;

create index if not exists rides_customer_created_idx on public.rides(customer_id, created_at desc);
create index if not exists rides_driver_idx on public.rides(driver_id) where driver_id is not null;
create index if not exists rides_new_idx on public.rides(created_at desc) where status = 'new';

alter table public.promotions enable row level security;
drop policy if exists promotions_admin_select on public.promotions;
create policy promotions_admin_select on public.promotions for select to authenticated
 using (public.is_admin());
drop policy if exists promotions_admin_insert on public.promotions;
create policy promotions_admin_insert on public.promotions for insert to authenticated
 with check (public.is_admin());
drop policy if exists promotions_admin_update on public.promotions;
create policy promotions_admin_update on public.promotions for update to authenticated
 using (public.is_admin()) with check (public.is_admin());

grant select, insert on public.promotions to authenticated;
grant update (active) on public.promotions to authenticated;
revoke all on public.promotions from anon;

-- Presence cannot be spoofed by a client writing directly to profiles.
create or replace function public.set_driver_presence(p_online boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.profiles
    set driver_online = coalesce(p_online, false),
        driver_last_seen_at = case when coalesce(p_online,false) then now() else null end
  where id = auth.uid() and role = 'driver' and status = 'active';
  if not found then raise exception 'not allowed'; end if;
end $$;

create or replace function public.is_active_online_driver() returns boolean
language sql security definer stable set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'driver' and status = 'active'
    and driver_online = true and driver_last_seen_at > now() - interval '90 seconds'
  )
$$;

-- A captain sees new requests only while truly online, but can always see assigned rides.
drop policy if exists rides_select on public.rides;
create policy rides_select on public.rides for select to authenticated
  using (customer_id = auth.uid()
    or public.is_admin()
    or (public.is_active_driver() and driver_id = auth.uid())
    or (status = 'new' and public.is_active_online_driver()));

-- Server is authoritative for fare and promo validation. Pricing matches old site:
-- nearest 250 IQD to (2,000 IQD base + 300 IQD per km).
create or replace function public.quote_ride(p_distance_km numeric, p_promo_code text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_code text := nullif(upper(btrim(coalesce(p_promo_code, ''))), '');
  v_base integer;
  v_disc integer := 0;
  v_promo public.promotions%rowtype;
begin
  if public.my_role() is distinct from 'customer' or auth.uid() is null then
    raise exception 'not allowed';
  end if;
  if p_distance_km is null or p_distance_km <= 0 or p_distance_km > 1000 then
    raise exception 'invalid distance';
  end if;

  v_base := greatest(250, (round((2000 + p_distance_km * 300) / 250) * 250)::integer);
  if v_code is not null then
    select * into v_promo from public.promotions where code = v_code and active = true;
    if not found then raise exception 'invalid promo'; end if;
    if v_promo.expires_at is not null and v_promo.expires_at <= now() then
      raise exception 'promo expired';
    end if;
    if v_promo.max_uses is not null and v_promo.uses_count >= v_promo.max_uses then
      raise exception 'promo exhausted';
    end if;
    if exists (
      select 1 from public.rides
      where customer_id = auth.uid() and promo_code = v_code and status <> 'cancelled'
    ) then raise exception 'promo already used'; end if;
    v_disc := floor(v_base * v_promo.discount_percent / 100.0)::integer;
  end if;
  return jsonb_build_object('base_fare', v_base, 'discount_amount', v_disc,
                            'fare', v_base - v_disc, 'promo_code', v_code);
end $$;

-- Atomic booking. Locks promo row to protect global usage limits from simultaneous requests.
create or replace function public.create_ride(
  p_pickup_lat double precision, p_pickup_lng double precision,
  p_dest_lat double precision, p_dest_lng double precision,
  p_distance_km numeric, p_promo_code text default null
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_profile public.profiles%rowtype;
  v_quote jsonb;
  v_code text := nullif(upper(btrim(coalesce(p_promo_code,''))), '');
  v_id uuid;
begin
  select * into v_profile from public.profiles
    where id = auth.uid() and role = 'customer' and status = 'active';
  if not found then raise exception 'not allowed'; end if;
  if p_pickup_lat is null or p_pickup_lng is null or p_dest_lat is null or p_dest_lng is null
     or abs(p_pickup_lat) > 90 or abs(p_dest_lat) > 90
     or abs(p_pickup_lng) > 180 or abs(p_dest_lng) > 180 then
    raise exception 'invalid location';
  end if;

  if v_code is not null then
    perform 1 from public.promotions where code = v_code for update;
    -- quote_ride below gives the normal invalid/inactive code error if missing.
  end if;
  v_quote := public.quote_ride(p_distance_km, v_code);

  insert into public.rides (
    customer_id,customer_name,customer_phone,
    pickup_lat,pickup_lng,dest_lat,dest_lng,distance_km,
    fare,base_fare,discount_amount,promo_code
  ) values (
    v_profile.id,v_profile.name,v_profile.phone,
    p_pickup_lat,p_pickup_lng,p_dest_lat,p_dest_lng,p_distance_km,
    (v_quote->>'fare')::integer,(v_quote->>'base_fare')::integer,
    (v_quote->>'discount_amount')::integer,v_code
  ) returning id into v_id;

  if v_code is not null then
    update public.promotions set uses_count = uses_count + 1 where code = v_code;
  end if;
  return v_id;
end $$;

-- Switching offline at the browser is optional for the policy: even without a clean
-- sign-out, the 90-second heartbeat expiry blocks acceptance.
create or replace function public.accept_ride(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare d public.profiles%rowtype;
begin
  select * into d from public.profiles where id = auth.uid()
    and role = 'driver' and status = 'active'
    and driver_online = true and driver_last_seen_at > now() - interval '90 seconds';
  if not found then raise exception 'driver offline'; end if;
  update public.rides
    set status='accepted', driver_id=d.id, driver_name=d.name,
        driver_car=d.car, driver_plate=d.plate
    where id = p_id and status = 'new';
  if not found then raise exception 'taken'; end if;
end $$;

-- Restore promo usage when a customer cancels an unaccepted ride.
create or replace function public.cancel_ride(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_code text;
begin
  update public.rides set status='cancelled'
    where id = p_id and customer_id = auth.uid() and status = 'new'
    returning promo_code into v_code;
  if not found then raise exception 'not allowed'; end if;
  if v_code is not null then
    update public.promotions set uses_count = greatest(uses_count - 1, 0)
      where code = v_code;
  end if;
end $$;

-- IMPORTANT: disable the old direct INSERT path; otherwise a modified client can
-- bypass server-side pricing/discounts by specifying its own fare.
drop policy if exists rides_insert on public.rides;
revoke insert on public.rides from authenticated;

revoke all on function public.set_driver_presence(boolean) from public, anon;
revoke all on function public.quote_ride(numeric,text) from public, anon;
revoke all on function public.create_ride(double precision,double precision,double precision,double precision,numeric,text) from public, anon;
revoke all on function public.is_active_online_driver() from public, anon;
grant execute on function public.set_driver_presence(boolean) to authenticated;
grant execute on function public.quote_ride(numeric,text) to authenticated;
grant execute on function public.create_ride(double precision,double precision,double precision,double precision,numeric,text) to authenticated;
grant execute on function public.is_active_online_driver() to authenticated;

grant execute on function public.accept_ride(uuid), public.cancel_ride(uuid) to authenticated;

commit;
