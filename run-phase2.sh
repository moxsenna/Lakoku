#!/usr/bin/env bash
set -euo pipefail

# Canonical scoped Phase-2 execution orchestration
# Returns 0 FAIL / 0 SKIP across all shards

cd "$(dirname "$0")"

echo "=========================================="
echo "PHASE-2 CANONICAL GATE SUITE"
echo "=========================================="
echo ""

# Track overall status
OVERALL_STATUS=0

run_shard() {
    local name="$1"
    shift
    echo ">>> Running shard: $name <<<"
    echo "Command: pnpm exec vitest run --config vitest.config.ts $@"
    echo ""
    
    if ! pnpm exec vitest run --config vitest.config.ts "$@"; then
        echo ""
        echo "FAILED: $name"
        OVERALL_STATUS=1
    fi
    
    echo ""
    echo "=========================================="
    echo ""
}

# PHASE-2A: Cheap/normal reliability tests (fast validation, no full model runs)
echo "## PHASE-2A: CHEAP RELIABILITY TESTS ##"
pnpm exec vitest run --config vitest.config.ts \
    tests/narrative-qa/m10-e-reliability-artifacts.test.ts
if [ $? -ne 0 ]; then echo "FAILED: Phase2A-reliability-artifacts"; OVERALL_STATUS=1; fi

echo "## PHASE-2A-aggregation ##"
pnpm exec vitest run --config vitest.config.ts \
    tests/narrative-qa/m10-e-reliability-aggregation.test.ts
if [ $? -ne 0 ]; then echo "FAILED: Phase2A-aggregation"; OVERALL_STATUS=1; fi

echo "## PHASE-2A-model-validation ##"
pnpm exec vitest run --config vitest.config.ts \
    tests/narrative-qa/m10-e-reliability-model.test.ts
if [ $? -ne 0 ]; then echo "FAILED: Phase2A-model-validation"; OVERALL_STATUS=1; fi

# PHASE-2B: Expensive sensitivity/model tests (sequential, dedicated resources)
echo "## PHASE-2B: EXPENSIVE SENSITIVITY/MODEL TESTS ##"
pnpm exec vitest run --config vitest.config.ts \
    tests/narrative-qa/m10-e-reliability-model-determinism.test.ts \
    --maxWorkers=1 --testTimeout=600000
if [ $? -ne 0 ]; then echo "FAILED: Phase2B-model-determinism"; OVERALL_STATUS=1; fi

pnpm exec vitest run --config vitest.config.ts \
    tests/narrative-qa/m10-e-reliability-sensitivity.test.ts \
    --maxWorkers=1 --testTimeout=900000
if [ $? -ne 0 ]; then echo "FAILED: Phase2B-sensitivity"; OVERALL_STATUS=1; fi

pnpm exec vitest run --config vitest.config.ts \
    tests/narrative-qa/m10-e-reliability-pricing-fallback-provenance.test.ts \
    --maxWorkers=1 --testTimeout=900000
if [ $? -ne 0 ]; then echo "FAILED: Phase2B-pricing-provenance"; OVERALL_STATUS=1; fi

# PHASE-2C: Protected E1/E2 narrative regressions (manifest-bound)
echo "## PHASE-2C: PROTECTED E1/E2 NARRATIVE REGRESSIONS ##"
pnpm exec vitest run --config vitest.config.ts \
    tests/narrative-qa/m10-e-e1-e2-closure-regression.test.ts \
    --maxWorkers=1 --testTimeout=1800000
if [ $? -ne 0 ]; then echo "FAILED: Phase2C-E1-E2-closure"; OVERALL_STATUS=1; fi

# PHASE-2D: Governed DB regressions (both expectedFocusedTests from e1-e2-closure-authority.json)
echo "## PHASE-2D: GOVERNED DB REGRESSION #1 ##"
echo "Note: Requires LAKOKU_LOCAL_DB_TEST=1 env var + 'supabase_db_lakoku-m10-e2-task3' Docker container on port 57322"
if ! LAKOKU_LOCAL_DB_TEST=1 pnpm exec vitest run --config vitest.config.ts \
    tests/db/m10-e1-disposable-cleanup-auth-regression.test.ts 2>&1; then
    echo "FAILED: Phase2D-DB-e1-disposable-cleanup"; OVERALL_STATUS=1
fi

echo "## PHASE-2D: GOVERNED DB REGRESSION #2 ##"
pnpm exec vitest run --config vitest.config.ts \
    tests/db/m10-e2-task3-local-proof.test.ts
if [ $? -ne 0 ]; then echo "FAILED: Phase2D-DB-e2-task3-local-proof"; OVERALL_STATUS=1; fi

echo ""
echo "=========================================="
echo "PHASE-2 FINAL SUMMARY"
echo "=========================================="

if [ $OVERALL_STATUS -eq 0 ]; then
    echo "✅ PHASE-2 COMPLETE: 0 FAIL / 0 SKIP"
    exit 0
else
    echo "❌ PHASE-2 FAILED: Some shards failed"
    exit 1
fi
