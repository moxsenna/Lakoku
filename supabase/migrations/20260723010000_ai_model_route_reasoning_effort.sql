-- Add tunable per-route reasoning effort to ai_model_routes.
-- Null = provider default (current behaviour). A value like 'none' | 'minimal'
-- | 'low' | 'medium' | 'high' is forwarded to the model call as
-- `reasoning_effort` (see lib/ai-gateway/gateway-provider.ts routeProviderOptions).
-- Turning reasoning off on ag/* Gemini flash models removes token-starvation
-- (PROVIDER_INVALID_RESPONSE) and cuts latency (PROVIDER_TIMEOUT).
--
-- Schema-only: the model id + reasoning_effort VALUE per use_case is runtime
-- config (ai_model_routes is admin-editable without deploy), not seeded here.

alter table public.ai_model_routes
  add column if not exists reasoning_effort text null;

comment on column public.ai_model_routes.reasoning_effort is
  'Optional provider reasoning effort forwarded to the model call (none|minimal|low|medium|high). Null = provider default.';
