-- ============================================================================
-- Misi Harian Bergamifikasi + Iklan Rewarded (AdMob SSV)
--
-- Prinsip:
--  1. Setiap misi harus punya BUKTI sisi server. Tidak ada misi yang selesai
--     hanya karena klien bilang selesai.
--  2. Imbalan iklan default MATI (mirip reward_policy.commission_enabled),
--     karena tiap kredit didanai inferensi berbayar.
--  3. Semua parameter dapat diubah lewat pengaturan admin, bukan hardcode.
--  4. Hari dihitung memakai zona Asia/Jakarta, bukan UTC, supaya reset harian
--     terasa benar bagi pembaca Indonesia.
-- ============================================================================

-- 1) mission_policy: konfigurasi baris tunggal (id = true), editable lewat admin
create table if not exists public.mission_policy (
  id boolean primary key default true check (id = true),

  -- Sakelar utama
  missions_enabled boolean not null default true,
  ad_reward_enabled boolean not null default false,
  adsense_enabled boolean not null default false,

  -- Imbalan kredit per misi
  checkin_credits integer not null default 1 check (checkin_credits >= 0 and checkin_credits <= 100),
  choice_credits integer not null default 1 check (choice_credits >= 0 and choice_credits <= 100),
  ad_batch_credits integer not null default 1 check (ad_batch_credits >= 0 and ad_batch_credits <= 100),

  -- Syarat penyelesaian
  choice_required integer not null default 3 check (choice_required >= 1 and choice_required <= 50),
  ads_per_credit integer not null default 5 check (ads_per_credit >= 1 and ads_per_credit <= 50),
  ad_daily_cap integer not null default 10 check (ad_daily_cap >= 0 and ad_daily_cap <= 100),

  -- Keamanan SSV
  ssv_freshness_seconds integer not null default 600
    check (ssv_freshness_seconds >= 60 and ssv_freshness_seconds <= 3600),

  -- Konfigurasi AdSense (web saja; tidak pernah dimuat di WebView Android)
  adsense_client_id text not null default '',
  adsense_slot_share_landing text not null default '',
  adsense_slot_ending text not null default '',
  adsense_slot_beranda text not null default '',
  adsense_slot_credit text not null default '',

  updated_at timestamptz not null default now()
);

insert into public.mission_policy (id) values (true)
on conflict (id) do nothing;

alter table public.mission_policy enable row level security;

drop policy if exists mission_policy_read on public.mission_policy;
create policy mission_policy_read on public.mission_policy
  for select using (true);

-- 2) user_mission_daily: kemajuan misi per pembaca per hari (Asia/Jakarta)
create table if not exists public.user_mission_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  mission_key text not null,
  day_jkt date not null,
  progress integer not null default 0 check (progress >= 0),
  claimed_at timestamptz not null default now(),
  credits_granted integer not null default 0 check (credits_granted >= 0),
  primary key (user_id, mission_key, day_jkt),
  constraint user_mission_daily_key_check
    check (mission_key in ('daily_checkin', 'make_choice', 'watch_ad'))
);

create index if not exists user_mission_daily_user_day_idx
  on public.user_mission_daily(user_id, day_jkt desc);

alter table public.user_mission_daily enable row level security;

drop policy if exists user_mission_daily_own_read on public.user_mission_daily;
create policy user_mission_daily_own_read on public.user_mission_daily
  for select using (auth.uid() = user_id);

-- 3) admob_ssv_events: jejak audit callback AdMob, termasuk yang DITOLAK.
--    transaction_id sebagai primary key = anti-replay tingkat basis data.
create table if not exists public.admob_ssv_events (
  transaction_id text primary key,
  user_id uuid references auth.users(id) on delete set null,
  status text not null,
  ad_unit text not null default '',
  reward_amount integer not null default 0,
  day_jkt date not null,
  created_at timestamptz not null default now(),
  constraint admob_ssv_events_status_check
    check (status in ('valid', 'cap_exceeded', 'policy_disabled', 'invalid_signature', 'stale', 'unknown_user'))
);

