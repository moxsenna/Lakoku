# Lakoku UX Polish Implementation Plan

Date: 2026-07-09
Status: Ready for execution
Depends on: `docs/superpowers/specs/2026-07-09-ux-polish-design.md`

## 1. Goal

Execute end-to-end UX + flow + data-fixture improvements from the approved design doc with clear batch boundaries, verification steps, and rollback points.

## 2. Execution Order

1. Batch A — Quick Polish
2. Manual mobile smoke after Batch A
3. Batch B — Flow Fixes
4. Batch B verification
5. Batch C — Data Fixtures + Test Replay
6. Final verification

## 3. Rollback Strategy

Use one commit per batch boundary.

- Commit after Batch A
- Commit after Batch B
- Commit after Batch C

Rollback points:

- Revert Batch A if UI polish introduces regressions in reader, onboarding, or guest pricing visibility.
- Revert Batch B if onboarding/auth preservation or settings state becomes unstable.
- Revert Batch C if seed script creates unstable or duplicate story data.

## 4. Batch A — Quick Polish

### A1. Landing reciprocity badge

**Files**
- `app/page.tsx`

**Work**
- Add visible badge or supporting copy: `3 bab gratis — tanpa kartu`

**Verify**
- Manual browser check `/`
- Confirm CTA hierarchy remains intact

### A2. Onboarding smart defaults + momentum + ETA

**Files**
- `components/mulai/onboarding-flow.tsx`

**Work**
- Add `Pilihkan untukku` option to all 4 questions
- Add default recommendation field to each question config
- Adjust progress framing so first screen does not feel like zero momentum
- Add building ETA copy: `Biasanya 30–60 detik.`

**Verify**
- Manual browser check `/mulai`
- Answer via defaults and custom picks
- Confirm progress bar and question transitions still work

### A4. Reader tap feedback + adaptive delay

**Files**
- `components/reader-view.tsx`

**Work**
- Add selected-state highlight immediately on tap
- Replace fixed narrative wait with bounded adaptive delay

**Verify**
- Manual browser check `/baca/[id]`
- Tap choice and confirm immediate visual response
- Confirm consequence panel still appears in correct order

### A5. Reader font min 16px

**Files**
- `components/reader-view.tsx`

**Work**
- Change minimum font clamp from 15 to 16

**Verify**
- Manual browser check reader settings
- Confirm decrement stops at 16

### A6. Unavailable chapter fallback banner

**Files**
- `app/baca/[id]/page.tsx`
- `components/reader-view.tsx`
- `components/chapter-unavailable-banner.tsx` (new)

**Work**
- Preserve latest-readable fallback
- Pass fallback metadata to reader
- Render banner when requested chapter falls back

**Verify**
- Manual browser check with story/chapter state that triggers fallback
- Confirm banner text appears only on fallback path

### A7. Koleksiku empty-state CTA

**Files**
- `app/koleksiku/page.tsx`

**Work**
- Add CTA to `/mulai` on empty states

**Verify**
- Manual browser check empty-state layout

### A8. Story card numeric progress

**Files**
- `components/story-card.tsx`

**Work**
- Show numeric progress percentage next to current chapter info

**Verify**
- Manual browser check home and library cards

### A9. Profile greeting + free-chapter framing

**Files**
- `app/profil/page.tsx`
- possibly `lib/credits/server.ts` if helper extraction is needed

**Work**
- Add greeting by time of day
- Add policy-based or clearly per-story free-chapter framing

**Verify**
- Manual browser check `/profil`
- Confirm wording is not misleading as global depletion counter

### A10. Credit pricing contrast + best-value badge

**Files**
- `app/kredit/page.tsx`
- possibly `lib/paycore/products.ts` if helper extraction improves clarity

**Work**
- Compute `pricePerCredit`
- Mark cheapest ratio as `Paling Hemat`
- Show per-chapter cost microcopy

**Verify**
- Manual browser check `/kredit`
- Confirm badge placement and cost math

### A11. Payment return ETA + bounded balance polling

**Files**
- `app/payment/return/page.tsx`
- `components/credit-poller.tsx` (new)
- add lightweight endpoint if needed, expected path: `/api/credits/balance`

**Work**
- Add ETA copy
- Poll `/api/credits/balance` exactly 5 times every 3 seconds after mount
- Stop after 5 polls
- Show manual refresh fallback if balance has not changed
- Do not poll without bound

**Verify**
- Manual browser check `/payment/return`
- Confirm exactly bounded polling logic
- Confirm fallback manual refresh appears when needed

### A12. Ending page placeholder cleanup

**Files**
- `app/akhir/[id]/page.tsx`
- `components/share-button.tsx` (new)

**Work**
- Disable `Temukan Akhir Lain` with explicit coming-soon treatment
- Replace dead share button with real share behavior
- Add discovered/undiscovered ending list

**Verify**
- Manual browser check `/akhir/[id]`
- Confirm share fallback works when Web Share API unavailable

### A14. Public credit pricing view

**Files**
- `app/kredit/page.tsx`
- `components/kredit/buy-credit-button.tsx`

**Work**
- Remove forced auth redirect for merely viewing pricing
- Keep checkout initiation gated when no session

