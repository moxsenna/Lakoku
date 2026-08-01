-- Forward-only private storage for short-lived encrypted generation incident labels.
-- Ciphertext is opaque to PostgreSQL; plaintext labels are never accepted or stored.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated, service_role;

create table private.generation_incident_captures (
  capture_id uuid primary key,
  correlation_id uuid not null,
  incident_key text not null,
  label_fingerprint text not null,
  version integer not null,
  story_id text not null,
  chapter_number integer not null,
  choice_index integer not null,
  stage text not null,
  code text not null,
  ciphertext text not null,
  nonce text not null,
  auth_tag text not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  claim_token uuid,
  claimed_by uuid,
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  constraint generation_incident_captures_incident_key_check check (
    incident_key = pg_catalog.btrim(incident_key)
    and pg_catalog.length(incident_key) between 43 and 128
    and incident_key ~ '^[A-Za-z0-9_+/=-]+$'
  ),
  constraint generation_incident_captures_fingerprint_check check (
    pg_catalog.length(label_fingerprint) between 40 and 128
    and label_fingerprint ~ '^[A-Za-z0-9_+/=-]+$'
  ),
  constraint generation_incident_captures_version_check check (version between 1 and 2147483647),
  constraint generation_incident_captures_story_id_check check (
    story_id = pg_catalog.btrim(story_id)
    and pg_catalog.length(story_id) between 1 and 200
    and story_id !~ '[[:cntrl:]]'
  ),
  constraint generation_incident_captures_chapter_check check (chapter_number between 1 and 50),
  constraint generation_incident_captures_choice_index_check check (choice_index between 0 and 31),
  constraint generation_incident_captures_stage_check check (stage = 'FINAL_BRANCH_SCHEMA'),
  constraint generation_incident_captures_code_check check (code = 'CHOICE_NOT_ACTIONABLE'),
  constraint generation_incident_captures_ciphertext_check check (
    pg_catalog.length(ciphertext) between 1 and 4096 and ciphertext ~ '^[A-Za-z0-9_+/-]+={0,2}$'
  ),
  constraint generation_incident_captures_nonce_check check (
    pg_catalog.length(nonce) between 16 and 32 and nonce ~ '^[A-Za-z0-9_+/-]+={0,2}$'
  ),
  constraint generation_incident_captures_auth_tag_check check (
    pg_catalog.length(auth_tag) between 16 and 64 and auth_tag ~ '^[A-Za-z0-9_+/-]+={0,2}$'
  ),
  constraint generation_incident_captures_ttl_check check (
    expires_at > created_at and expires_at <= created_at + interval '60 minutes'
  ),
  constraint generation_incident_captures_consumed_check check (consumed_at is null or consumed_at >= created_at),
  constraint generation_incident_captures_claim_token_check check (
    (claim_token is null and claimed_by is null and claimed_at is null and claim_expires_at is null)
    or
    (claim_token is not null and claimed_by is not null and claimed_at is not null and claim_expires_at is not null)
  ),
  constraint generation_incident_captures_claim_owner_check check (
    consumed_at is null or claim_token is null
  ),
  constraint generation_incident_captures_claim_ttl_check check (
    claim_expires_at is null or claim_expires_at = claimed_at + interval '2 minutes'
  ),
  constraint generation_incident_captures_first_wins_key unique (
    incident_key, version, story_id, chapter_number
  )
);

create index generation_incident_captures_expiry_idx
on private.generation_incident_captures(expires_at, capture_id);
create index generation_incident_captures_consumed_idx
on private.generation_incident_captures(consumed_at, capture_id) where consumed_at is not null;
create index generation_incident_captures_claim_expiry_idx
on private.generation_incident_captures(claim_expires_at, capture_id) where claim_token is not null;

create table private.generation_incident_access_audit (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  capture_id uuid not null,
  correlation_id uuid not null,
  actor_user_id uuid,
  action text not null check (action in ('CONSUMED', 'EXPIRED', 'PURGED')),
  occurred_at timestamptz not null default pg_catalog.clock_timestamp()
);

create index generation_incident_access_audit_capture_idx
on private.generation_incident_access_audit(capture_id, occurred_at, id);
create index generation_incident_access_audit_actor_idx
on private.generation_incident_access_audit(actor_user_id, occurred_at desc, id desc)
where actor_user_id is not null;

alter table private.generation_incident_captures enable row level security;
alter table private.generation_incident_captures force row level security;
alter table private.generation_incident_access_audit enable row level security;
alter table private.generation_incident_access_audit force row level security;
revoke all on table private.generation_incident_captures from public, anon, authenticated, service_role;
revoke all on table private.generation_incident_access_audit from public, anon, authenticated, service_role;

