-- PayCore credit model for lakoku (M-PAY).
--
-- Kredit dibeli lewat PayCore (webhook payment.succeeded) dan dibelanjakan untuk
-- membuka bab. Ledger append-only + idempoten. Aman diterapkan berulang (idempotent
-- DDL). Terapkan via `supabase db push` atau paste di Dashboard → SQL Editor.
--
-- Catatan: `payment_events` (dedup event_id) sudah ada dari skema commercial M8;
-- migrasi ini menambah lapisan kredit dan tidak mengubah tabel itu.

-- 1) Katalog produk kredit — SUMBER HARGA. Edit price_idr/credits/active kapan pun
--    di Supabase Dashboard tanpa deploy ulang. Route pembelian membaca dari sini.
create table if not exists public.credit_products (
  product_key text primary key,
  name        text not null,
  price_idr   integer not null check (price_idr >= 0),
  credits     integer not null check (credits >= 0),
  active      boolean not null default true,
  sort_order  integer not null default 0,
  updated_at  timestamptz not null default now()
);

-- 2) Ledger kredit append-only. `ref` = kunci idempotensi lintas grant & spend:
--    grant beli  → ref `paycore:{order_id}`
--    spend bab   → ref `unlock:{story_id}:{chapter}`
create table if not exists public.credit_ledger (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  delta      integer not null,          -- (+) grant beli, (-) spend buka bab
  reason     text not null,             -- product_key atau 'unlock_chapter'
  ref        text not null unique,      -- idempotency key
  created_at timestamptz not null default now()
);
create index if not exists credit_ledger_user_idx on public.credit_ledger (user_id);

-- 3) Saldo = jumlah delta. SECURITY DEFINER; dipanggil server (service_role).
create or replace function public.credit_balance_v1(p_user_id uuid)
returns integer
language sql stable security definer set search_path = public
as $$
  select coalesce(sum(delta), 0)::int
  from public.credit_ledger
  where user_id = p_user_id;
$$;

-- 4) Grant kredit idempoten. Return true bila baris baru ditulis (bukan replay).
create or replace function public.grant_credits_v1(
  p_user_id uuid,
  p_ref     text,
  p_credits integer,
  p_reason  text
) returns boolean
language plpgsql security definer set search_path = public
as $$
declare v_rows integer;
begin
  if p_credits <= 0 then
    raise exception 'grant_credits_v1: credits must be positive (got %)', p_credits;
  end if;
  insert into public.credit_ledger (user_id, delta, reason, ref)
  values (p_user_id, p_credits, p_reason, p_ref)
  on conflict (ref) do nothing;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

-- 5) Spend kredit untuk buka bab. Return 'ok' | 'duplicate' | 'insufficient'.
--    Advisory lock per-user mencegah balapan double-spend antar spend berbeda.
create or replace function public.spend_credits_v1(
  p_user_id uuid,
  p_ref     text,
  p_credits integer,
  p_reason  text
) returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_balance integer;
  v_rows    integer;
begin
  if p_credits <= 0 then
    raise exception 'spend_credits_v1: credits must be positive (got %)', p_credits;
  end if;
  perform pg_advisory_xact_lock(hashtext(p_user_id::text));

  if exists (select 1 from public.credit_ledger where ref = p_ref) then
    return 'duplicate';
  end if;

  select coalesce(sum(delta), 0)::int into v_balance
  from public.credit_ledger
  where user_id = p_user_id;

  if v_balance < p_credits then
    return 'insufficient';
  end if;

  insert into public.credit_ledger (user_id, delta, reason, ref)
  values (p_user_id, -p_credits, p_reason, p_ref)
  on conflict (ref) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return 'duplicate';
  end if;
  return 'ok';
end;
$$;

-- 6) RLS: user hanya boleh MEMBACA ledger miliknya; tulis hanya lewat RPC
--    SECURITY DEFINER / service_role. Katalog produk boleh dibaca publik.
alter table public.credit_ledger enable row level security;
drop policy if exists credit_ledger_own_read on public.credit_ledger;
create policy credit_ledger_own_read on public.credit_ledger
  for select using (auth.uid() = user_id);

alter table public.credit_products enable row level security;
drop policy if exists credit_products_read on public.credit_products;
create policy credit_products_read on public.credit_products
  for select using (true);

-- 7) Hak eksekusi fungsi.
grant execute on function public.credit_balance_v1(uuid) to service_role;
grant execute on function public.grant_credits_v1(uuid, text, integer, text) to service_role;
grant execute on function public.spend_credits_v1(uuid, text, integer, text) to service_role;

-- 8) Seed 6 SKU PLACEHOLDER — ganti harga/kredit/nama sesuka Anda di Dashboard.
insert into public.credit_products (product_key, name, price_idr, credits, sort_order) values
  ('credits_starter', 'Paket Pemula',  15000,   30, 10),
  ('credits_basic',   'Paket Dasar',   30000,   70, 20),
  ('credits_plus',    'Paket Plus',    50000,  130, 30),
  ('credits_pro',     'Paket Pro',    100000,  300, 40),
  ('credits_max',     'Paket Maksi',  200000,  700, 50),
  ('credits_ultra',   'Paket Ultra',  500000, 2000, 60)
on conflict (product_key) do nothing;
