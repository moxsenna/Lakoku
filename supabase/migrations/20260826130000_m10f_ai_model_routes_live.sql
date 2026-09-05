-- M10-F defect fix #1 (pilot real-provider, 2026-08-26):
-- Route seed 20260711010000 memakai slug 'nousresearch/hermes-3-llama-3.1-405b:free'
-- yang sudah tidak dilayani OpenRouter (404 "unavailable for free"), sehingga
-- generasi nyata gagal di CHAPTER_PROSE_INITIAL dan di rantai choices
-- (REPAIR_EXHAUSTED / PROVIDER_ERROR). Selain itu route 'choices' & judge tidak
-- pernah di-seed — P1-8 menuntut route choices EKSPLISIT (fail-closed bila absen).
--
-- Perbaikan: ganti primary prose ke slug berbayar yang hidup, dan seed route
-- choices + continuity_judge dengan slug yang sama. Idempoten; aman untuk DB
-- yang belum/pernah menerapkan seed lama.

update public.ai_model_routes
set model_id = 'deepseek/deepseek-v3.2',
    fallback_models = '[{"modelId":"deepseek/deepseek-v3.1-terminus","provider":"openrouter"}]'::jsonb,
    route_version = '2026-08-m10f-live',
    notes = 'M10-F: replace retired :free slug with live paid slug',
    updated_at = now()
where use_case = 'chapter_prose'
  and model_id = 'nousresearch/hermes-3-llama-3.1-405b:free';

insert into public.ai_model_routes (
  use_case,
  provider,
  model_id,
  fallback_models,
  route_version,
  notes
)
values
  (
    'choices',
    'openrouter',
    'openai/gpt-4.1-mini',
    '[{"modelId":"deepseek/deepseek-v3.2","provider":"openrouter"}]'::jsonb,
    '2026-08-m10f-live',
    'M10-F: explicit actionability-aligned choices route (P1-8)'
  ),
  (
    'continuity_judge',
    'openrouter',
    'deepseek/deepseek-v3.2',
    '[{"modelId":"deepseek/deepseek-v3.1-terminus","provider":"openrouter"}]'::jsonb,
    '2026-08-m10f-live',
    'M10-F: explicit continuity judge route'
  )
on conflict do nothing;

update public.ai_model_routes
set provider = 'openrouter',
    model_id = 'openai/gpt-4.1-mini',
    fallback_models = '[{"modelId":"deepseek/deepseek-v3.2","provider":"openrouter"}]'::jsonb,
    route_version = '2026-08-m10f-live',
    notes = 'M10-F: explicit actionability-aligned choices route (P1-8)',
    updated_at = now()
where use_case = 'choices'
  and is_active = true;

update public.ai_model_routes
set provider = 'openrouter',
    model_id = 'deepseek/deepseek-v3.2',
    fallback_models = '[{"modelId":"deepseek/deepseek-v3.1-terminus","provider":"openrouter"}]'::jsonb,
    route_version = '2026-08-m10f-live',
    notes = 'M10-F: explicit continuity judge route',
    updated_at = now()
where use_case = 'continuity_judge'
  and is_active = true;
