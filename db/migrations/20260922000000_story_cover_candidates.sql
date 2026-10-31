-- Tabel dan helper untuk menyimpan 3 sampul cerita terakhir (retensi 3 hari)
-- Memungkinkan kreator/pembaca membandingkan hasil generate sebelum atau sesudah memasang.

create table if not exists public.story_cover_candidates (
  id uuid primary key default gen_random_uuid(),
  story_id text not null references public.stories(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  url text not null,
  preset text not null default 'sinematik',
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp() + interval '3 days')
);

create index if not exists idx_story_cover_candidates_lookup
  on public.story_cover_candidates (story_id, created_at desc);

create index if not exists idx_story_cover_candidates_expiry
  on public.story_cover_candidates (expires_at);

alter table public.story_cover_candidates enable row level security;

create policy "story_cover_candidates_owner_select"
  on public.story_cover_candidates for select
  using (auth.uid() = user_id);

create policy "story_cover_candidates_owner_delete"
  on public.story_cover_candidates for delete
  using (auth.uid() = user_id);

-- Helper atomic untuk mendaftarkan kandidat baru, membersihkan expired,
-- dan membatasi maksimal 3 sampul aktif terbaru per cerita.
create or replace function public.record_story_cover_candidate_v1(
  p_story_id text,
  p_user_id  uuid,
  p_url      text,
  p_preset   text
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_inserted_id uuid;
begin
  if p_story_id is null or p_user_id is null or p_url is null or trim(p_url) = '' then
    raise exception 'record_story_cover_candidate_v1: invalid arguments';
  end if;

  -- 1. Bersihkan yang sudah expired untuk cerita ini
  delete from public.story_cover_candidates
  where story_id = p_story_id and expires_at <= clock_timestamp();

  -- 2. Tambah kandidat baru dengan TTL 3 hari
  insert into public.story_cover_candidates (
    story_id, user_id, url, preset, created_at, expires_at
  ) values (
    p_story_id, p_user_id, p_url, coalesce(nullif(trim(p_preset), ''), 'sinematik'),
    clock_timestamp(), clock_timestamp() + interval '3 days'
  )
  returning id into v_inserted_id;

  -- 3. Pertahankan maksimal 3 sampul terbaru (buang yang di luar top 3)
  delete from public.story_cover_candidates
  where story_id = p_story_id
    and id not in (
      select id from public.story_cover_candidates
      where story_id = p_story_id and expires_at > clock_timestamp()
      order by created_at desc
      limit 3
    );

  return v_inserted_id;
end;
$$;

revoke all on function public.record_story_cover_candidate_v1(text, uuid, text, text) from public, anon, authenticated;
