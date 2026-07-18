-- Add '9router' as an allowed ai_model_routes.provider value.
-- 9router is an OpenAI-compatible proxy distinct from `custom` (own base URL + key).
-- Route activation for chapter_prose is done via admin UI after deploy
-- (seed omitted: partial unique index on use_case WHERE is_active prevents
-- safe ON CONFLICT (use_case) without a full unique constraint).
alter table public.ai_model_routes
  drop constraint if exists ai_model_routes_provider_check;

alter table public.ai_model_routes
  add constraint ai_model_routes_provider_check
  check (provider in ('custom', 'openrouter', '9router', 'gateway', 'deterministic'));
