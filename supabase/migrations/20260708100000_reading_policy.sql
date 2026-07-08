-- Kebijakan harga baca (kredit) yang bisa diubah KAPAN PUN dari Dashboard
-- tanpa deploy ulang. Satu baris (id=1). Ubah free_chapters / credits_per_chapter
-- di Supabase → Table Editor → reading_policy.
create table if not exists public.reading_policy (
  id                  integer primary key default 1 check (id = 1),
  free_chapters       integer not null default 3 check (free_chapters >= 0),
  credits_per_chapter integer not null default 5 check (credits_per_chapter >= 0),
  updated_at          timestamptz not null default now()
);

insert into public.reading_policy (id, free_chapters, credits_per_chapter)
values (1, 3, 5)
on conflict (id) do nothing;

-- Boleh dibaca publik (untuk menampilkan biaya di UI); tulis hanya service_role/Dashboard.
alter table public.reading_policy enable row level security;
drop policy if exists reading_policy_read on public.reading_policy;
create policy reading_policy_read on public.reading_policy
  for select using (true);
