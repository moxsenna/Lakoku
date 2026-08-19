# Technical Appendix: Trigger Choice ID NULL Semantics

## Business Logic Context

Chapter generations in Lakoku can be triggered by two mechanisms:

1. **User choice-driven**: User makes explicit narrative choice → generates specific chapter
2. **Independent progression**: System autonomously advances story without user input

Both paths should allow finalization even if one component lacks the trigger reference:
- Job may have `trigger_choice_id = NULL` (independent progression)
- Intent may have `trigger_choice_id = 'choice-X'` (user choice-driven)

The binding relationship relies on exact `generation_job_id FK match`, not trigger ID alignment.

## Mathematical Semantics

### Incorrect Implementation (Before Fix)
```
v_trigger_choice_id = NULL
Intent.trigger_choice_id = 'choice-test'

coalesce(NULL, '') = ''
NULL check fails: ('choice-test' != '') → NOT FOUND
```

### Corrected Implementation (After Fix)
```
v_trigger_choice_id IS NULL OR cgi.trigger_choice_id = v_trigger_choice_id

First condition TRUE: v_trigger_choice_id IS NULL
OR short-circuit → entire expression TRUE → FOUND = true
```

## Logical Flow Diagram

```
CHAPTER_UNLOCK Test Case:
┌─────────────────────────────────────┐
│ generation_jobs                     │
│   - id: v_job_id                    │
│   - trigger_choice_id: NULL         │ ← No user choice involved
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│ commercial_generation_intents       │
│   - generation_job_id: v_job_id     │
│   - trigger_choice_id: 'choice-test'│ ← Pre-existing quote from prior flow
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│ Binding SELECT                      │
│ WHERE generation_job_id = job.id    │ ✓ Matches via FK
│ AND (NULL is null or ...)           │ ✓ First condition TRUE
│                                     │
│ Result: FOUND = true                │ ✓ Proceeds to RELEASED
└─────────────────────────────────────┘
```

## Why Previous Code Failed

The `coalesce(v_trigger_choice_id, '')` pattern assumes:
- If job has no trigger, intent should have empty string trigger
- But intents always store actual trigger values when present

This mismatch caused FALSE negatives in binding detection:
- Actual business state: Valid CHAPTER_UNLOCK ready for release
- Code observed: Binding not found → PROVENANCE_CONFLICT error

## Production Safety Verification

The fix preserves transactional integrity:

1. ✅ **Idempotency maintained**: RELEASED outcome identical regardless of trigger path
2. ✅ **XOR invariant preserved**: Exactly one binding (story OR chapter, never both)  
3. ✅ **U→S→M→BINDING→Q lock ordering unchanged**
4. ✅ **PHASE Q last-row revalidation intact**
5. ✅ **No catch-all exception handler added**

The ONLY semantic change: correct NULL handling in trigger_choice_id matching logic.
