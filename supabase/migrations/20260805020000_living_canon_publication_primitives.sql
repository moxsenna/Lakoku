-- 20260805020000_living_canon_publication_primitives.sql
--
-- Compatibility migration.
--
-- PR #53 accidentally introduced this migration as a byte-identical copy of
-- 20260805015000_living_canon_publication_primitives.sql.
--
-- All Living Canon publication DDL is owned by 20260805015000.
-- Keep this migration version in place to preserve migration-history
-- compatibility, but never replay that DDL.

do $living_canon_duplicate_guard$
begin
  if to_regclass('public.chapter_state_commits') is null then
    raise exception using
      errcode = 'P0001',
      message = 'LIVING_CANON_015000_NOT_APPLIED';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.chapter_state_commits'::regclass
      and conname = 'chapter_state_commits_publication_payload_hash_check'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'LIVING_CANON_015000_HASH_CONSTRAINT_MISSING';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.chapter_state_commits'::regclass
      and conname = 'chapter_state_commits_publication_result_check'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'LIVING_CANON_015000_RESULT_CONSTRAINT_MISSING';
  end if;

  if to_regprocedure(
    'public.publish_generation_job_chapter_v5(uuid,text,uuid,uuid,text,integer,text,jsonb,jsonb,text,text)'
  ) is null then
    raise exception using
      errcode = 'P0001',
      message = 'LIVING_CANON_015000_V5_MISSING';
  end if;
end
$living_canon_duplicate_guard$;
