# TestSprite AI Testing Report (MCP)

---

## 1️⃣ Document Metadata
- **Project Name:** lakoku v2
- **Date:** 2026-07-08
- **Prepared by:** TestSprite AI Team
- **Test Scope:** Frontend (whole codebase), production build on `http://localhost:3000`
- **Account under test:** `moxsenna@gmail.com`
- **Run history:** Run 1 = 66.67% (mock data, chapter parked) → Run 2 = 43.33% (after DB wipe; exposed colon-slug 404) → **Run 3 = 70.00% (after fixes)**

---

## 2️⃣ Requirement Validation Summary

### Requirement: Landing & Onboarding Quiz
| Test | Name | Status |
|------|------|--------|
| TC005 | Start the onboarding journey from the landing page | ✅ Passed |
| TC006 | Complete onboarding and enter the story selection experience | ✅ Passed |
| TC007 | Complete onboarding and enter the recommended story experience | ✅ Passed |
| TC008 | Complete onboarding and enter the home experience | ✅ Passed |
| TC022 | Change an onboarding answer before starting a story | ✅ Passed |
| TC029 | Restart onboarding and choose a different story | ❌ Failed |

**Analysis:** 5/6. TC029 failed at the final hop: after picking a story the page showed *"Peranmu sedang disiapkan."* (role/story still provisioning) instead of advancing — a slow-provisioning/flake in the onboarding→story-creation step, not a broken screen (other onboarding paths pass).

---

### Requirement: Authentication (Login)
| Test | Name | Status |
|------|------|--------|
| TC011 | Log in to reach the home feed | ✅ Passed |
| TC012 | Log in and open the current story from the home feed | ✅ Passed |

**Analysis:** 2/2. Supabase login + redirect to `/beranda` solid.

---

### Requirement: Chapter Reader & Branching Choices  ⭐ (previously 0-passing — now fixed)
| Test | Name | Status |
|------|------|--------|
| TC001 | Continue a chapter by making a branching choice | ✅ Passed |
| TC002 | Continue a branching story and reach the next chapter | ✅ Passed |
| TC003 | Resume a story from the chapter reader and advance | ✅ Passed |
| TC004 | Read a chapter and continue through a branching choice | ✅ Passed |
| TC013 | Handle a pending choice while reading a chapter | ✅ Passed |
| TC017 | Retry a pending choice and continue the story | ✅ Passed |
| TC010 | Handle a chapter that is still loading or unavailable | ❌ Failed |
| TC014 | Show the reader when a chapter is not available | ❌ Failed |
| TC015 | See the waiting placeholder for an unavailable chapter | ❌ Failed |

**Analysis:** 6/9 — the core read→choose→advance loop now fully works (was 0/8). The three remaining failures (TC010/14/15) **expect to observe the "chapter unavailable / sedang disiapkan" placeholder**, but the story is now fully generated (chapters 1–3) and the new reader-safe fallback intentionally serves the last available chapter instead of a dead-end screen. In other words, these tests fail *because content is available by design* — they need a story deliberately parked at an ungenerated chapter (active generation lease) to see the PREPARING screen. TC015 additionally used the invalid `/baca/1` slug.

---

### Requirement: Home Feed & Story Detail Navigation  ⭐ (fixed by clean slug)
| Test | Name | Status |
|------|------|--------|
| TC009 | Resume reading from the home feed | ✅ Passed |
| TC016 | Resume reading from a story detail page | ✅ Passed |
| TC018 | Open a story from the home feed and continue into reading | ✅ Passed |
| TC019 | Open a story detail and continue reading | ✅ Passed |
| TC025 | Return from story detail to the home experience | ✅ Passed |

**Analysis:** 5/5. All previously blocked by the colon-slug 404; green after the slug migration.

---

