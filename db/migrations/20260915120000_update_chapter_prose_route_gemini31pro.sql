-- Update active 'chapter_prose' route to use qualified gweb/gemini-3.1-pro model with sonnet fallback.
-- gweb/gemini-3.1-pro is the qualified 9Router writer model adhering to 800-1000 word mobile prose bands.

update public.ai_model_routes
set model_id = 'gweb/gemini-3.1-pro',
    provider = '9router',
    fallback_models = '[{"modelId":"ag/claude-sonnet-4-6","provider":"9router"},{"modelId":"gweb/gemini-3.8-flash","provider":"9router"},{"modelId":"deepseek/deepseek-v4.1","provider":"openrouter"}]'::jsonb,
    temperature = null,
    max_output_tokens = 4096,
    route_version = '2026-09-m10g-9router-gemini31pro',
    notes = 'Qualified 9router writer model (gweb/gemini-3.1-pro) with sonnet & openrouter fallback',
    updated_at = now()
where use_case = 'chapter_prose'
  and is_active = true;
