-- Repoint sisa FK user → public."user" + perbaikan view blueprint (audit M-A13).
--
-- Produksi (introspeksi 2026-11-06): 0 FK ke auth.users, 30 FK ke public."user"
-- — tapi 7 tabel berikut di FILE migrasi masih membuat FK ke auth.users saat
-- rebuild fresh, sehingga sumber skema tunggal tidak mereproduksi produksi dan
-- rebuild baru akan kembali kena kelas bug B1 (tulis gagal untuk user baru).
--
-- Pola idempoten mengikuti 20261104130000: drop constraint if exists lalu add.
-- Delete rule mengikuti definisi asli tiap tabel di migrasinya.

alter table public.shared_story_starts drop constraint if exists shared_story_starts_new_user_id_fkey;
alter table public.shared_story_starts add constraint shared_story_starts_new_user_id_fkey
  foreign key (new_user_id) references public."user"(id) on delete cascade;

alter table public.admin_generation_access_audit drop constraint if exists admin_generation_access_audit_actor_user_id_fkey;
alter table public.admin_generation_access_audit add constraint admin_generation_access_audit_actor_user_id_fkey
  foreign key (actor_user_id) references public."user"(id) on delete restrict;

alter table public.chapter_state_commits drop constraint if exists chapter_state_commits_actor_user_id_fkey;
alter table public.chapter_state_commits add constraint chapter_state_commits_actor_user_id_fkey
  foreign key (actor_user_id) references public."user"(id) on delete set null;

alter table public.commercial_generation_intents drop constraint if exists commercial_generation_intents_user_id_fkey;
alter table public.commercial_generation_intents add constraint commercial_generation_intents_user_id_fkey
  foreign key (user_id) references public."user"(id) on delete cascade;

alter table public.admob_ssv_events drop constraint if exists admob_ssv_events_user_id_fkey;
alter table public.admob_ssv_events add constraint admob_ssv_events_user_id_fkey
  foreign key (user_id) references public."user"(id) on delete set null;

alter table public.push_log drop constraint if exists push_log_sent_by_fkey;
alter table public.push_log add constraint push_log_sent_by_fkey
  foreign key (sent_by) references public."user"(id) on delete set null;

alter table public.story_cover_candidates drop constraint if exists story_cover_candidates_user_id_fkey;
alter table public.story_cover_candidates add constraint story_cover_candidates_user_id_fkey
  foreign key (user_id) references public."user"(id) on delete cascade;

-- View blueprint masih join auth.users → reviewer_email selalu NULL untuk
-- reviewer baru (data user kini di public."user"). Kolom & urutan tidak berubah.
create or replace view public.vw_blueprint_recent_resolutions as
select
  br.id::text as resolution_id,
  br.story_id,
  br.source_event_id::text as source_event_id,
  br.disposition,
  br.reason_text,
  br.chapter_numbers,
  br.result_chapter_version_pairs,
  br.created_at as resolution_created_at,
  u.email as reviewer_email,
  br.reviewer_uid,
  s.title as story_title
from public.blueprint_resolutions as br
left join public."user" as u on u.id = br.reviewer_uid
left join public.stories as s on s.id = br.story_id
where (select public.e5_is_owner_admin())
order by br.created_at desc
limit 100;
