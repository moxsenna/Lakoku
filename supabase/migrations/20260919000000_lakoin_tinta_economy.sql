-- ============================================================================
-- Lakoin & Tinta — Ekonomi 3 Lapis
-- Spec: docs/superpowers/plans/2026-09-19-lakoin-tinta-economy.md
-- Lakoin = rename display dari Kredit (tidak ada perubahan kolom/paycore).
-- ============================================================================

-- ===== 1) tinta_ledger: event-sourced soft currency =====
create table if not exists public.tinta_ledger (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  delta         integer not null,          -- (+) earn, (-) tukar ke Lakoin
  reason        text not null,             -- 'mission_checkin' | 'mission_choice' |
                                           -- 'mission_ad_batch' | 'author_read_reward' |
                                           -- 'tinta_exchange' | 'tinta_exchange_rollback'
  ref           text not null unique,      -- idempotency key (pola credit_ledger.ref)
  pending_until timestamptz,               -- non-null = masih jendela anomali 24 jam
  created_at    timestamptz not null default now()
);

create index if not exists tinta_ledger_user_idx
  on public.tinta_ledger (user_id, created_at desc);

-- Cap harian penulis: pemindaian per (penulis, hari WIB) pada reason tertentu.
create index if not exists tinta_ledger_author_day_idx
  on public.tinta_ledger (
    user_id, ((timezone('Asia/Jakarta', created_at))::date)
  ) where reason = 'author_read_reward';

alter table public.tinta_ledger enable row level security;

drop policy if exists tinta_ledger_own_read on public.tinta_ledger;
create policy tinta_ledger_own_read on public.tinta_ledger
  for select using (auth.uid() = user_id);
-- Tidak ada policy write: tulis hanya via service_role / RPC security definer.

-- ===== 2) tinta_policy: konfigurasi baris tunggal (pola reward_policy) =====
create table if not exists public.tinta_policy (
  id boolean primary key default true check (id = true),
  tinta_per_read          integer not null default 10   check (tinta_per_read >= 0 and tinta_per_read <= 1000),
  author_daily_cap        integer not null default 300  check (author_daily_cap >= 0 and author_daily_cap <= 100000),
  tinta_checkin           integer not null default 5    check (tinta_checkin >= 0 and tinta_checkin <= 1000),
  tinta_choice            integer not null default 10   check (tinta_choice >= 0 and tinta_choice <= 1000),
  tinta_ad_batch          integer not null default 10   check (tinta_ad_batch >= 0 and tinta_ad_batch <= 1000),
  tinta_per_lakoin        integer not null default 100  check (tinta_per_lakoin >= 10 and tinta_per_lakoin <= 100000),
  exchange_min_lakoin     integer not null default 1    check (exchange_min_lakoin >= 1 and exchange_min_lakoin <= 10000),
  pending_hours           integer not null default 24   check (pending_hours >= 0 and pending_hours <= 168),
  author_rewards_enabled  boolean not null default false,
  exchange_enabled        boolean not null default false,
  missions_pay_tinta      boolean not null default false,
  updated_at              timestamptz not null default now()
);

insert into public.tinta_policy (id) values (true) on conflict (id) do nothing;

alter table public.tinta_policy enable row level security;

drop policy if exists tinta_policy_read on public.tinta_policy;
create policy tinta_policy_read on public.tinta_policy
  for select using (true);

-- ===== 3) grant_tinta_v1: tulis entri ledger idempoten =====
create or replace function public.grant_tinta_v1(
  p_user_id uuid,
  p_ref text,
  p_delta integer,
  p_reason text,
  p_pending_hours integer default 0
) returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  if p_delta = 0 then
    raise exception 'grant_tinta_v1: delta cannot be zero';
  end if;

  insert into public.tinta_ledger (user_id, delta, reason, ref, pending_until)
  values (
    p_user_id, p_delta, p_reason, p_ref,
    case when p_pending_hours > 0
         then now() + make_interval(hours => p_pending_hours)
         else null end
  );
  return true;
exception
  when unique_violation then
    return false;   -- sudah pernah diterbitkan: idempoten
end;
$$;

revoke all on function public.grant_tinta_v1(uuid, text, integer, text, integer) from public, anon, authenticated;
grant execute on function public.grant_tinta_v1(uuid, text, integer, text, integer) to service_role;

