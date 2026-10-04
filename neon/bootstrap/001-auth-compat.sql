-- Compat: tabel auth.users minimal dan stub auth.uid() untuk fungsi yang merujuk skema auth Supabase.
-- Dibuat idempotent (IF NOT EXISTS / OR REPLACE) agar aman dijalankan sebelum atau bersamaan dengan baseline.
-- Kolom-kolom di bawah dijustifikasi oleh audit dependensi Task 3:
-- - id: uuid primary key (digunakan di semua foreign key, join, dan parameter p_user_id)
-- - instance_id: uuid (digunakan di create_test_auth_user_v1)
-- - email: text (digunakan di admin_search_users_v1, create_test_auth_user_v1, observabilitas, view)
-- - encrypted_password: text (digunakan di create_test_auth_user_v1)
-- - email_confirmed_at: timestamptz (digunakan di create_test_auth_user_v1)
-- - raw_app_meta_data: jsonb (digunakan di create_test_auth_user_v1)
-- - raw_user_meta_data: jsonb (digunakan di create_test_auth_user_v1)
-- - role: text (digunakan di create_test_auth_user_v1)
-- - aud: text (digunakan di create_test_auth_user_v1)
-- - created_at: timestamptz (digunakan di grant_welcome_credit_v1, create_test_auth_user_v1)
-- - updated_at: timestamptz (digunakan di create_test_auth_user_v1)

CREATE SCHEMA IF NOT EXISTS "auth";

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT null::uuid $$;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY,
  instance_id uuid,
  email text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  raw_app_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  role text,
  aud text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
