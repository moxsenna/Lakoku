-- Review/QC state per chapter unit for catalog novels.
-- Satu unit = satu bab pada spine (1-44) atau satu bab pada satu varian ending (45-50).
-- Plan 2 (generator) menulis baris ini saat bab selesai; Plan 3 (admin) mengubah statusnya.

create table if not exists catalog_chapter_reviews (
  story_id text not null references stories(id) on delete cascade,
  chapter_number integer not null check (chapter_number >= 1 and chapter_number <= 50),
  variant_key text not null default 'spine',
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rewrite_requested')),
  note text,
  reviewed_by uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  primary key (story_id, chapter_number, variant_key)
);

create index if not exists catalog_chapter_reviews_status_idx
  on catalog_chapter_reviews (story_id, status);
