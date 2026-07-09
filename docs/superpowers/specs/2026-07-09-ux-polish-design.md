# Lakoku UX Polish Design

Date: 2026-07-09
Status: Draft for review
Scope: End-to-end UX + flow + data fixtures improvements based on TestSprite run, code review, and UX psychology references

## 1. Context

Lakoku v2 is a mobile-first Next.js App Router reader for interactive Indonesian drama fiction. Current app surface includes:

- Landing page at `/`
- Guided onboarding at `/mulai`
- AI-assisted full authoring at `/brainstorm`
- Reader at `/baca/[id]`
- Story detail at `/cerita/[id]`
- Ending view at `/akhir/[id]`
- Home, library, profile, credit purchase, and payment return flows

TestSprite report at `testsprite_tests/testsprite-mcp-test-report.md` shows Run 3 = 70.00% pass (21/30). Core reading loop and auth are solid. Remaining UX and flow issues split across placeholder UI, guest-to-login preservation, incomplete settings wiring, and lack of a stable completed-story fixture.

This document captures:

- audited findings
- decisions and trade-offs
- scope split into Batch A, B, and C
- deferred and moved items
- verification strategy

Implementation details, file targets, rollback points, and ordered execution belong in a separate implementation plan document.

## 2. Inputs and Sources

Primary sources used:

- TestSprite report: `testsprite_tests/testsprite-mcp-test-report.md`
- Product and architecture docs:
  - `docs/PRD_Lakoku_Interactive_v0.3.md`
  - `docs/ARCHITECTURE_v1.1.md`
  - `docs/IMPLEMENTATION_PLAN.md`
  - `docs/NARRATIVE_CONSISTENCY_SPEC.md`
  - `docs/NARRATIVE_TRACEABILITY_MATRIX.md`
  - `AGENT_RULES.md`
- Key UI and flow files:
  - `app/page.tsx`
  - `components/mulai/onboarding-flow.tsx`
  - `app/auth/*`
  - `app/beranda/page.tsx`
  - `components/reader-view.tsx`
  - `app/koleksiku/page.tsx`
  - `components/story-card.tsx`
  - `app/profil/page.tsx`
  - `app/kredit/page.tsx`
  - `app/payment/return/page.tsx`
  - `app/akhir/[id]/page.tsx`
- Auth/session and persistence files:
  - `lib/supabase/proxy.ts`
  - `lib/api/user-state.ts`
  - `app/brainstorm/actions.ts`
  - `lib/authoring/persist.ts`
- Data and fixture files:
  - `lib/api/queries.ts`
  - `fixtures/narrative/fixture-50.ts`
  - `scripts/seed-canon.ts`
  - `lib/runtime/story-generation.ts`

## 3. Findings Summary

### 3.1 Verified strengths

- Core read -> choose -> consequence -> next chapter loop works and recovered from prior slug issue.
- Login flow is stable.
- Reader has strong emotional framing, idempotent choice handling, and pending-choice recovery.
- UI follows brand guard well and does not leak AI implementation language.
- Credit policy, product catalog, and payment return structure are already in place.

### 3.2 Main issues to fix

1. Landing does not surface the strongest reciprocity hook: first 3 chapters are free.
2. Onboarding quiz lacks smart defaults and stronger momentum framing.
3. Reader choice tap has no immediate selected-state feedback.
4. Reader font floor is slightly low for mobile readability.
5. Fallback from unavailable chapter is better than dead-end, but currently lacks explicit UX messaging.
6. Library empty states do not guide the next action.
7. Story cards compute progress percentage but do not show it.
8. Profile greeting and free-chapter information are underused.
9. Credit page hides pricing behind auth and lacks pricing contrast cues.
10. Payment return lacks credit-refresh reassurance.
11. Ending page contains non-functional buttons and lacks replay/share clarity.
12. Guest users can persist story setup before login, but ownership is not preserved; generated stories become orphaned.
13. Profile settings rows are placeholders; only theme toggle exists separately in the header.
14. No stable completed-story demo fixture exists, blocking ending-flow verification and some TestSprite coverage.

## 4. Deferred / Moved Items

Stable IDs are preserved for traceability to the original audit.

### 4.1 Moved items

- **A3** moved to **B1**
  - Original concern: onboarding post-invest auth wall behavior
  - Final classification: flow and auth preservation issue, not quick polish
- **A13** moved to **B1**
  - Original concern: auth copy after user investment
  - Final classification: belongs to login gate design and post-invest conversion behavior

### 4.2 Why these moved

