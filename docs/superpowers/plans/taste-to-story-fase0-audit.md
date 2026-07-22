# Taste → Story — Fase 0 audit (coverage gaps)

**Worktree:** `.worktrees/feat-taste-to-story`  
**Date:** 2026-07-22  
**Scope:** tests + minimal pure helpers only. No V2 schema rewrite.

## File map

| Area | Path | Notes |
|------|------|--------|
| Onboarding UI | `components/onboarding/taste-profile-flow.tsx` | 5-step flow; skip CTA last step |
| Skip/save pure helper | `lib/taste-profile/build-from-steps.ts` | Extracted from component `buildProfile` |
| Options builder | `lib/taste-profile/options.ts` | Sequential `buildOptionsFromGenres` (Bug 1); balanced helper exists |
| Schema | `lib/taste-profile/schema.ts` | V2 canonical; V1 legacy + migrate |
| Brainstorm stages | `lib/authoring/brainstorm.ts` | proposeCast/Mystery/World — no direction arg |
| Direction stub | `lib/authoring/creative-direction.ts` | Fase 0 contract surface for Bug 4 |
| Plan | `docs/superpowers/plans/lakoku-onboarding-taste-to-story-plan.md` | Source of bugs 1–4 |

## Bugs locked by tests

### Bug 1 — multi-genre options sequential

- **Symptom:** first genre fills all 6 slots; secondary ignored.
- **Code:** `buildOptionsFromGenres` sequential; UI still uses it.
- **Balanced helper:** `buildBalancedOptionsFromGenres` implemented + tested (passes).
- **Gap:** UI not switched; no try/catch swallow in tests (left as-is).

### Bug 3 — skip wipes partial answers

- **Symptom:** last-step "Lewati dulu" calls skip path → empty profile, drops genres/tropes.
- **Intro skip OK:** empty + `skippedAt` ("Nanti saja").
- **Desired:** `skip_with_partial` keeps answers.
- **Tests:** `tests/taste-profile/build-from-steps.test.ts` (DESIRED cases fail until fixed).
- **Helper:** `buildTasteProfileFromSteps` mirrors current wipe.

### Bug 4 — direction stops after premise

- **Symptom:** cast/mystery/world never receive creative direction.
- **Code:** `proposeCast(premise, feedback?, previous?)` etc. — no direction param.
- **Tests:** `tests/authoring/direction-propagation.test.ts` expects `authoringStageAcceptsDirection(*) === true` (fails on stub).
- **Stub:** `lib/authoring/creative-direction.ts`.

## Explicit non-goals (this commit)

- No V2 schema implementation changes.
- No wiring balanced options into UI.
- No proposeCast/Mystery/World signature changes beyond stub surface.
- No production fix for skip wipe (tests document desired).
