-- Play Billing (Android) sebagai kanal pembayaran kedua — skema multi-kanal.
-- PayCore (web) TIDAK berubah: tetap menulis credit_orders lama.
--
-- 1) credit_products: dimensi kanal. Baris existing = 'web' (default).
--    Baris 'android' dikelola admin (Supabase Dashboard) per SKU Play:
--    harga/kredit boleh berbeda dari web untuk menutup biaya Play (15%).
-- 2) credit_orders_v2: order seragam lintas kanal (web rows tetap di
--    credit_orders; v2 dipakai android + audit lintas kanal).
-- 3) Idempotensi grant via credit_ledger.ref unik: 'playbilling:{token}'.

-- ===== 1) credit_products: kolom kanal =====
alter table public.credit_products
  add column if not exists channel text not null default 'web'
    check (channel in ('web','android'));

alter table public.credit_products
  add column if not exists play_sku text; -- SKU Play Billing, null utk web

-- Upgrade PK: (product_key) → (product_key, channel). Idempotent.
do $$
begin
  if exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    where t.relname = 'credit_products'
      and c.conname = 'credit_products_pkey'
      and (
        select count(*) from unnest(c.conkey) k
        join pg_attribute a on a.attrelid = t.oid and a.attnum = k
        where a.attname = 'channel'
      ) = 0
  ) then
    alter table public.credit_products drop constraint credit_products_pkey;
    alter table public.credit_products
      add constraint credit_products_pkey primary key (product_key, channel);
  end if;
end $$;

-- ===== 2) credit_orders_v2 =====
create table if not exists public.credit_orders_v2 (
  order_id        uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  channel         text not null check (channel in ('web','android')),
  product_key     text not null,
  status          text not null default 'pending'
                    check (status in ('pending','succeeded','failed')),
  amount_idr      integer not null default 0 check (amount_idr >= 0),
  credits_base    integer not null default 0 check (credits_base >= 0),
  credits_bonus   integer not null default 0 check (credits_bonus >= 0),
  credits_total   integer not null default 0 check (credits_total >= 0),
  -- Play Billing fields (null utk web; web tetap pakai credit_orders lama)
  purchase_token  text,
  product_id      text,     -- SKU Play, mis. lakoku_credits_100
  order_number    text,     -- orderId Google (mis. GPA.33xx-xxxx)
  verified_at     timestamptz,
  created_at      timestamptz not null default now(),
  unique (channel, purchase_token)
);
create index if not exists credit_orders_v2_user_idx
  on public.credit_orders_v2 (user_id);
create index if not exists credit_orders_v2_status_idx
  on public.credit_orders_v2 (status, created_at);

-- ===== 3) RLS =====
alter table public.credit_orders_v2 enable row level security;
-- Tidak ada policy write publik: write hanya via service_role (route server).
drop policy if exists credit_orders_v2_own_read on public.credit_orders_v2;
create policy credit_orders_v2_own_read on public.credit_orders_v2
  for select using (auth.uid() = user_id);

-- ===== 4) Fungsi grant idempotent (SECURITY DEFINER, dipanggil service_role) =====
-- Sama dengan pola PayCore: grant lewat credit_ledger dengan ref unik.
create or replace function public.play_billing_grant_v1(
  p_user_id uuid,
  p_product_key text,
  p_credits_base integer,
  p_credits_bonus integer,
  p_credits_total integer,
  p_purchase_token text,
  p_product_id text,
  p_order_number text
) returns table (order_id uuid, already_granted boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order uuid;
  v_ref text := 'playbilling:' || p_purchase_token;
  v_ledger_id uuid;
begin
  -- credit_ledger.ref unik = sumber idempotensi (grant sekali selamanya).
  insert into public.credit_ledger (user_id, delta, reason, ref)
  values (p_user_id, p_credits_total, p_product_key, v_ref)
  on conflict (ref) do nothing
  returning id into v_ledger_id;

  -- Catat order (idempotent via unique(channel, purchase_token)).
  insert into public.credit_orders_v2
    (user_id, channel, product_key, status, amount_idr,
     credits_base, credits_bonus, credits_total,
     purchase_token, product_id, order_number, verified_at)
  values
    (p_user_id, 'android', p_product_key, 'succeeded', 0,
     p_credits_base, p_credits_bonus, p_credits_total,
     p_purchase_token, p_product_id, p_order_number, now())
  on conflict (channel, purchase_token) do update
    set status = 'succeeded', verified_at = now()
  returning order_id into v_order;

  return query select v_order, (v_ledger_id is null);
end;
$$;

revoke all on function public.play_billing_grant_v1(uuid, text, integer, integer, integer, text, text, text) from public, anon, authenticated;
grant execute on function public.play_billing_grant_v1(uuid, text, integer, integer, integer, text, text, text) to service_role;
