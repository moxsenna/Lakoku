-- Aktor eksplisit untuk grant kredit via x-runtime-token.
-- (Audit 2026-11-04, temuan B7)
--
-- Sebelumnya app/api/admin/credits/grant memakai sentinel
-- 00000000-0000-0000-0000-000000000000 saat fallback token terpakai; UUID
-- itu tidak ada di tabel user sehingga insert admin_credit_grants selalu
-- gagal FK (HTTP 500) — jalur otomasi tidak pernah bisa berjalan.
--
-- User sistem ini bukan akun login (tidak punya kredensial di Better Auth),
-- hanya identitas audit untuk aktor non-manusia.

insert into public."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
values (
  '00000000-0000-0000-0000-0000000000ff',
  'Sistem (Token Runtime)',
  'system+runtime-admin@lakoku.biz.id',
  true,
  now(),
  now()
)
on conflict (id) do nothing;