create index if not exists admob_ssv_events_user_day_idx
  on public.admob_ssv_events(user_id, day_jkt desc);

alter table public.admob_ssv_events enable row level security;
-- Tanpa policy select: hanya service_role (bypass RLS) yang boleh membaca.

-- ============================================================================
-- RPC
-- ============================================================================

-- get_daily_missions_v1: status misi hari ini, dihitung dari BUKTI nyata.
create or replace function public.get_daily_missions_v1(p_user_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_policy   public.mission_policy%rowtype;
  v_today    date := (timezone('Asia/Jakarta', now()))::date;
  v_choices  integer;
  v_ads      integer;
  v_claimed  jsonb;
begin
  select * into v_policy from public.mission_policy where id = true;
  if not found then
    return jsonb_build_object('enabled', false, 'missions', '[]'::jsonb);
  end if;

  -- Bukti make_choice: baris nyata di tabel penerapan pilihan hari ini.
  select count(*)::int into v_choices
  from public.personalized_choice_applications
  where user_id = p_user_id
    and (timezone('Asia/Jakarta', created_at))::date = v_today;

  -- Bukti watch_ad: hanya callback SSV bertanda tangan sah yang dihitung.
  select count(*)::int into v_ads
  from public.admob_ssv_events
  where user_id = p_user_id
    and day_jkt = v_today
    and status = 'valid';

  select coalesce(jsonb_object_agg(mission_key, credits_granted), '{}'::jsonb)
    into v_claimed
  from public.user_mission_daily
  where user_id = p_user_id and day_jkt = v_today;

  return jsonb_build_object(
    'enabled', v_policy.missions_enabled,
    'adRewardEnabled', v_policy.ad_reward_enabled,
    'day', v_today,
    'adsWatched', v_ads,
    'adDailyCap', v_policy.ad_daily_cap,
    'adsPerCredit', v_policy.ads_per_credit,
    'claimed', v_claimed,
    'missions', jsonb_build_array(
      jsonb_build_object(
        'key', 'daily_checkin',
        'progress', 1,
        'required', 1,
        'credits', v_policy.checkin_credits,
        'claimed', v_claimed ? 'daily_checkin'
      ),
      jsonb_build_object(
        'key', 'make_choice',
        'progress', v_choices,
        'required', v_policy.choice_required,
        'credits', v_policy.choice_credits,
        'claimed', v_claimed ? 'make_choice'
      ),
      jsonb_build_object(
        'key', 'watch_ad',
        'progress', v_ads,
        'required', v_policy.ads_per_credit,
        'credits', v_policy.ad_batch_credits,
        'claimed', v_claimed ? 'watch_ad'
      )
    )
  );
end;
$$;

grant execute on function public.get_daily_missions_v1(uuid) to service_role;

-- claim_mission_v1: klaim imbalan misi. Server memverifikasi ulang bukti.
-- Return: 'ok' | 'duplicate' | 'incomplete' | 'disabled' | 'unknown_mission'
create or replace function public.claim_mission_v1(
  p_user_id uuid,
  p_mission_key text
) returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_policy   public.mission_policy%rowtype;
  v_today    date := (timezone('Asia/Jakarta', now()))::date;
  v_progress integer := 0;
  v_required integer := 1;
  v_credits  integer := 0;
  v_ref      text;
begin
  select * into v_policy from public.mission_policy where id = true;
  if not found or not v_policy.missions_enabled then
    return 'disabled';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_user_id::text));

  if exists (
    select 1 from public.user_mission_daily
    where user_id = p_user_id and mission_key = p_mission_key and day_jkt = v_today
  ) then
    return 'duplicate';
  end if;

  if p_mission_key = 'daily_checkin' then
    v_progress := 1;
    v_required := 1;
    v_credits  := v_policy.checkin_credits;

  elsif p_mission_key = 'make_choice' then
    select count(*)::int into v_progress
    from public.personalized_choice_applications
    where user_id = p_user_id
      and (timezone('Asia/Jakarta', created_at))::date = v_today;
    v_required := v_policy.choice_required;
    v_credits  := v_policy.choice_credits;

  elsif p_mission_key = 'watch_ad' then
    if not v_policy.ad_reward_enabled then
      return 'disabled';
    end if;
    select count(*)::int into v_progress
    from public.admob_ssv_events
    where user_id = p_user_id and day_jkt = v_today and status = 'valid';
    v_required := v_policy.ads_per_credit;
    v_credits  := v_policy.ad_batch_credits;

  else
    return 'unknown_mission';
  end if;

  if v_progress < v_required then
    return 'incomplete';
  end if;

  insert into public.user_mission_daily (
    user_id, mission_key, day_jkt, progress, credits_granted
  ) values (
    p_user_id, p_mission_key, v_today, v_progress, v_credits
  );

  if v_credits > 0 then
    v_ref := 'mission:' || p_mission_key || ':' || p_user_id::text || ':' || v_today::text;
    perform public.grant_credits_v1(
      p_user_id, v_ref, v_credits, 'Misi harian: ' || p_mission_key
    );
  end if;

  return 'ok';
