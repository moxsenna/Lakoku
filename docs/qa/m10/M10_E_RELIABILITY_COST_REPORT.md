# M10-E — Laporan Evaluasi Ekonomi Reliabilitas (Reliability Economics Evaluation Report)
## 1. Lingkup dan Otoritas (Scope and Authority)
- schemaVersion = `M10_E_RELIABILITY_SEMANTIC_PAYLOAD_V1`
- executionProfile = `CONTRACT_FIXTURE`
- sourceAuthority = `CONTRACT_FIXTURE`
- baseGitSha = `ded6b1bcfb56b878fcdc1cc9c99f4817f2bb28b8e6ee077b90facd96e893a11b`
- gitDirty = `false`
- e2ClosureReference = `dbae9f377f2dd17d7032b348523f58201d98d73e9e9fc1b120be186981051410`
- compatibleStratum = provider `provider_v1`, pricing `pricing_v1`/`de7a4bb8aa2812345a093523f03a6b4f358e772dba1ed84b7674b2fc68eba1d8`, retry `retry_v1`/`aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`
- stageCatalogVersion = `M10_E_STAGE_CATALOG_V1#42b18988a77d3b210d283d30a97622c41309a120cd0d92c546984883c57204bd`
- taskMappingVersion = `M10_E_TASK_MAPPING_V1#48f44fbeaa537258908cf701d1398d09bf678f7c7368fbd65cc8e28d1618ead8`
- topologyVersion = `M10_E_TOPOLOGY_V1#cd4703496d575571534dedf13307f4f25efdcb581ad1ed29fb1799f28207113f`
- monteCarloAuthority = `M10_E_MONTE_CARLO_V1#0aab4a2b31d09a359595a577a6fb5a9094d907ff7049da8de130659c0739a088`
- cumulativeModelAuthority = `M10_E_CUMULATIVE_MODEL_V1#aea651b77f04954acd858256a6de3b950761d858e854ea14e85edf6ad4c14067`
- judgePlanAuthority = `M10_E_JUDGE_PLAN_V1#c5f81c15d4eeb550702b1d2c1fca969373890e39fb4c545d6520db757cd3439c (24 evaluasi)`
- independentDrawCorrelation = `M10_E_INDEPENDENT_DRAW_ASSUMPTION_V1#409537aad6fb733c2d6bdaac2c7e7ab0b1152ac9f4611bfe66892029285bb6d2`
- pricingSnapshotHash = `de7a4bb8aa2812345a093523f03a6b4f358e772dba1ed84b7674b2fc68eba1d8`
- budgetAuthorityStatus = `ABSENT_OR_NOT_APPROVED; novelCostConditioning = SUCCESSFUL_50_CHAPTER_RUN`
- executionProfile = CONTRACT_FIXTURE
- engineeringGate = PASS
- releaseReadiness = HOLD
- budgetGate = BLOCKED_E0_COST_CEILING_NOT_APPROVED
- G2-BUDGET = OPEN
- M10-E = OPEN
## 2. Reliabilitas Teramati (Observed Reliability)
- evidenceClassification = `PASS (0 alasan)`
requiredMetric.FIRST_ATTEMPT_SUCCESS_RATE = 0.000000000000 (OBSERVED; denominator 101; included 101, excluded 0, eligible 101; coverage 1.000000000000, PRESENT)
requiredMetric.RETRY_SUCCESS_RATE = 0.495049504950 (OBSERVED; denominator 101; included 101, excluded 0, eligible 101; coverage 1.000000000000, PRESENT)
requiredMetric.TERMINAL_FAILURE_RATE = 0.504950495050 (OBSERVED; denominator 101; included 101, excluded 0, eligible 101; coverage 1.000000000000, PRESENT)
requiredMetric.CHECKPOINT_REUSE_RATE = 0.000000000000 (OBSERVED; denominator 102; included 102, excluded 0, eligible 102; coverage 1.000000000000, PRESENT)
requiredMetric.PROSE_REGENERATION_ON_CHOICE_RETRY_RATE = 0.000000000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.OWNERSHIP_LOSS_RECOVERY_RATE = 1.000000000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.RECOVERY_SUCCESS_RATE = 0.662337662338 (OBSERVED; denominator 154; included 154, excluded 0, eligible 154; coverage 1.000000000000, PRESENT)
requiredMetric.PROVIDER_FALLBACK_RATE = 1.000000000000 (OBSERVED; denominator 51; included 51, excluded 0, eligible 51; coverage 1.000000000000, PRESENT)
requiredMetric.FULL_NOVEL_COMPLETION_RATE = 0.500000000000 (OBSERVED; denominator 2; included 2, excluded 0, eligible 2; coverage 1.000000000000, PRESENT)
requiredMetric.RETRY_COUNT = 154 (OBSERVED; denominator 456; included 456, excluded 0, eligible 456; coverage 1.000000000000, PRESENT)
requiredMetric.GENERATION_PROVIDER_CALL_COUNT = 253 (OBSERVED; denominator 253; included 253, excluded 0, eligible 253; coverage 1.000000000000, PRESENT)
requiredMetric.JUDGE_PROVIDER_CALL_COUNT = 24 (OBSERVED; denominator 24; included 24, excluded 0, eligible 24; coverage 1.000000000000, PRESENT)
requiredMetric.TOTAL_PROVIDER_CALL_COUNT = 277 (OBSERVED; denominator 277; included 277, excluded 0, eligible 277; coverage 1.000000000000, PRESENT)
requiredMetric.DUPLICATE_PUBLICATION_COUNT = 0 (OBSERVED; denominator 50; included 50, excluded 0, eligible 50; coverage 1.000000000000, PRESENT)
requiredMetric.CANONICAL_CORRUPTION_COUNT = 0 (OBSERVED; denominator 50; included 50, excluded 0, eligible 50; coverage 1.000000000000, PRESENT)
requiredMetric.GENERATION_LATENCY_P50 = 500.000 (OBSERVED; denominator 101; included 2, excluded 99, eligible 101; coverage 0.019801980198, PRESENT)
requiredMetric.GENERATION_LATENCY_P95 = 500.000 (OBSERVED; denominator 101; included 2, excluded 99, eligible 101; coverage 0.019801980198, PRESENT)
requiredMetric.RECOVERY_LATENCY_P50 = 500.000 (OBSERVED; denominator 154; included 1, excluded 153, eligible 154; coverage 0.006493506494, PRESENT)
requiredMetric.RECOVERY_LATENCY_P95 = 500.000 (OBSERVED; denominator 154; included 1, excluded 153, eligible 154; coverage 0.006493506494, PRESENT)
requiredMetric.INPUT_TOKEN_USAGE = 25300 (OBSERVED; denominator 253; included 253, excluded 0, eligible 253; coverage 1.000000000000, PRESENT)
requiredMetric.OUTPUT_TOKEN_USAGE = 63250 (OBSERVED; denominator 253; included 253, excluded 0, eligible 253; coverage 1.000000000000, PRESENT)
requiredMetric.TOTAL_TOKEN_USAGE = 88550 (OBSERVED; denominator 253; included 253, excluded 0, eligible 253; coverage 1.000000000000, PRESENT)
requiredMetric.ACTUAL_PROVIDER_COST = 104.00000000 (OBSERVED; denominator 253; included 253, excluded 0, eligible 253; coverage 1.000000000000, PRESENT)
requiredMetric.PRICING_ESTIMATED_COST = 104.00000000 (MODELED_FROM_PRICING; denominator 253; included 253, excluded 0, eligible 253; coverage 1.000000000000, PRESENT)
requiredMetric.ACTUAL_COST_COVERAGE_RATIO = 1.000000000000 (OBSERVED; denominator 253; included 253, excluded 0, eligible 253; coverage 1.000000000000, PRESENT)
requiredMetric.PRICING_COST_COVERAGE_RATIO = 1.000000000000 (MODELED_FROM_PRICING; denominator 253; included 253, excluded 0, eligible 253; coverage 1.000000000000, PRESENT)
requiredMetric.EMPIRICAL_CHAPTER_STAGE_FAILURE_DISTRIBUTION = 0.451754385965 (OBSERVED; denominator 456; included 456, excluded 0, eligible 456; coverage 1.000000000000, PRESENT)
requiredMetric.OBSERVED_COMPLETED_NOVEL_COUNT = 1 (OBSERVED; denominator 2; included 2, excluded 0, eligible 2; coverage 1.000000000000, PRESENT)
requiredMetric.FIRST_ATTEMPT_BASELINE_COST = MISSING (MODELED_FROM_PRICING; denominator 0; included 0, excluded 0, eligible 0; coverage 0.000000000000; P5 pricing selection required for modeled first-attempt baseline)
requiredMetric.RETRY_FALLBACK_COST = MISSING (MODELED_FROM_PRICING; denominator 0; included 0, excluded 0, eligible 0; coverage 0.000000000000; P5 pricing selection required for modeled retry/fallback cost)
requiredMetric.RETRY_OVERHEAD_PERCENTAGE = MISSING (MODELED_FROM_PRICING; denominator 0; included 0, excluded 0, eligible 0; coverage 0.000000000000; P5 modeled baseline and retry costs required)
requiredMetric.CHAPTER_COST_P50 = 1.77500000 (OBSERVED; denominator 2; included 2, excluded 0, eligible 2; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P50 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P50 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P50 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P50 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P50 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P50 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P50 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P50 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P50 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P50 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P50 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P50 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P50 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P50 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P50 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P50 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P50 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P50 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P50 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P50 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P50 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P50 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P50 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P50 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P50 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P50 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P50 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P50 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P50 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P50 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P50 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P50 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P50 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P50 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P50 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P50 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P50 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P50 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P50 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P50 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P50 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P50 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P50 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P50 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P50 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P50 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P50 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P50 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P50 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P95 = 2.02250000 (OBSERVED; denominator 2; included 2, excluded 0, eligible 2; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P95 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P95 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P95 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P95 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P95 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P95 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P95 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P95 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P95 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P95 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P95 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P95 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P95 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P95 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P95 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P95 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P95 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P95 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P95 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P95 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P95 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P95 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P95 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P95 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P95 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P95 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P95 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P95 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P95 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P95 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P95 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P95 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P95 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P95 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P95 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P95 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P95 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P95 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P95 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P95 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P95 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P95 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P95 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P95 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P95 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P95 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P95 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P95 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.CHAPTER_COST_P95 = 2.05000000 (OBSERVED; denominator 1; included 1, excluded 0, eligible 1; coverage 1.000000000000, PRESENT)
requiredMetric.JUDGE_EVALUATION_COST = 2.40000000 (OBSERVED; denominator 24; included 24, excluded 0, eligible 24; coverage 1.000000000000, PRESENT)
- Aggregasi dilakukan secara deterministik dari observasi teramati pada strata eksak terpilih (OBSERVED).
- profileThresholds = `stagePools ok=11/11, applicableCells ok=452/452, completeNovels 1/0`
## 3. Cakupan Token dan Biaya Teramati (Observed Token and Cost Coverage)
requiredMetric.INPUT_TOKEN_USAGE = 25300 (OBSERVED; included 253, excluded 0, eligible 253, PRESENT)
requiredMetric.OUTPUT_TOKEN_USAGE = 63250 (OBSERVED; included 253, excluded 0, eligible 253, PRESENT)
requiredMetric.TOTAL_TOKEN_USAGE = 88550 (OBSERVED; included 253, excluded 0, eligible 253, PRESENT)
requiredMetric.ACTUAL_PROVIDER_COST = 104.00000000 (OBSERVED; included 253, excluded 0, eligible 253, PRESENT)
requiredMetric.PRICING_ESTIMATED_COST = 104.00000000 (MODELED_FROM_PRICING; included 253, excluded 0, eligible 253, PRESENT)
requiredMetric.ACTUAL_COST_COVERAGE_RATIO = 1.000000000000 (OBSERVED; included 253, excluded 0, eligible 253, PRESENT)
requiredMetric.PRICING_COST_COVERAGE_RATIO = 1.000000000000 (MODELED_FROM_PRICING; included 253, excluded 0, eligible 253, PRESENT)
requiredMetric.CHAPTER_COST_P50 = 1.77500000 (OBSERVED; included 2, excluded 0, eligible 2, PRESENT)
requiredMetric.CHAPTER_COST_P95 = 2.02250000 (OBSERVED; included 2, excluded 0, eligible 2, PRESENT)
requiredMetric.JUDGE_EVALUATION_COST = 2.40000000 (OBSERVED; included 24, excluded 0, eligible 24, PRESENT)
- Perhitungan token eksak (input + output = total) dan biaya memakai denominasi mata uang strata eksak.
- Biaya estimasi bersifat MODELED_FROM_PRICING dan tetap terpisah dari biaya aktual OBSERVED.
## 4. Estimasi Turunan Harga (Pricing-Derived Estimates)
pricingSlot.firstAttemptBaselineCost = MISSING (MODELED_FROM_PRICING; P5 pricing selection required for modeled first-attempt baseline)
- pricingSlot.firstAttemptBaselineCost.pricingSnapshotHash = `de7a4bb8aa2812345a093523f03a6b4f358e772dba1ed84b7674b2fc68eba1d8`
pricingSlot.retryFallbackCost = MISSING (MODELED_FROM_PRICING; P5 pricing selection required for modeled retry/fallback cost)
- pricingSlot.retryFallbackCost.pricingSnapshotHash = `de7a4bb8aa2812345a093523f03a6b4f358e772dba1ed84b7674b2fc68eba1d8`
pricingSlot.retryOverheadPercentage = MISSING (MODELED_FROM_PRICING; P5 modeled baseline and retry costs required)
- pricingSlot.retryOverheadPercentage.pricingSnapshotHash = `de7a4bb8aa2812345a093523f03a6b4f358e772dba1ed84b7674b2fc68eba1d8`
pricingSlot.expectedGenerationCostPerSuccessfulNovelRun = MISSING (MODELED_FROM_PRICING; P5/P6 modeled successful-novel mean unavailable)
- pricingSlot.expectedGenerationCostPerSuccessfulNovelRun.pricingSnapshotHash = `de7a4bb8aa2812345a093523f03a6b4f358e772dba1ed84b7674b2fc68eba1d8`
pricingSlot.modeledJudgeTotal = MISSING (MODELED_FROM_PRICING; P5/P6 modeled judge total unavailable)
- pricingSlot.modeledJudgeTotal.pricingSnapshotHash = `de7a4bb8aa2812345a093523f03a6b4f358e772dba1ed84b7674b2fc68eba1d8`
pricingSlot.modeledCombinedTotalNovelCostP95 = MISSING (MODELED_FROM_PRICING; P5/P6 modeled combined p95 unavailable)
- pricingSlot.modeledCombinedTotalNovelCostP95.pricingSnapshotHash = `de7a4bb8aa2812345a093523f03a6b4f358e772dba1ed84b7674b2fc68eba1d8`
- Estimasi turunan harga hanyalah proyeksi harga per unit dari snapshot otoritas, bukan biaya aktual dan bukan otoritas anggaran.
- Binding E0 ke snapshot harga tidak mengubah estimasi menjadi observasi atau keputusan bisnis.
## 5. Asumsi (Assumptions)
- chapterStageExchangeabilityAssumption PROSE_PRIMARY: versi `M10_E_CHAPTER_STAGE_EXCHANGEABILITY_V1`, hash `cecf1921a292d11eff9e8f4bdbe7fa76342f423b84cb62dbc95cca43f8c87354`, scope bab 1..50, sumber keputusan `docs/superpowers/specs/2026-08-13-m10-e-e3a-e4-reliability-economics-design.md`
- chapterStageExchangeabilityAssumption PROSE_RETRY: versi `M10_E_CHAPTER_STAGE_EXCHANGEABILITY_V1`, hash `6cb6c41334d6ff56177faadf4b64506364c37d20c127af7e6803ac9b01b9df60`, scope bab 1..50, sumber keputusan `docs/superpowers/specs/2026-08-13-m10-e-e3a-e4-reliability-economics-design.md`
- chapterStageExchangeabilityAssumption PROVIDER_FALLBACK: versi `M10_E_CHAPTER_STAGE_EXCHANGEABILITY_V1`, hash `49996f6646de55ff64f1f58a94af77ab13010483a083b1e24fef59a5d0e28219`, scope bab 1..50, sumber keputusan `docs/superpowers/specs/2026-08-13-m10-e-e3a-e4-reliability-economics-design.md`
- chapterStageExchangeabilityAssumption CHECKPOINT_RECOVERY: versi `M10_E_CHAPTER_STAGE_EXCHANGEABILITY_V1`, hash `99547484fa0868d8be5fcb2ceaa3113b54bcd2fae357652d855ec286e268796e`, scope bab 1..50, sumber keputusan `docs/superpowers/specs/2026-08-13-m10-e-e3a-e4-reliability-economics-design.md`
- chapterStageExchangeabilityAssumption STRUCTURED_OUTPUT: versi `M10_E_CHAPTER_STAGE_EXCHANGEABILITY_V1`, hash `9deda94e205df315a27d759a5e5eb9fdd9fd6e4a52cfbed7e9c63f014c475d6c`, scope bab 1..50, sumber keputusan `docs/superpowers/specs/2026-08-13-m10-e-e3a-e4-reliability-economics-design.md`
- chapterStageExchangeabilityAssumption STRUCTURED_RETRY: versi `M10_E_CHAPTER_STAGE_EXCHANGEABILITY_V1`, hash `ccc72778a5e298ff5ed8b02aa4f90dfc412e3861cb98f4643b7eb27e011b0283`, scope bab 1..50, sumber keputusan `docs/superpowers/specs/2026-08-13-m10-e-e3a-e4-reliability-economics-design.md`
- chapterStageExchangeabilityAssumption OWNERSHIP: versi `M10_E_CHAPTER_STAGE_EXCHANGEABILITY_V1`, hash `a3b85e931f52ddf002cdd4fd9545e94a244a145a4be2683e23cd5f1161ec548f`, scope bab 1..50, sumber keputusan `docs/superpowers/specs/2026-08-13-m10-e-e3a-e4-reliability-economics-design.md`
- chapterStageExchangeabilityAssumption OWNERSHIP_RECOVERY: versi `M10_E_CHAPTER_STAGE_EXCHANGEABILITY_V1`, hash `945784751da2ef9110415d0d5eb6e3b6cd6d3ab975ed282bb6b9464a53635f6f`, scope bab 1..50, sumber keputusan `docs/superpowers/specs/2026-08-13-m10-e-e3a-e4-reliability-economics-design.md`
- chapterStageExchangeabilityAssumption PUBLICATION: versi `M10_E_CHAPTER_STAGE_EXCHANGEABILITY_V1`, hash `59b0a76b301e403c1d7a4591b888d114c4186a31a580106fd80718f39fb74a78`, scope bab 1..50, sumber keputusan `docs/superpowers/specs/2026-08-13-m10-e-e3a-e4-reliability-economics-design.md`
- chapterStageExchangeabilityAssumption PUBLICATION_RECOVERY: versi `M10_E_CHAPTER_STAGE_EXCHANGEABILITY_V1`, hash `d86892a5b44829c0147e3b92c6259c4463e8c2c495ca2e8b75b05b67ac8da7b6`, scope bab 1..50, sumber keputusan `docs/superpowers/specs/2026-08-13-m10-e-e3a-e4-reliability-economics-design.md`
- chapterStageExchangeabilityAssumption POST_PUBLISH: versi `M10_E_CHAPTER_STAGE_EXCHANGEABILITY_V1`, hash `bdee602790a07de8f1ff654856d3b8aee336939ebcdf60dde17727e32ddab8c7`, scope bab 1..50, sumber keputusan `docs/superpowers/specs/2026-08-13-m10-e-e3a-e4-reliability-economics-design.md`
- independentDrawCorrelation: `M10_E_INDEPENDENT_DRAW_ASSUMPTION_V1`#`409537aad6fb733c2d6bdaac2c7e7ab0b1152ac9f4611bfe66892029285bb6d2` — Generation-node outcomes, chapters, generation costs, and judge cost samples use independent PRNG draws in model version 1.
- Asumsi independensi antar bab/node dan eksekusi judge deterministik adalah ASSUMPTION, bukan kebenaran terukur.
- Distribusi fallback turunan harga bersifat MODELED_FROM_PRICING dan tidak pernah disajikan sebagai empiris/OBSERVED.
- Exchangeability adalah otoritas model, bukan kebenaran teramati; efek bab kuat dilaporkan sebagai diagnostik/sensitivitas, tidak pernah sebagai input pusat model.
- Probabilitas sel per-bab (diagnostik) tidak pernah menjadi input pusat model.
- Stratum penyedia/model kebijakan yang berbeda tidak pernah digabung.
## 6. Reliabilitas Kumulatif Terpetakan (Modeled Cumulative Reliability)
- modelVersion = `M10_E_CUMULATIVE_MODEL_V1 (iterasi 100000, seed `M10_E_CONTRACT_FIXTURE_SEED_V1`)`
- modelInputHash = `469ac46df96031e9ef6c302a9bbacd4f7ac4233f4813c338dd24628c8868be8b`
- modelOutputHash = `a0482ac9e955ef98ae71282064dee11a4c9345e4d696a85f341f74b41f85f69a`
- completionProbability = `0.371850000000 (MODELED)`
- terminalFailureProbability = `0.628150000000 (MODELED)`
- expectedRetryCount = `96.725880`
- expectedGenerationProviderCallCount = `158.904400`
- expectedJudgeProviderCallCount = `8.924400`
- expectedTotalProviderCallCount = `167.828800`
maxExpectedCostPerChapter = 2.04001674 (MODELED, PRESENT)
expectedGenerationCostPerSuccessfulNovelRun = 102.50000000 (MODELED; successful-run denominator 37185, PRESENT)
modeledJudgeTotal = 2.40000000 (MODELED, PRESENT)
- expectedGenerationSpendPerStartedNovelAttempt = `65.32040450 (MODELED diagnostic; started-attempt denominator 100000)`
- generationCostP50 = `102.50000000`
- generationCostP95 = `102.50000000`
- combinedTotalNovelCostP50 = `104.90000000`
- combinedTotalNovelCostP95 = `104.90000000`
- rincian mean per bab (1..50)
- bab 01: modeled mean 2.03899450 (denominator 100000); observed mean 1.77500000 (denominator 2)
- bab 02: modeled mean 2.03920193 (denominator 97999); observed mean 2.05000000 (denominator 1)
- bab 03: modeled mean 2.03934062 (denominator 96075); observed mean 2.05000000 (denominator 1)
- bab 04: modeled mean 2.03928757 (denominator 94213); observed mean 2.05000000 (denominator 1)
- bab 05: modeled mean 2.03923553 (denominator 92378); observed mean 2.05000000 (denominator 1)
- bab 06: modeled mean 2.03936679 (denominator 90570); observed mean 2.05000000 (denominator 1)
- bab 07: modeled mean 2.03880420 (denominator 88819); observed mean 2.05000000 (denominator 1)
- bab 08: modeled mean 2.03917838 (denominator 87011); observed mean 2.05000000 (denominator 1)
- bab 09: modeled mean 2.03917396 (denominator 85299); observed mean 2.05000000 (denominator 1)
- bab 10: modeled mean 2.03893028 (denominator 83620); observed mean 2.05000000 (denominator 1)
- bab 11: modeled mean 2.03927347 (denominator 81937); observed mean 2.05000000 (denominator 1)
- bab 12: modeled mean 2.03899165 (denominator 80339); observed mean 2.05000000 (denominator 1)
- bab 13: modeled mean 2.03916500 (denominator 78731); observed mean 2.05000000 (denominator 1)
- bab 14: modeled mean 2.03884037 (denominator 77180); observed mean 2.05000000 (denominator 1)
- bab 15: modeled mean 2.03919116 (denominator 75614); observed mean 2.05000000 (denominator 1)
- bab 16: modeled mean 2.03945675 (denominator 74128); observed mean 2.05000000 (denominator 1)
- bab 17: modeled mean 2.03953058 (denominator 72707); observed mean 2.05000000 (denominator 1)
- bab 18: modeled mean 2.03972842 (denominator 71323); observed mean 2.05000000 (denominator 1)
- bab 19: modeled mean 2.03887286 (denominator 69991); observed mean 2.05000000 (denominator 1)
- bab 20: modeled mean 2.03948524 (denominator 68575); observed mean 2.05000000 (denominator 1)
- bab 21: modeled mean 2.03904317 (denominator 67264); observed mean 2.05000000 (denominator 1)
- bab 22: modeled mean 2.03970481 (denominator 65924); observed mean 2.05000000 (denominator 1)
- bab 23: modeled mean 2.03921085 (denominator 64690); observed mean 2.05000000 (denominator 1)
- bab 24: modeled mean 2.03878684 (denominator 63421); observed mean 2.05000000 (denominator 1)
- bab 25: modeled mean 2.03887217 (denominator 62128); observed mean 2.05000000 (denominator 1)
- bab 26: modeled mean 2.03926582 (denominator 60871); observed mean 2.05000000 (denominator 1)
- bab 27: modeled mean 2.03899687 (denominator 59683); observed mean 2.05000000 (denominator 1)
- bab 28: modeled mean 2.03914839 (denominator 58489); observed mean 2.05000000 (denominator 1)
- bab 29: modeled mean 2.03937124 (denominator 57335); observed mean 2.05000000 (denominator 1)
- bab 30: modeled mean 2.03927917 (denominator 56227); observed mean 2.05000000 (denominator 1)
- bab 31: modeled mean 2.03942519 (denominator 55131); observed mean 2.05000000 (denominator 1)
- bab 32: modeled mean 2.03957389 (denominator 54071); observed mean 2.05000000 (denominator 1)
- bab 33: modeled mean 2.03915470 (denominator 53046); observed mean 2.05000000 (denominator 1)
- bab 34: modeled mean 2.03920096 (denominator 52000); observed mean 2.05000000 (denominator 1)
- bab 35: modeled mean 2.03900626 (denominator 50979); observed mean 2.05000000 (denominator 1)
- bab 36: modeled mean 2.03981685 (denominator 49960); observed mean 2.05000000 (denominator 1)
- bab 37: modeled mean 2.03926583 (denominator 49035); observed mean 2.05000000 (denominator 1)
- bab 38: modeled mean 2.03905217 (denominator 48078); observed mean 2.05000000 (denominator 1)
- bab 39: modeled mean 2.03923834 (denominator 47121); observed mean 2.05000000 (denominator 1)
- bab 40: modeled mean 2.03927358 (denominator 46199); observed mean 2.05000000 (denominator 1)
- bab 41: modeled mean 2.03938805 (denominator 45298); observed mean 2.05000000 (denominator 1)
- bab 42: modeled mean 2.03877071 (denominator 44424); observed mean 2.05000000 (denominator 1)
- bab 43: modeled mean 2.03947193 (denominator 43517); observed mean 2.05000000 (denominator 1)
- bab 44: modeled mean 2.03880260 (denominator 42684); observed mean 2.05000000 (denominator 1)
- bab 45: modeled mean 2.04001674 (denominator 41815); observed mean 2.05000000 (denominator 1)
- bab 46: modeled mean 2.03896142 (denominator 41056); observed mean 2.05000000 (denominator 1)
- bab 47: modeled mean 2.03941887 (denominator 40232); observed mean 2.05000000 (denominator 1)
- bab 48: modeled mean 2.03891860 (denominator 39458); observed mean 2.05000000 (denominator 1)
- bab 49: modeled mean 2.03923131 (denominator 38663); observed mean 2.05000000 (denominator 1)
- bab 50: modeled mean 2.03953860 (denominator 37906); observed mean 2.05000000 (denominator 1)
- Semua mean memakai penjumlahan koefisien eksak, pembagian skala antara 20, dan pembulatan HALF_UP ke skala 8; judge dikecualikan dari mean generasi.
- Hasil model bersifat MODELED dan tidak pernah menjadi kebenaran teramati.
## 7. Pita Sensitivitas (Sensitivity Bands)
- sensitivity.generationCost.p50 = `102.50000000`
- sensitivity.generationCost.p95 = `102.50000000`
- sensitivity.combinedTotalNovelCost.p50 = `104.90000000`
- sensitivity.combinedTotalNovelCost.p95 = `104.90000000`
- Pita lower/upper berbasis probabilitas asumsi tidak dapat dihasilkan oleh model V1: probabilitas pusat asumsi dilarang oleh kontrak (hanya OBSERVED).
- Band dilaporkan hanya sebagai rentang persentil model; bukan jaminan produksi, bukan korelasi terukur.
## 8. Gerbang Teknikal (Engineering Gate)
- engineeringGate = `PASS`
- releaseReadiness = `HOLD`
- reasonCodes = `(tidak ada)`
- CONTRACT_FIXTURE engineering PASS hanya membuktikan validitas kontrak/aritmetika/determinisme; tidak menyiratkan kesiapan rilis dan tidak menutup G2-BUDGET atau M10-E.
## 9. Status Anggaran E0 (E0 Budget Status)
- budgetGate = `BLOCKED_E0_COST_CEILING_NOT_APPROVED`
- Tidak ada otoritas E0 yang disetujui; klasifikasi blocked eksplisit. Persetujuan anggaran bisnis dibutuhkan sebelum evaluasi komparator.
- engineeringGate = PASS  // when earned
- budgetGate = BLOCKED_E0_COST_CEILING_NOT_APPROVED
- G2-BUDGET = OPEN
- M10-E = OPEN
## 10. Penghambat dan Celah (Blockers and Gaps)
- Tidak ada penahan gerbang teknikal yang dipicu.
- celah cakupan: FIRST_ATTEMPT_BASELINE_COST — P5 pricing selection required for modeled first-attempt baseline (included 0, excluded 0, eligible 0)
- celah cakupan: RETRY_FALLBACK_COST — P5 pricing selection required for modeled retry/fallback cost (included 0, excluded 0, eligible 0)
- celah cakupan: RETRY_OVERHEAD_PERCENTAGE — P5 modeled baseline and retry costs required (included 0, excluded 0, eligible 0)
- Observasi tak lengkap dikecualikan dari mean/maks/p95, tidak pernah menjadi nol, dan dilaporkan lewat hitungan included/excluded/eligible dan rasio cakupan.
## 11. Klaim yang Dilarang (Prohibited Claims)
- CONTRACT_FIXTURE membuktikan plumbing, aritmetika, determinisme, dan kebenaran kontrak engineering saja; ia tidak membuktikan ekonomi penyedia nyata tanpa RELEASE_EVIDENCE yang terotorisasi terpisah.
- Tidak boleh diklaim: insidens produksi, korelasi produksi, reliabilitas produksi, atau ekonomi produksi tanpa dukungan RELEASE_EVIDENCE terotorisasi.
- Exchangeability tidak boleh diklaim sebagai kebenaran teramati; independensi draw dan eksekusi judge deterministik adalah asumsi model.
- Probabilitas sel per-bab yang kuat bukan input model pusat; topologi kondisional V1 dan semua keluaran model adalah model, bukan ukuran produksi.
- Tidak ada klaim penutupan G2-BUDGET atau M10-E; keduanya tetap OPEN.
- Laporan ini tidak mengandung data pribadi pembaca, konten prosa, prompt/response model, URL privat, atau kredensial layanan.
---
Deterministik: konten laporan hanya berasal dari artifacts semantik tervalidasi; hash laporan = SHA-256 byte Markdown persis.