create function public.capture_generation_incident_v1(
  p_capture_id uuid,
  p_correlation_id uuid,
  p_incident_key text,
  p_label_fingerprint text,
  p_version integer,
  p_story_id text,
  p_chapter_number integer,
  p_choice_index integer,
  p_stage text,
  p_code text,
  p_ciphertext text,
  p_nonce text,
  p_auth_tag text,
  p_expires_at timestamptz
)
returns table (capture_id uuid, correlation_id uuid, captured boolean, expires_at timestamptz)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_created_at timestamptz := pg_catalog.clock_timestamp();
  v_row private.generation_incident_captures%rowtype;
begin
  if p_capture_id is null or p_correlation_id is null or p_expires_at is null
    or p_expires_at <= v_created_at or p_expires_at > v_created_at + interval '60 minutes' then
    raise exception using errcode = 'P0001', message = 'INVALID_INCIDENT_CAPTURE';
  end if;

  insert into private.generation_incident_captures (
    capture_id, correlation_id, incident_key, label_fingerprint, version, story_id,
    chapter_number, choice_index, stage, code, ciphertext, nonce, auth_tag, created_at, expires_at
  ) values (
    p_capture_id, p_correlation_id, p_incident_key, p_label_fingerprint, p_version, p_story_id,
    p_chapter_number, p_choice_index, p_stage, p_code, p_ciphertext, p_nonce, p_auth_tag,
    v_created_at, p_expires_at
  )
  on conflict (incident_key, version, story_id, chapter_number) do nothing
  returning * into v_row;

  if found then
    return query select v_row.capture_id, v_row.correlation_id, true, v_row.expires_at;
    return;
  end if;

  select captures.* into strict v_row
  from private.generation_incident_captures as captures
  where captures.incident_key = p_incident_key
    and captures.version = p_version
    and captures.story_id = p_story_id
    and captures.chapter_number = p_chapter_number;
  return query select v_row.capture_id, v_row.correlation_id, false, v_row.expires_at;
end
$$;

create function public.claim_generation_incident_v1(
  p_capture_id uuid,
  p_correlation_id uuid,
  p_claim_token uuid
)
returns table (
  capture_id uuid, correlation_id uuid, incident_key text, label_fingerprint text,
  version integer, story_id text, chapter_number integer, choice_index integer,
  stage text, code text, expires_at timestamptz, ciphertext text, nonce text, auth_tag text,
  claim_expires_at timestamptz
)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_claimed_at timestamptz := pg_catalog.clock_timestamp();
  v_row private.generation_incident_captures%rowtype;
begin
  if v_actor is null or not exists (
    select 1 from public.admin_users as admins
    where admins.user_id = v_actor and admins.role = 'owner'
  ) then
    raise exception using errcode = 'P0001', message = 'OWNER_REQUIRED';
  end if;
  if p_capture_id is null or p_correlation_id is null or p_claim_token is null then
    raise exception using errcode = 'P0001', message = 'INVALID_INCIDENT_CLAIM';
  end if;

  update private.generation_incident_captures as captures
  set claim_token = p_claim_token,
      claimed_by = v_actor,
      claimed_at = v_claimed_at,
      claim_expires_at = v_claimed_at + interval '2 minutes'
  where captures.capture_id = p_capture_id
    and captures.correlation_id = p_correlation_id
    and captures.consumed_at is null
    and captures.expires_at > v_claimed_at
    and (captures.claim_token is null or captures.claim_expires_at <= v_claimed_at)
  returning captures.* into v_row;

  if not found then return; end if;
  return query select
    v_row.capture_id, v_row.correlation_id, v_row.incident_key, v_row.label_fingerprint,
    v_row.version, v_row.story_id, v_row.chapter_number, v_row.choice_index,
    v_row.stage, v_row.code, v_row.expires_at, v_row.ciphertext, v_row.nonce,
    v_row.auth_tag, v_row.claim_expires_at;
end
$$;

