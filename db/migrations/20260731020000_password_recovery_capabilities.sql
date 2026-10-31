create table public.password_recovery_capabilities (
  id uuid primary key default gen_random_uuid(),
  token_hash bytea not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default clock_timestamp()
);

create index password_recovery_capabilities_lookup_idx
  on public.password_recovery_capabilities(token_hash, user_id, session_id)
  where used_at is null;

revoke all on table public.password_recovery_capabilities from public, anon, authenticated, service_role;

create or replace function public.consume_password_recovery_capability_v1(
  p_token_hash bytea,
  p_user_id uuid,
  p_session_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.password_recovery_capabilities
  set used_at = pg_catalog.clock_timestamp()
  where token_hash = p_token_hash
    and user_id = p_user_id
    and session_id = p_session_id
    and used_at is null
    and expires_at > pg_catalog.clock_timestamp();
  return found;
end;
$$;

revoke all on function public.consume_password_recovery_capability_v1(bytea, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.consume_password_recovery_capability_v1(bytea, uuid, text) to service_role;

create or replace function public.create_password_recovery_capability_v1(
  p_token_hash bytea,
  p_user_id uuid,
  p_session_id text,
  p_ttl_seconds integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_ttl_seconds < 1 or p_ttl_seconds > 900 then
    raise exception using errcode = '22023', message = 'INVALID_RECOVERY_TTL';
  end if;
  insert into public.password_recovery_capabilities(token_hash, user_id, session_id, expires_at)
  values (p_token_hash, p_user_id, p_session_id, pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => p_ttl_seconds));
end;
$$;

revoke all on function public.create_password_recovery_capability_v1(bytea, uuid, text, integer) from public, anon, authenticated, service_role;
grant execute on function public.create_password_recovery_capability_v1(bytea, uuid, text, integer) to service_role;
