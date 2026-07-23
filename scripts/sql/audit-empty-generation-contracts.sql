-- Read-only audit: generation contracts that look empty / wiped.
-- Classify rows manually:
--   - legacy/placeholder
--   - damaged by creative-direction contract fallback
--   - rebuildable from locked bible/canon
--   - needs reauthoring (do NOT fill with {})

select
  story_id,
  mode,
  contract_source,
  jsonb_object_length(coalesce(story_contract_json, '{}'::jsonb)) as contract_keys,
  jsonb_object_length(coalesce(route_schema_json, '{}'::jsonb)) as route_keys,
  jsonb_array_length(coalesce(plot_debts_json, '[]'::jsonb)) as plot_debts,
  updated_at
from story_generation_contracts
where
  coalesce(story_contract_json, '{}'::jsonb) = '{}'::jsonb
  or coalesce(route_schema_json, '{}'::jsonb) = '{}'::jsonb
order by updated_at desc;
