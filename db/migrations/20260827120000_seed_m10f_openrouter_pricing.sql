-- M10-F real-provider cost authority, retrieved 2026-08-27 from OpenRouter's
-- public per-model endpoint APIs:
--   https://openrouter.ai/api/v1/models/deepseek/deepseek-v3.2/endpoints
--   https://openrouter.ai/api/v1/models/openai/gpt-4.1-mini/endpoints
--   https://openrouter.ai/api/v1/models/deepseek/deepseek-v3.1-terminus/endpoints
--
-- generation_provider_calls persists the OpenRouter model, but not the backing
-- endpoint selected by OpenRouter. Each model-level estimate therefore uses the
-- highest observed active endpoint input/output prices. This is deliberately
-- conservative: cost evidence may overestimate, never silently undercount.

insert into public.generation_model_pricing_versions (
  provider_id,
  model_id,
  input_token_price,
  output_token_price,
  currency,
  unit_size,
  effective_from,
  effective_to,
  created_by
)
values
  (
    'openrouter',
    'deepseek/deepseek-v3.2',
    3.00000000,
    4.50000000,
    'USD',
    1000000,
    '2026-08-27 00:00:00+00',
    null,
    '00000000-0000-0000-0000-000000000000'
  ),
  (
    'openrouter',
    'openai/gpt-4.1-mini',
    0.44000000,
    1.76000000,
    'USD',
    1000000,
    '2026-08-27 00:00:00+00',
    null,
    '00000000-0000-0000-0000-000000000000'
  ),
  (
    'openrouter',
    'deepseek/deepseek-v3.1-terminus',
    0.34260000,
    1.02840000,
    'USD',
    1000000,
    '2026-08-27 00:00:00+00',
    null,
    '00000000-0000-0000-0000-000000000000'
  )
on conflict (provider_id, model_id, effective_from) do nothing;
