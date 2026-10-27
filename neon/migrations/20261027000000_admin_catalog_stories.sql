-- neon/migrations/20261027000000_admin_catalog_stories.sql
-- Skema cerita katalog admin (Plan 1 - Reader Foundation)

-- 1. Tambahkan mode 'catalog' pada check constraint stories_story_mode_check
alter table public.stories
  drop constraint if exists stories_story_mode_check;

alter table public.stories
  add constraint stories_story_mode_check
  check (story_mode in ('standard', 'personalized_ai', 'premium_template', 'premium_instance', 'catalog'));

-- 2. Tabel catalog_stories
create table if not exists public.catalog_stories (
  story_id text primary key references public.stories(id) on delete cascade,
  status text not null check (status in ('draft', 'generating', 'review', 'published', 'archived')) default 'draft',
  chapter_price integer not null default 5,
  bundle_price integer not null default 150,
  contract_json jsonb null,
  generation_progress integer not null default 0,
  published_at timestamptz null,
  published_by text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists catalog_stories_status_idx on public.catalog_stories (status);

-- 3. Tabel catalog_ending_chapters (Bab 45-50 varian ending)
create table if not exists public.catalog_ending_chapters (
  story_id text not null references public.stories(id) on delete cascade,
  ending_key text not null,
  number integer not null check (number >= 45 and number <= 50),
  title text not null,
  paragraphs jsonb not null default '[]'::jsonb,
  choices jsonb null,
  choice_prompt text null,
  outcomes_json jsonb null,
  created_at timestamptz not null default now(),
  primary key (story_id, ending_key, number)
);

create index if not exists catalog_ending_chapters_lookup_idx
  on public.catalog_ending_chapters (story_id, ending_key, number);

-- 4. Kolom direction_hint di choice_outcomes
alter table public.choice_outcomes add column if not exists direction_hint text null;

-- 5a. Total Lakoin yang sudah dibelanjakan pembaca untuk bab satu novel.
-- Satu sumber kebenaran: dipakai spend_bundle_v1 dan quote paket di server.
-- Tanpa LIKE: '_' / '%' di slug adalah wildcard, dan prefix 'unlock:{story}:' juga
-- cocok untuk story lain berawalan sama (catalog:abc vs catalog:abc:2). Sisa ref
-- setelah prefix harus persis '{bab}' (kanonik) atau '{bab}:{userId}' (per-pembaca).
create or replace function public.catalog_bundle_spent_v1(
  p_user_id  uuid,
  p_story_id text
) returns integer
language sql stable security definer set search_path = public
as $$
  select coalesce(sum(-delta), 0)::int
  from public.credit_ledger
  where user_id = p_user_id
    and delta < 0
    and reason = 'unlock_chapter'
    and left(ref, length('unlock:' || p_story_id || ':')) = 'unlock:' || p_story_id || ':'
    and substr(ref, length('unlock:' || p_story_id || ':') + 1)
      ~ ('^[0-9]+(:' || p_user_id::text || ')?$');
$$;

-- 5b. RPC spend_bundle_v1: hitung fair price dan debit ledger atomik
create or replace function public.spend_bundle_v1(
  p_user_id  uuid,
  p_story_id text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_bundle_price integer;
  v_spent        integer;
  v_fair_price   integer;
  v_available    integer;
  v_bundle_ref   text;
  v_rows         integer;
begin
  if p_user_id is null or p_story_id is null or trim(p_story_id) = '' then
    raise exception 'spend_bundle_v1: invalid arguments';
  end if;

  -- Kunci transaksi per user (uniform advisory lock)
  perform pg_advisory_xact_lock(hashtext(p_user_id::text));

  v_bundle_ref := 'bundle:' || p_story_id || ':' || p_user_id::text;

  -- Idempotency check: sudah pernah beli paket
  if exists (select 1 from public.credit_ledger where ref = v_bundle_ref) then
    return jsonb_build_object('status', 'duplicate', 'price_paid', 0);
  end if;

  -- Ambil harga paket dari catalog_stories
  select bundle_price into v_bundle_price
  from public.catalog_stories
  where story_id = p_story_id;

  if v_bundle_price is null then
    raise exception 'spend_bundle_v1: story is not a catalog story or missing pricing';
  end if;

  v_spent := public.catalog_bundle_spent_v1(p_user_id, p_story_id);

  v_fair_price := greatest(0, v_bundle_price - v_spent);

  if v_fair_price > 0 then
    -- Bersihkan reservasi kadaluarsa & cek saldo tersedia
    perform public.expire_user_reservations_lazy_v1(p_user_id);
    v_available := public.available_credit_balance_v1(p_user_id);
    if v_available < v_fair_price then
      return jsonb_build_object('status', 'insufficient', 'required', v_fair_price, 'available', v_available);
    end if;

    insert into public.credit_ledger (user_id, delta, reason, ref)
    values (p_user_id, -v_fair_price, 'unlock_bundle', v_bundle_ref)
    on conflict (ref) do nothing;
  else
    -- Fair price 0: sudah lunas via eceran, grant paket dengan delta 0
    insert into public.credit_ledger (user_id, delta, reason, ref)
    values (p_user_id, 0, 'unlock_bundle', v_bundle_ref)
    on conflict (ref) do nothing;
  end if;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return jsonb_build_object('status', 'duplicate', 'price_paid', 0);
  end if;

  return jsonb_build_object('status', 'ok', 'price_paid', v_fair_price, 'spent_offset', v_spent);
end;
$$;
