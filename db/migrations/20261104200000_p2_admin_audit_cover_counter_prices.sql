-- Perbaikan P2 hasil audit 2026-11-04 (N2/N5/M13).
--
-- 1) N2 — audit trail arsip katalog: kolom archived_by agar identitas admin
--    yang mengarsipkan novel tercatat (archiveCatalogStory sudah menerimanya,
--    sebelumnya diabaikan).
alter table public.catalog_stories
  add column if not exists archived_by uuid references public."user"(id) on delete set null;

-- 2) M13 — harga katalog tidak boleh negatif: harga negatif dari salah input
--    admin menyuntikkan kredit gratis via spend_bundle_v1/unlock.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'catalog_stories_prices_check') then
    alter table public.catalog_stories
      add constraint catalog_stories_prices_check
      check (chapter_price >= 0 and bundle_price >= 0);
  end if;
end $$;

-- 3) N5 — next_story_cover_attempt_v1: cast suffix non-digit memicu error
--    "invalid input syntax for type integer" dan memblokir generate sampul;
--    escape backslash juga belum ada. Regex ':([0-9]+)$' mengambil hanya
--    suffix digit murni (baris lain → NULL → diabaikan max()).
create or replace function public.next_story_cover_attempt_v1(
  p_story_id text
) returns integer
language sql stable security definer set search_path = public
as $$
  select coalesce(max(n), 0)::int + 1
  from (
    select (substring(ref from ':([0-9]+)$'))::int as n
    from public.credit_ledger
    where ref like 'cover:' || replace(replace(replace(p_story_id, '\', '\\'), '%', '\%'), '_', '\_') || ':%'
    union all
    select (substring(ref from ':([0-9]+)$'))::int as n
    from public.credit_reservations
    where reservation_kind = 'STORY_COVER' and story_id = p_story_id
  ) attempts;
$$;