Both items depend on the same architectural decision:

- where guest users are stopped before irreversible persistence
- how draft state is preserved across login
- what copy appears at that transition

That makes them part of the guest-to-login preservation design rather than client-only polish.

## 5. Design Goals

1. Improve perceived clarity and momentum without destabilizing working flows.
2. Preserve user investment before auth.
3. Remove placeholder traps from the visible MVP.
4. Add stable fixture coverage for ending-state and completed-story flows.
5. Keep the first pass low-risk by front-loading client-only polish.
6. Maintain clear rollback boundaries by batch.

## 6. Batch Strategy

Recommended workstream order:

1. **Batch A**: quick polish, client-heavy, low-risk
2. **Manual smoke on mobile viewport after Batch A**
3. **Batch B**: flow fixes and settings wiring
4. **Batch C**: completed-story fixture and targeted verification
5. **Final manual and automated verification**

Rationale:

- Batch A improves many visible pain points without touching auth or DB semantics.
- Batch B contains the highest design risk and should land after visible polish is stabilized.
- Batch C depends on design decisions from A and B and exists mainly to verify endgame paths and replayable testing.

## 7. Batch A — Quick Polish

Batch A contains **12 deliverables** with stable IDs:

- A1
- A2
- A4
- A5
- A6
- A7
- A8
- A9
- A10
- A11
- A12
- A14

These are intentionally scoped to avoid backend ownership, RLS, or schema changes.

### A1. Landing reciprocity badge

**Files:** `app/page.tsx`

Add a high-visibility badge or supporting line that surfaces the strongest immediate product value:

- "3 bab gratis — tanpa kartu"

Reason:

- aligns with reciprocity principle
- uses existing policy (`lib/credits/policy.ts` defaults to 3 free chapters)
- reduces friction before signup

Decision:

- use a simple static value in first pass
- document future enhancement to source it dynamically from server policy if pricing becomes more fluid

### A2. Onboarding smart defaults, momentum, and ETA

**Files:** `components/mulai/onboarding-flow.tsx`

Changes:

- add a new option `Pilihkan untukku` to each quiz step
- define explicit default recommendation per question in the question config
- adjust progress framing so the user does not feel they are starting from zero
- add ETA text on the building screen: "Biasanya 30–60 detik."

Reason:

- reduces decision fatigue
- increases completion momentum
- improves trust while provisioning is in progress

Decision:

- defaults are curated, not behavioral/personalized
- no server dependence in first pass

### A4. Reader choice tap feedback and adaptive transition delay

**Files:** `components/reader-view.tsx`

Changes:

- show selected-state highlight immediately when a choice is tapped
- replace current fully fixed narrative delay with a bounded adaptive delay

Reason:

- current flow waits without acknowledging the specific tapped choice
- adaptive delay keeps narrative feel without always forcing the same wait time

Decision:

- preserve narrative pause
- reduce unnecessary waiting on fast responses

### A5. Reader font minimum to 16px

**Files:** `components/reader-view.tsx`

Change lower clamp from 15 to 16.

Reason:

- improves mobile readability
- safer floor for longer reading sessions

### A6. Fallback banner for unavailable target chapter

**Files:** `app/baca/[id]/page.tsx`, `components/reader-view.tsx`, new banner component

Change:

- keep existing fallback to latest readable chapter
- add explicit banner when fallback happened

Example message:

- "Bab 4 sedang disiapkan. Kamu dibawa ke bab terakhir yang sudah tersedia."

Reason:

- current behavior is reader-friendly but silent
- silent fallback can confuse users and testers

Decision:

- preserve fallback strategy
- explain it visibly instead of restoring a dead-end screen

### A7. Library empty-state next step

**Files:** `app/koleksiku/page.tsx`

Add a CTA to `/mulai` in empty states.

Reason:

- current empty states are informative but passive
- users need a direct next action

### A8. Numeric story progress on cards

**Files:** `components/story-card.tsx`

Show the already computed percentage alongside chapter progress.

Reason:

- progress bar alone is less precise
- percentage supports goal-gradient effect

### A9. Profile greeting and free-chapter framing

**Files:** `app/profil/page.tsx`

Changes:

- use time-of-day greeting
- show a lightweight framing for free access, such as free-chapter availability or progress to paid chapters

Reason:

- profile currently works structurally but lacks warmth and product-state framing

Decision:

- keep this server-side where possible
- avoid misleading global counters; any "free chapters left" text must be clearly per-story or policy-based, not a fake account-wide depletion meter

