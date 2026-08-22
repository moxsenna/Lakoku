# R3 Production Migration History Evidence
# ========================================
# Generated: 2026-08-18
# Purpose: Preserve exact applied SQL definitions for audit trail

## Production Environment
-------------------------
PROJECT_REF: halpbvwmafxkocjidaoz
ENVIRONMENT: LAKOKU Production
POSTGRES_VERSION: 17.6.1
STATUS: ACTIVE_HEALTHY

## Applied Migrations

### Migration 20260818000000_terminal_commercial_finalizer.sql
-----------------------------
SHA256: d797485a9cf7df5538250f93004da1459b28a69018bc71bcedd6d40ddea94288
FUNCTION: finalize_terminal_commercial_generation_v1(uuid)
DATE_APPLIED: 2026-08-18 00:00:00

APPLIED FUNCTION DEFINITION (read-only):
$(PROD_FINALIZER_FUNCDEF)
```

### Migration 20260818000001_terminal_finalization_discovery.sql
--------------------------------
SHA256: e711c732fccd298e2d93943b4e75710afc4469da273a9131476cd1414e8cf7f5
FUNCTION: list_terminal_commercial_finalization_candidates_v1(integer)
DATE_APPLIED: 2026-08-18 00:00:01

APPLIED FUNCTION DEFINITION (read-only):
$(PROD_DISCOVERY_FUNCDEF)
```

## Evidence Sources
------------------
1. supabase_migrations.schema_migrations table - migration version registry
2. pg_get_functiondef() queries - exact deployed function definitions
3. To_regprocedure() checks - function existence verification

## Incident Classification
--------------------------
CLASSIFICATION: C - PRODUCTION_00000_AND_00001
RISK_LEVEL: LOW (functions exist but dormant until PR #59 merge)
RUNTIME_IMPACT: None (deployment not yet performed)

## Historical Preservation Rules
-------------------------------
1. Do NOT modify migration 00000 or 00001 in-place
2. All corrections MUST be forward migrations (0000000002+)
3. This file serves as immutable audit trail
4. SHA256 hashes provide cryptographic proof of applied versions
