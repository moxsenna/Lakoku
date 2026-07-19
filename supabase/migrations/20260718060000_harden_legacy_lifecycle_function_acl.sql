-- Remove legacy default PUBLIC EXECUTE after existing-production baseline validation.

revoke all on function public.acquire_generation_lease(
  text, integer, text, integer, text
) from public, anon, authenticated;
revoke all on function public.release_generation_lease(
  text, uuid
) from public, anon, authenticated;
revoke all on function public.publish_chapter(
  text, integer, text, jsonb, text, jsonb, jsonb, uuid, text
) from public, anon, authenticated;

grant execute on function public.acquire_generation_lease(
  text, integer, text, integer, text
) to service_role;
grant execute on function public.release_generation_lease(
  text, uuid
) to service_role;
grant execute on function public.publish_chapter(
  text, integer, text, jsonb, text, jsonb, jsonb, uuid, text
) to service_role;