### A10. Credit page contrast and recommendation cue

**Files:** `app/kredit/page.tsx`

Changes:

- compute and surface a `Paling Hemat` badge based on price-per-credit
- add microcopy for estimated per-chapter cost

Reason:

- users compare relative pricing, not absolute pricing in isolation
- current page has product structure but not enough framing to support decision clarity

Decision:

- compute best value at render time
- no schema change required

### A11. Payment return reassurance and balance refresh

**Files:** `app/payment/return/page.tsx`, likely new small client component

Changes:

- add ETA copy such as "Biasanya <30 detik"
- poll `/api/credits/balance` exactly 5 times every 3 seconds after component mount, then stop
- show a manual refresh fallback if saldo has not changed after the 5 polls
- no unbounded polling

Reason:

- reduces anxiety when webhook confirmation is not immediate

Decision:

- bounded polling only: 5 polls × 3 seconds = 15 seconds total window
- unbounded polling is explicitly disallowed
- endpoint must be a lightweight balance read; create it if it does not exist

### A12. Ending page placeholder cleanup

**Files:** `app/akhir/[id]/page.tsx`, new `ShareButton` client component

Changes:

- disable `Temukan Akhir Lain` with explicit coming-soon state for MVP
- replace dead `Bagikan` button with real share behavior using `navigator.share` plus clipboard fallback
- add a lightweight ending-list section that shows discovered vs undiscovered ending labels

Reason:

- dead buttons damage trust
- ending page is emotional payoff and should not contain obvious placeholders

Decision:

- replay capability is explicitly deferred
- share is small and valuable enough to implement now

### A14. Public pricing view for credit page

**Files:** `app/kredit/page.tsx`, `components/kredit/buy-credit-button.tsx`

Change:

- remove current forced redirect for unauthenticated users just to view pricing
- keep purchase itself gated when needed

Reason:

- users should be able to inspect pricing before committing to login
- aligns with reciprocity and contrast principles

Decision:

- pricing stays public
- checkout initiation can redirect to login when no session is present

## 8. Batch B — Flow Fixes

Batch B contains two non-trivial deliverables.

### B1. Guest-to-login preservation using draft stash + login gate at `lockStoryBible`

**Files involved:**

- `components/mulai/onboarding-flow.tsx`
- `app/brainstorm/actions.ts`
- auth flow routes
- likely one or more small helper utilities for draft stash management

#### Problem

Current exploration confirmed:

- guests can reach onboarding and brainstorm
- `lockStoryBible` persists real story data using admin client
- no user ownership is attached at this point
- after redirect to `/baca/...`, middleware forces login
- persisted story becomes effectively orphaned for the logged-in user

#### Options considered

**Option 1: force login at quiz start**
- low implementation complexity
- kills investment and weakens IKEA effect
- rejected

**Option 2: anonymous auth before persist**
- strong UX continuity
- pulls in auth/session/RLS/schema complexity
- ownership semantics are not currently defined well enough
- rejected for MVP pass

**Option 3: draft stash + login gate at persist boundary**
- preserves user investment
- smallest auth risk
- does not require anonymous auth or schema reshaping now
- selected

#### Selected design

Before `lockStoryBible` runs:

- detect whether a real session exists
- if not, do **not** persist yet
- stash onboarding draft state locally
- redirect user to login with a resume signal
- after login, restore draft and continue from the lock boundary

#### Stash requirements

The stash must:

- have an explicit expiry timestamp
- be cleaned up after successful lock and story creation
- store only UX draft payloads
- **must not** store token, session, password, or any PII

Allowed stash content:

- selected premise
- proposed cast draft
- proposed mystery draft
- proposed world draft
- minimal onboarding answers needed to resume

Not allowed:

- access tokens
- refresh tokens
- Supabase session blobs
- email address
- password

Reason:

- enough to resume user investment
- no sensitive auth material

#### Copy implications

Stable IDs A3 and A13 are resolved here.

At the login gate, use post-investment framing such as:

- "Masuk untuk menyimpan ceritamu"
- "Cerita ini siap dikunci ke akunmu"

This copy belongs to B1, not Batch A.

### B2. Theme + text-size settings wiring, with explicit MVP lock

**Files involved:**

- `components/theme-provider.tsx`
- `components/theme-toggle.tsx`
- `components/reader-view.tsx`
- profile settings UI
- new font-size provider/context

#### Problem

Profile has four settings rows, but they are placeholders. Current real behavior:

- theme toggle exists separately in the profile header
- reader font size lives only in local component state
- no shared text-size preference exists

