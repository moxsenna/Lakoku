-- T7.3 Reports — tabel laporan pembaca (PRD §10.7, §15.2; ARCH §13.4).
--
-- Prinsip:
-- - RLS ON tanpa policy publik: hanya service role (server route / admin)
--   yang boleh membaca & menulis. Konsisten dengan pola generation_leases.
-- - reference_json berisi referensi kanonik READER-SAFE (tanpa prompt /
--   metadata model) — dirakit otomatis di server, pembaca tak perlu screenshot.
-- - severity dipetakan otomatis dari reason (P1 batas konten; P2 konsistensi/
--   pilihan/visual; P3 typo/lainnya). P0 hanya via review admin.

create table if not exists public.content_reports (
  id uuid primary key default gen_random_uuid(),
  story_instance_id text not null references public.stories (id) on delete cascade,
  chapter_no int not null check (chapter_no >= 1),
  reporter_user_id uuid null,
  reason text not null check (
    reason in (
      'KARAKTER_TIDAK_KONSISTEN',
      'MELANGGAR_BATAS_KONTEN',
      'PILIHAN_TIDAK_BERDAMPAK',
      'TYPO_BAHASA',
      'VISUAL_TIDAK_SESUAI',
      'LAINNYA'
    )
  ),
  note text null check (note is null or char_length(note) <= 500),
  severity text not null check (severity in ('P0', 'P1', 'P2', 'P3')),
  status text not null default 'OPEN' check (
    status in ('OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED')
  ),
  reference_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists content_reports_story_chapter_idx
  on public.content_reports (story_instance_id, chapter_no);

create index if not exists content_reports_status_created_idx
  on public.content_reports (status, created_at desc);

-- RLS locked: tanpa policy → anon/authenticated tidak bisa akses langsung.
alter table public.content_reports enable row level security;