-- ===== 4) tinta_balance_v1: saldo total / tersedia / tertunda =====
create or replace function public.tinta_balance_v1(p_user_id uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_build_object(
    'total',
      coalesce(sum(delta), 0),
    'available',
      coalesce(sum(case when pending_until is null or pending_until <= now()
                        then delta else 0 end), 0),
    'pending',
      coalesce(sum(case when pending_until > now()
                        then delta else 0 end), 0)
  ), '{"total":0,"available":0,"pending":0}'::jsonb)
  from public.tinta_ledger
  where user_id = p_user_id;
$$;

revoke all on function public.tinta_balance_v1(uuid) from public, anon, authenticated;
grant execute on function public.tinta_balance_v1(uuid) to authenticated, service_role;

-- ===== 5) spend_tinta_v1: debit untuk penukaran (cek saldo TERSEDIA atomik) =====
create or replace function public.spend_tinta_v1(
  p_user_id uuid,
  p_ref text,
  p_amount integer,
  p_reason text
) returns text   -- 'ok' | 'insufficient' | 'duplicate'
language plpgsql security definer set search_path = public
as $$
declare
  v_available integer;
begin
  if p_amount <= 0 then
    raise exception 'spend_tinta_v1: amount must be positive';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_user_id::text));

  if exists (select 1 from public.tinta_ledger where ref = p_ref) then
    return 'duplicate';
  end if;

  select coalesce(sum(case when pending_until is null or pending_until <= now()
                           then delta else 0 end), 0)::int
    into v_available
  from public.tinta_ledger
  where user_id = p_user_id;

  if v_available < p_amount then
    return 'insufficient';
  end if;

  insert into public.tinta_ledger (user_id, delta, reason, ref)
  values (p_user_id, -p_amount, p_reason, p_ref);

  return 'ok';
end;
$$;

revoke all on function public.spend_tinta_v1(uuid, text, integer, text) from public, anon, authenticated;
grant execute on function public.spend_tinta_v1(uuid, text, integer, text) to service_role;

-- ===== 6) grant_author_tinta_v1: reward penulis, semua pagar ditegakkan di sini =====
-- Return: 'ok' | 'duplicate' | 'capped' | 'disabled' | 'ineligible'
create or replace function public.grant_author_tinta_v1(
  p_reader_id uuid,
  p_story_id text,
  p_chapter_number integer
) returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_policy    public.tinta_policy%rowtype;
  v_owner     uuid;
  v_visibility text;
  v_ref       text;
  v_today     date := (timezone('Asia/Jakarta', now()))::date;
  v_earned    integer;
begin
  select * into v_policy from public.tinta_policy where id = true;
  if not found or not v_policy.author_rewards_enabled then
    return 'disabled';
  end if;

  if p_chapter_number < 1 or p_chapter_number > 49 then
    return 'ineligible';   -- bab 50 = ending, tanpa pilihan
  end if;

  select owner_user_id, visibility into v_owner, v_visibility
  from public.stories where id = p_story_id;
  if not found then
    return 'ineligible';
  end if;
  if v_visibility <> 'public' then
    return 'ineligible';
  end if;
  if v_owner is null or v_owner = p_reader_id then
    return 'ineligible';   -- baca cerita sendiri tidak membayar
  end if;

  v_ref := 'author_read:' || p_story_id || ':' || p_chapter_number::text
           || ':' || p_reader_id::text;
  if exists (select 1 from public.tinta_ledger where ref = v_ref) then
    return 'duplicate';    -- baca ulang tidak membayar
  end if;

  -- Cap harian atomik per penulis (kunci baris penulis).
  perform pg_advisory_xact_lock(hashtext(v_owner::text));

  select coalesce(sum(delta), 0)::int into v_earned
  from public.tinta_ledger
  where user_id = v_owner
    and reason = 'author_read_reward'
    and (timezone('Asia/Jakarta', created_at))::date = v_today;

  if v_earned + v_policy.tinta_per_read > v_policy.author_daily_cap then
    return 'capped';
  end if;

  begin
    insert into public.tinta_ledger
      (user_id, delta, reason, ref, pending_until)
    values
      (v_owner, v_policy.tinta_per_read, 'author_read_reward', v_ref,
       now() + make_interval(hours => v_policy.pending_hours));
  exception when unique_violation then
    return 'duplicate';
  end;

  return 'ok';
end;
$$;

revoke all on function public.grant_author_tinta_v1(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.grant_author_tinta_v1(uuid, text, integer) to service_role;