#### Decision

This spec locks the MVP behavior with no ambiguity:

- **Implement `Tema dan Ukuran Teks` for real**
- **Leave the other three rows disabled / coming-soon for MVP**

No `ATAU` behavior. No branching ambiguity.

#### Selected design

Implement:

- a `FontSizeProvider` backed by local storage
- shared access in reader and profile settings surface
- profile row opens or renders controls for theme and font size
- existing header `ThemeToggle` can remain, but theme control in settings must also work

For MVP, leave disabled with explicit visual treatment:

- `Akses Cerita`
- `Batas Konten`
- `Akun dan Privasi`

Reason:

- avoids pretending unfinished account and content-preference flows are ready
- still delivers one real user-facing preference group now

## 9. Batch C — Data Fixtures and Verification

### C1. Stable completed-story seed

**Files:** new script under `scripts/`, likely reusing fixture helpers

#### Goal

Create one stable completed-story demo fixture for ending-flow verification and TestSprite replay.

#### Data design

- use a constant story ID, for example `demo:selasa-akhir`
- seed `stories` with `status = 'SELESAI'`, `current_chapter = 50`, `ending_name`, and non-empty `jejak`
- seed chapter rows 1..50
- seed ending-capable outcome rows for chapter 50

#### Content source

Reuse:

- `buildFixtureSnapshot()`
- `buildValidDraft(snapshot, n)` from `fixtures/narrative/fixture-50.ts`

#### Idempotency requirement

This is mandatory:

- **seed ulang must not create duplicate rows**
- rerun behavior is **delete-then-insert** or equivalent upsert around the same constant story ID
- the stable story ID is part of the contract for replayable testing

Reason:

- TestSprite needs predictable paths
- duplicate finished stories create noise and unstable navigation targets

### C2. Verification scope

After Batch C:

- rerun targeted TestSprite cases that depend on completed-story or unavailable-chapter flows
- run manual mobile checks for ending surface
- keep final local checks lightweight but explicit

Targeted focus includes:

- unavailable/preparing chapter UX
- library completed-story paths
- ending page behavior
- onboarding continuation behavior after login

## 10. Verification Strategy

### After Batch A

Run manual mobile smoke immediately.

Do not wait for Batch C.

Minimum flow:

- landing
- onboarding quiz
- home
- reader tap feedback
- fallback banner case if available
- credit pricing view as guest
- profile settings visibility
- payment return messaging
- ending page button states

### After Batch B

Validate:

- guest user gets stopped before `lockStoryBible`
- stash survives login handoff
- stash expires correctly when stale
- stash is cleaned after success
- no token/session/PII is stored
- theme and font-size settings affect reader consistently

### After Batch C

Validate:

- completed-story seed can be rerun safely
- no duplicate completed demo stories appear
- ending route works predictably
- targeted TestSprite coverage improves or stabilizes

## 11. Risks and Mitigations

### Risk 1: silent auth complexity creep in B1

Mitigation:

- reject anonymous auth for this phase
- use local draft stash only
- gate at persist boundary, not earlier

### Risk 2: misleading free-chapter messaging

Mitigation:

- keep wording policy-based or clearly per-story
- avoid fake account-wide depletion counters

### Risk 3: fixture duplication and unstable testing

Mitigation:

- constant demo story ID
- delete-then-insert or strict upsert semantics
- document idempotency as a hard requirement

### Risk 4: half-real settings surface

Mitigation:

- implement only theme + text size
- explicitly disable the remaining rows for MVP

## 12. Out of Scope for This Pass

The following are intentionally not implemented in this pass:

- full replay / restart / fork behavior for `Temukan Akhir Lain`
- anonymous-auth ownership model for onboarding persistence
- full account/privacy management flows
- full content-boundary preference persistence
- fully dynamic credit policy sourcing on landing badge

## 13. Success Criteria

This design is successful when:

1. Batch A visibly improves friction and trust without backend risk.
2. Guests no longer orphan stories during onboarding persistence.
3. Theme and text-size settings become real, while unfinished rows are honestly disabled.
4. A stable completed-story fixture exists and can be reseeded without duplicates.
5. Manual mobile smoke is built into the sequence after Batch A.
6. TestSprite replay can target previously blocked flows with stable data.

## 14. Next Document

After this spec is reviewed, the next artifact is:

- `docs/superpowers/plans/2026-07-09-ux-polish-plan.md`

That plan will contain:

- exact file targets
- test targets
- batch order
- rollback points
- implementation sequencing
