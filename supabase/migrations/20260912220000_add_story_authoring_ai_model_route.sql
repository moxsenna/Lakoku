-- Register route 'story_authoring' for interactive premise proposal and story bible creation.
-- Allows owner/admin to tune authoring models and fallbacks via the admin panel.

insert into public.ai_model_routes (
  use_case,
  provider,
  model_id,
  fallback_models,
  temperature,
  max_output_tokens,
  is_active,
  route_version,
  notes
)
values (
  'story_authoring',
  '9router',
  'ag/claude-sonnet-4-6',
  '[{"modelId":"ag/claude-opus-4-6-thinking","provider":"9router"}]'::jsonb,
  null,
  4096,
  true,
  '2026-09-authoring-9router',
  'Interactive story setup / premise brainstorming (structured JSON)'
)
on conflict do nothing;
