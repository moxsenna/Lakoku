-- Perbaikan FK user_acquisition: kolom user_id masih menunjuk auth.users
-- (skema Supabase yang sudah mati pasca-migrasi Better Auth), sehingga
-- penulisan akuisisi first-touch untuk pendaftar baru selalu gagal
-- (violates foreign key constraint user_acquisition_user_id_fkey).
--
-- Repoint ke public."user"(id) — konvensi tabel Better Auth bertipe text.
-- Nilai existing (uuid string dari impor) tetap valid sebagai text.

alter table public.user_acquisition drop constraint if exists user_acquisition_user_id_fkey;

alter table public.user_acquisition alter column user_id set data type text;

alter table public.user_acquisition
  add constraint user_acquisition_user_id_fkey
  foreign key (user_id) references public."user"(id) on delete cascade;