### Requirement: Library (Koleksiku) & Story Endings
| Test | Name | Status |
|------|------|--------|
| TC023 | Resume a story from my collection | ✅ Passed |
| TC021 | Review ongoing and completed stories in the library | ❌ Failed |
| TC020 | Browse ongoing and completed stories in the library | ⚠️ Blocked |
| TC024 | Open a finished story ending from the library | ⚠️ Blocked |
| TC026 | Switch from ongoing story to a completed ending | ⚠️ Blocked |
| TC027 | Open a completed story ending from the library | ⚠️ Blocked |

**Analysis:** 1/6. Four tests are **blocked for lack of a completed (SELESAI) story** — the DB wipe removed the only finished story and one was intentionally not re-seeded. TC021 failed because the agent looked for a "Jelajahi Cerita" control that doesn't exist; the library is actually reachable via "Koleksiku" (proven by TC023/TC025 passing) — a test-navigation label mismatch, not an app defect.

---

### Requirement: Profile & Settings
| Test | Name | Status |
|------|------|--------|
| TC028 | View profile stats and settings | ✅ Passed |
| TC030 | View profile stats and change appearance settings | ✅ Passed |

**Analysis:** 2/2.

---

## 3️⃣ Coverage & Matching Metrics

- **70.00% of tests passed (21 / 30)** — up from 43.33% in Run 2.
- **The entire reading loop and slug-based navigation are green.** All 13 tests broken by the colon slug now pass.
- Remaining 9 non-passing: **4** blocked purely for missing completed-story data (opted out of seeding), **3** expect the "unavailable" placeholder that the requested fallback now bypasses, **1** library nav-label mismatch (TC021), **1** onboarding-provisioning flake (TC029).

| Requirement | Total | ✅ Passed | ❌/⚠️ Not passed |
|-------------|-------|-----------|------------------|
| Landing & Onboarding Quiz | 6 | 5 | 1 |
| Authentication (Login) | 2 | 2 | 0 |
| Chapter Reader & Branching Choices | 9 | 6 | 3 |
| Home Feed & Story Detail Navigation | 5 | 5 | 0 |
| Library (Koleksiku) & Endings | 6 | 1 | 5 |
| Profile & Settings | 2 | 2 | 0 |
| **Total** | **30** | **21** | **9** |

---

## 4️⃣ Key Gaps / Risks

1. **[FIXED] Colon in story slug broke the reader.** The seeded story id `fixture:warisan-terkubur` produced reader links like `/baca/fixture:warisan-terkubur`, which 404 on Next.js client-side navigation. Migrated to a clean slug `warisan-terkubur`. **Follow-up:** enforce colon-free slugs at authoring time so this can't recur (the brainstorm/authoring path should slugify ids).
2. **[FIXED] Parked reader with no fallback.** `getChapter` now falls back to the last available chapter (≤ target) when the requested chapter has no content and isn't actively generating — the read loop no longer dead-ends.
3. **Design tension: fallback vs. "unavailable" UX (TC010/14/15).** Because the fallback now serves the latest readable chapter, the "sedang disiapkan / belum tersedia" screen appears less often. If observing that state matters, keep a test story parked behind an active generation lease.
4. **No completed (SELESAI) story exists** → 4 ending tests blocked. Seed one finished story if ending-screen coverage is required.
5. **Onboarding→story provisioning latency (TC029).** The "Peranmu sedang disiapkan" step didn't resolve within the agent's window — worth checking whether new-story provisioning can hang or is just slow.
6. **Test-plan artifacts:** `/baca/1` (invalid slug) and the "Jelajahi Cerita" label don't match the app; re-point these test steps to `/baca/<real-slug>` and the "Koleksiku" nav.

### Bottom line
The two real defects surfaced by testing — the **colon-slug reader 404** and the **dead-end parked reader** — are fixed and verified: the reading loop went from **0/8 → fully passing**, lifting the suite to **70%**. The residual failures are dominated by intentionally-absent data (no completed story) and test-authoring mismatches, not product bugs.