end;
$$;

revoke all on function public.claim_mission_v1(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_mission_v1(uuid, text) to service_role;

-- record_admob_ssv_v1: catat callback AdMob yang SUDAH lolos verifikasi tanda
-- tangan di lapisan aplikasi. Fungsi ini menegakkan batas harian dan anti-replay.
-- Return status yang sama dengan yang disimpan di baris audit.
create or replace function public.record_admob_ssv_v1(
  p_user_id uuid,
  p_transaction_id text,
  p_ad_unit text,
  p_reward_amount integer
) returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_policy public.mission_policy%rowtype;
  v_today  date := (timezone('Asia/Jakarta', now()))::date;
  v_count  integer;
  v_status text;
begin
  select * into v_policy from public.mission_policy where id = true;

  perform pg_advisory_xact_lock(hashtext(p_user_id::text));

  -- Anti-replay: transaction_id adalah primary key.
  if exists (select 1 from public.admob_ssv_events where transaction_id = p_transaction_id) then
    return 'duplicate';
  end if;

  if not found or not v_policy.missions_enabled or not v_policy.ad_reward_enabled then
    v_status := 'policy_disabled';
  else
    select count(*)::int into v_count
    from public.admob_ssv_events
    where user_id = p_user_id and day_jkt = v_today and status = 'valid';

    if v_count >= v_policy.ad_daily_cap then
      v_status := 'cap_exceeded';
    else
      v_status := 'valid';
    end if;
  end if;

  insert into public.admob_ssv_events (
    transaction_id, user_id, status, ad_unit, reward_amount, day_jkt
  ) values (
    p_transaction_id, p_user_id, v_status, coalesce(p_ad_unit, ''), coalesce(p_reward_amount, 0), v_today
  );

  return v_status;
end;
$$;

revoke all on function public.record_admob_ssv_v1(uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.record_admob_ssv_v1(uuid, text, text, integer) to service_role;

-- record_admob_rejection_v1: simpan jejak callback yang GAGAL verifikasi tanda
-- tangan atau kedaluwarsa, supaya serangan terlihat di audit.
create or replace function public.record_admob_rejection_v1(
  p_transaction_id text,
  p_user_id uuid,
  p_status text
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.admob_ssv_events (
    transaction_id, user_id, status, day_jkt
  ) values (
    p_transaction_id, p_user_id, p_status, (timezone('Asia/Jakarta', now()))::date
  )
  on conflict (transaction_id) do nothing;
end;
$$;

revoke all on function public.record_admob_rejection_v1(text, uuid, text) from public, anon, authenticated;
grant execute on function public.record_admob_rejection_v1(text, uuid, text) to service_role;