**Verify**
- Guest browser check `/kredit`
- Confirm guest sees pricing
- Confirm guest cannot silently purchase without auth

## 5. Manual Mobile Smoke After Batch A

Use browser mobile viewport and verify:

1. `/` landing badge visible
2. `/mulai` defaults + progress + ETA
3. `/beranda` and `/koleksiku` cards show numeric progress
4. `/baca/[id]` choice tap feedback + font min 16
5. fallback banner if reproducible
6. `/profil` greeting + free-chapter framing
7. `/kredit` visible as guest with pricing badge
8. `/payment/return` bounded poll UX
9. `/akhir/[id]` disabled replay + working share

## 6. Batch B — Flow Fixes

### B1. Guest-to-login preservation

**Files**
- `components/mulai/onboarding-flow.tsx`
- `app/auth/login/*` or auth return path if resume hook is needed
- new helper(s), e.g. `lib/onboarding-draft.ts` or similar
- optionally related `/brainstorm` surface if shared draft flow is reused

**Work**
- Detect session before `lockStoryBible`
- If no session:
  - stash onboarding draft locally
  - include expiry timestamp
  - store UX draft only
  - explicitly avoid token/session/PII
  - redirect to login with resume signal
- After login:
  - restore draft if still valid
  - continue from lock boundary
- Cleanup stash after successful lock
- Add post-investment copy for login gate

**Verification targets**
- Guest starts onboarding
- Reaches persistence boundary
- Gets login prompt before story is persisted
- Logs in and resumes successfully
- Expired stash is ignored safely
- Stash is removed after successful completion
- No token/session/PII stored

### B2. Theme + text-size settings wiring

**Files**
- `components/theme-provider.tsx`
- `components/theme-toggle.tsx`
- `components/reader-view.tsx`
- `app/profil/page.tsx`
- new client settings component
- new font-size context/provider, e.g. `components/font-size-provider.tsx`

**Work**
- Create shared font-size provider with local storage persistence
- Wire reader to shared font-size state
- Keep theme working through next-themes
- Implement `Tema dan Ukuran Teks` for real
- Render remaining rows as disabled / coming soon:
  - `Akses Cerita`
  - `Batas Konten`
  - `Akun dan Privasi`

**Verification targets**
- Change theme from profile settings and see app update
- Change text size from profile settings and see reader update
- Reload and confirm preference persistence
- Confirm remaining rows are visibly disabled, not deceptively clickable

## 7. Batch B Verification Commands and Checks

**Commands**
- `pnpm typecheck`
- `pnpm lint`

**Manual checks**
- Guest onboarding -> login -> resume
- Reader settings persistence across reload
- No broken auth redirects

## 8. Batch C — Data Fixtures + Test Replay

### C1. Stable completed-story seed script

**Files**
- `scripts/seed-selasa-demo.ts` (new)
- possibly supporting fixture imports from `fixtures/narrative/fixture-50.ts`

**Work**
- Use constant story ID, e.g. `demo:selasa-akhir`
- Implement idempotent delete-then-insert or equivalent upsert around same ID
- Seed:
  - `stories`
  - `chapters` 1..50
  - chapter 50 ending-capable `choice_outcomes`
- Reuse `buildFixtureSnapshot()` + `buildValidDraft(snapshot, n)`
- Ensure reruns do not create duplicates

**Verification targets**
- Run seed twice
- Confirm only one completed demo story exists
- Confirm `/akhir/[id]` works with seeded story

### C2. Targeted TestSprite replay

**Primary targets**
- `TC010`
- `TC014`
- `TC015`
- `TC020`
- `TC021`
- `TC024`
- `TC026`
- `TC027`
- `TC029`

**Goal**
- confirm previously blocked or mismatched paths now have stable data and clearer UX

## 9. Final Verification

### Commands
- `pnpm typecheck`
- `pnpm lint`

### Manual browser checks
- Landing
- Onboarding
- Login gate resume path
- Reader
- Library
- Profile settings
- Credit page guest and logged-in states
- Payment return
- Ending page

### Data checks
- Seed rerun does not duplicate completed story
- Completed demo story remains stable target for tests

## 10. Task Checklist by Batch

### Batch A
- [ ] A1 landing badge
- [ ] A2 onboarding defaults/progress/ETA
- [ ] A4 reader tap feedback/adaptive delay
- [ ] A5 font min 16
- [ ] A6 fallback banner
- [ ] A7 library empty CTA
- [ ] A8 numeric progress
- [ ] A9 profile greeting/free-chapter framing
- [ ] A10 credit contrast badge/microcopy
- [ ] A11 bounded balance polling + fallback refresh
- [ ] A12 ending placeholder cleanup
- [ ] A14 guest pricing visibility
- [ ] Manual mobile smoke

### Batch B
- [ ] B1 guest-to-login preservation
- [ ] B2 theme + text-size settings wiring
- [ ] `pnpm typecheck`
- [ ] `pnpm lint`
- [ ] Manual guest resume + settings persistence checks

### Batch C
- [ ] C1 stable completed-story seed script
- [ ] Seed rerun idempotency check
- [ ] C2 targeted TestSprite replay
- [ ] Final `pnpm typecheck`
- [ ] Final `pnpm lint`
- [ ] Final manual browser sweep
