-- Admin user search RPC — query auth.users via SECURITY DEFINER.
-- Hanya bisa dipanggil service_role. Return max 10 hasil.
create or replace function public.admin_search_users_v1(p_email text)
returns table (
  user_id uuid,
  email text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    id,
    email::text
  from auth.users
  where lower(email) like lower('%' || p_email || '%')
    and email is not null
  order by email
  limit 10;
$$;

grant execute on function public.admin_search_users_v1(text) to service_role;