create function public.finalize_generation_incident_v1(
  p_capture_id uuid,
  p_correlation_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_row private.generation_incident_captures%rowtype;
begin
  if v_actor is null or not exists (
    select 1 from public.admin_users as admins
    where admins.user_id = v_actor and admins.role = 'owner'
  ) then
    raise exception using errcode = 'P0001', message = 'OWNER_REQUIRED';
  end if;
  if p_capture_id is null or p_correlation_id is null or p_claim_token is null then
    raise exception using errcode = 'P0001', message = 'INVALID_INCIDENT_FINALIZE';
  end if;

  update private.generation_incident_captures as captures
  set consumed_at = v_now, claim_token = null, claimed_by = null,
      claimed_at = null, claim_expires_at = null
  where captures.capture_id = p_capture_id
    and captures.correlation_id = p_correlation_id
    and captures.claimed_by = v_actor
    and captures.claim_token = p_claim_token
    and captures.claim_expires_at > v_now
    and captures.expires_at > v_now
    and captures.consumed_at is null
  returning captures.* into v_row;

  if not found then return false; end if;
  insert into private.generation_incident_access_audit (
    capture_id, correlation_id, actor_user_id, action, occurred_at
  ) values (v_row.capture_id, v_row.correlation_id, v_actor, 'CONSUMED', v_now);
  return true;
end
$$;

create function public.release_generation_incident_claim_v1(
  p_capture_id uuid,
  p_correlation_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_released boolean;
begin
  if v_actor is null or not exists (
    select 1 from public.admin_users as admins
    where admins.user_id = v_actor and admins.role = 'owner'
  ) then
    raise exception using errcode = 'P0001', message = 'OWNER_REQUIRED';
  end if;
  if p_capture_id is null or p_correlation_id is null or p_claim_token is null then
    raise exception using errcode = 'P0001', message = 'INVALID_INCIDENT_RELEASE';
  end if;

  update private.generation_incident_captures as captures
  set claim_token = null, claimed_by = null, claimed_at = null, claim_expires_at = null
  where captures.capture_id = p_capture_id
    and captures.correlation_id = p_correlation_id
    and captures.claimed_by = v_actor
    and captures.claim_token = p_claim_token
    and captures.consumed_at is null;
  v_released := found;
  return v_released;
end
$$;

create function public.cleanup_generation_incidents_v1(p_batch_size integer default 1000)
returns table (deleted_count integer, has_more boolean)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_deleted integer;
begin
  if p_batch_size is null or p_batch_size not between 1 and 5000 then
    raise exception using errcode = 'P0001', message = 'INVALID_INCIDENT_CLEANUP_BATCH';
  end if;

  update private.generation_incident_captures as captures
  set claim_token = null, claimed_by = null, claimed_at = null, claim_expires_at = null
  where captures.consumed_at is null
    and captures.expires_at > v_now
    and captures.claim_token is not null
    and captures.claim_expires_at <= v_now;

  with selected as (
    select captures.capture_id
    from private.generation_incident_captures as captures
    where captures.consumed_at is not null or captures.expires_at <= v_now
    order by coalesce(captures.consumed_at, captures.expires_at), captures.capture_id
    for update skip locked
    limit p_batch_size
  ), audited as (
    insert into private.generation_incident_access_audit (
      capture_id, correlation_id, actor_user_id, action, occurred_at
    )
    select captures.capture_id, captures.correlation_id, null,
      case when captures.consumed_at is null then 'EXPIRED' else 'PURGED' end, v_now
    from private.generation_incident_captures as captures join selected using (capture_id)
    where not exists (
      select 1 from private.generation_incident_access_audit as audit
      where audit.capture_id = captures.capture_id
        and audit.action = case when captures.consumed_at is null then 'EXPIRED' else 'PURGED' end
    )
    returning capture_id
  ), deleted as (
    delete from private.generation_incident_captures as captures using selected
    where captures.capture_id = selected.capture_id returning captures.capture_id
  )
  select pg_catalog.count(*)::integer into v_deleted from deleted;

  return query select v_deleted, exists (
    select 1 from private.generation_incident_captures as captures
    where captures.consumed_at is not null or captures.expires_at <= v_now
  );
end
$$;

create function public.cleanup_generation_incidents_scheduled_v1()
returns integer
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_iteration integer := 0;
  v_deleted integer;
  v_total integer := 0;
  v_has_more boolean := true;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('cleanup_generation_incidents_scheduled_v1')) then
    return 0;
  end if;
  while v_has_more and v_iteration < 20 loop
    select cleanup.deleted_count, cleanup.has_more into v_deleted, v_has_more
    from public.cleanup_generation_incidents_v1(1000) as cleanup;
    v_total := v_total + v_deleted;
    v_iteration := v_iteration + 1;
  end loop;
  return v_total;
end
$$;

revoke all on function public.capture_generation_incident_v1(uuid,uuid,text,text,integer,text,integer,integer,text,text,text,text,text,timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.capture_generation_incident_v1(uuid,uuid,text,text,integer,text,integer,integer,text,text,text,text,text,timestamptz) to service_role;
revoke all on function public.claim_generation_incident_v1(uuid,uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.claim_generation_incident_v1(uuid,uuid,uuid) to authenticated;
revoke all on function public.finalize_generation_incident_v1(uuid,uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.finalize_generation_incident_v1(uuid,uuid,uuid) to authenticated;
revoke all on function public.release_generation_incident_claim_v1(uuid,uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.release_generation_incident_claim_v1(uuid,uuid,uuid) to authenticated;
revoke all on function public.cleanup_generation_incidents_v1(integer) from public, anon, authenticated, service_role;
grant execute on function public.cleanup_generation_incidents_v1(integer) to service_role;
revoke all on function public.cleanup_generation_incidents_scheduled_v1() from public, anon, authenticated, service_role;

-- Local Supabase includes pg_cron. Scheduler invokes a 20,000-row maximum drain every 15 minutes.
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule(
  'generation-incident-cleanup-v1',
  '*/15 * * * *',
  'select public.cleanup_generation_incidents_scheduled_v1()'
);
