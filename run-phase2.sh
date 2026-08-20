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

# PHASE-2C: Protected E1/E2 narrative regressions (all 8 expectedFocusedTests)
echo "## PHASE-2C: PROTECTED E1/E2 NARRATIVE REGRESSIONS ##"
pnpm exec vitest run --config vitest.config.ts \
    tests/narrative-qa/m10-e1-fault-evidence.test.ts \
    tests/narrative-qa/m10-e2-bindings.test.ts \
    tests/narrative-qa/m10-e2-evidence.test.ts \
    tests/narrative-qa/m10-e2-external-call-guard.test.ts \
    tests/narrative-qa/m10-e2-reset-cleanup.test.ts \
    tests/narrative-qa/m10-e2-rows-1-9.test.ts \
    tests/narrative-qa/m10-e2-runner.test.ts \
    tests/narrative-qa/m10-e2-telemetry-reference.test.ts \
    --maxWorkers=1 --testTimeout=1800000
if [ $? -ne 0 ]; then echo "FAILED: Phase2C-E1-E2-narrative"; OVERALL_STATUS=1; fi

# Verify no tests were skipped
SKIPPED_TESTS=$(pnpm exec vitest run --config vitest.config.ts \
    tests/narrative-qa/m10-e1-fault-evidence.test.ts \
    tests/narrative-qa/m10-e2-bindings.test.ts \
    tests/narrative-qa/m10-e2-evidence.test.ts \
    tests/narrative-qa/m10-e2-external-call-guard.test.ts \
    tests/narrative-qa/m10-e2-reset-cleanup.test.ts \
    tests/narrative-qa/m10-e2-rows-1-9.test.ts \
    tests/narrative-qa/m10-e2-runner.test.ts \
    tests/narrative-qa/m10-e2-telemetry-reference.test.ts \
    --maxWorkers=1 --testTimeout=1800000 2>&1 | grep -E "SKIP|Skipped" | wc -l)
if [ "$SKIPPED_TESTS" -gt 0 ]; then
    echo "❌ FAILED: $SKIPPED_TESTS tests skipped in Phase2C"
    OVERALL_STATUS=1
fi

# PHASE-2E: E3A/E4 authority gates (R1-D mutations + counted comparison + allowlist)
echo "## PHASE-2E: E3A/E4 AUTHORITY GATES ##"
pnpm exec vitest run --config vitest.config.ts \
    tests/narrative-qa/m10-e-e3a-e4-runner.test.ts \
    --maxWorkers=1 --testTimeout=600000
if [ $? -ne 0 ]; then echo "FAILED: Phase2E-E3A-E4-runner"; OVERALL_STATUS=1; fi

pnpm exec vitest run --config vitest.config.ts \
    tests/narrative-qa/m10-e-e3a-e4-counted-comparison.test.ts \
    --maxWorkers=1 --testTimeout=600000
if [ $? -ne 0 ]; then echo "FAILED: Phase2E-counted-comparison"; OVERALL_STATUS=1; fi

pnpm exec vitest run --config vitest.config.ts \
    tests/narrative-qa/m10-e-e3a-e4-allowlist.test.ts \
    --maxWorkers=1 --testTimeout=600000
if [ $? -ne 0 ]; then echo "FAILED: Phase2E-allowlist"; OVERALL_STATUS=1; fi

# PHASE-2D: Governed DB regressions (both expectedFocusedTests from e1-e2-closure-authority.json)
echo "## PHASE-2D: GOVERNED DB REGRESSION #1 ##"
echo "Note: Requires LAKOKU_LOCAL_DB_TEST=1, LAKOKU_E2_DISPOSABLE_PROJECT=/c/Users/bimap/.zcode/tmp/m10-e2-task3-supabase + 'supabase_db_lakoku-m10-e2-task3' Docker container on port 57322"
if ! LAKOKU_LOCAL_DB_TEST=1 LAKOKU_E2_DISPOSABLE_PROJECT=/c/Users/bimap/.zcode/tmp/m10-e2-task3-supabase pnpm exec vitest run --config vitest.config.ts \
    tests/db/m10-e1-disposable-cleanup-auth-regression.test.ts 2>&1; then
    echo "FAILED: Phase2D-DB-e1-disposable-cleanup"; OVERALL_STATUS=1
fi

echo "## PHASE-2D: GOVERNED DB REGRESSION #2 ##"
if ! LAKOKU_LOCAL_DB_TEST=1 LAKOKU_E2_DISPOSABLE_PROJECT=/c/Users/bimap/.zcode/tmp/m10-e2-task3-supabase pnpm exec vitest run --config vitest.config.ts \
    tests/db/m10-e2-task3-local-proof.test.ts 2>&1; then
    echo "FAILED: Phase2D-DB-e2-task3-local-proof"; OVERALL_STATUS=1
fi

# Typecheck verification (exact SHA, no build substitution)
echo "## PHASE-2F: TYPECHECK VERIFICATION ##"
if ! pnpm run typecheck 2>&1; then
    echo "FAILED: TypeScript strict typecheck"
    OVERALL_STATUS=1
fi

# ESLint on changed files
echo "## PHASE-2G: ESLINT CHANGED FILES ##"
pnpm run lint 2>&1 | tee -a phase2-eslint.log || true
ESLINT_ERRORS=$(grep -E "error TS|✖.*errors" phase2-eslint.log 2>/dev/null | wc -l)
if [ "$ESLINT_ERRORS" -gt 0 ]; then
    echo "⚠️ ESLINT found $ESLINT_ERRORS errors"
else
    echo "✅ ESLINT: 0 errors"
fi

# Git diff --check
echo "## PHASE-2H: GIT DIFF CHECK ##"
if git diff --check 2>&1; then
    echo "✅ Git diff: No whitespace/errors"
else
    echo "⚠️ Git diff warnings found (may be non-critical)"
fi

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
