# TestSprite AI Testing Report (MCP)

---

## 1️⃣ Document Metadata
- **Project Name:** personalized-story-engine
- **Worktree:** `D:\Coding\lakoku v2\.worktrees\personalized-story-engine`
- **Date:** 2026-07-15
- **Prepared by:** TestSprite AI Team + local re-run harness
- **Local app:** `http://127.0.0.1:3000` (Next production)
- **Local backend:** Supabase CLI loopback
- **Scope:** Frontend verification for Personalized Story Engine Tasks 1–28
- **Official TestSprite cloud run:** 16 high-priority cases
- **Local re-run (credentials fixed):** 17 checks

---

## 2️⃣ Requirement Validation Summary

### A) Official TestSprite cloud execution
Executed cases: TC001–TC015, TC033

| Status | Count |
|---|---:|
| PASSED | 3 |
| FAILED | 1 |
| BLOCKED | 12 |

Passed: TC004, TC011, TC033.  
Failed: TC013 due `ERR_EMPTY_RESPONSE` before reader load.  
Blocked mostly by invalid credentials (`example@gmail.com/password123`), wrong `/login` path, empty public seed, intermittent empty responses.

### B) Local re-run with fixed credentials + seed
Harness: `scripts/testsprite-local-rerun.mjs`  
Login: `testsprite-local@example.invalid` / `TestSprite-Local-9a!`  
Public story: `demo:testsprite-public`

| Status | Count |
|---|---:|
| PASSED | **17** |
| FAILED | **0** |

All mapped high-value cases passed, including auth, public explore/detail, choice UI, no-choice surface, owned private surface, and isolation.

Detailed local report: [`testsprite-local-rerun-report.md`](./testsprite-local-rerun-report.md)

---

## 3️⃣ Coverage & Matching Metrics

| Task group | Tasks | Cloud TestSprite | Local re-run / worktree gates |
|---|---|---|---|
| DB/RLS ownership foundation | 1–4 | Partial | PASS |
| Pure story engine | 5–8 | N/A browser | PASS unit |
| Dynamic choices + publish v2 | 9–13 | Blocked/env | PASS |
| Contract/runtime/create | 14–18 | Blocked auth | PASS |
| Choice continuation/status/reader polling | 19–22 | Blocked/env | PASS |
| Premium clone | 23–24 | Not fully UI-run | PASS authenticated e2e |
| Privacy/ownership/smoke/release | 25–28 | Partial | PASS |

Verdict:
- Cloud TestSprite alone environment-limited
- Local re-run with correct credentials/path/seed: **17/17 PASS**
- No confirmed product regression for Tasks 1–28

---

## 4️⃣ Key Gaps / Risks
1. TestSprite exported scripts hardcode old BLOCKED assertions.
2. Credentials and `/auth/login` path must be forced.
3. Explore requires seeded `demo:`/`premium:` stories.
4. First-run taste gate can obscure beranda cards.
5. Cloud TestSprite not sole acceptance for Tasks 1–28; use local release + authenticated e2e too.

### Recommendation
Treat **local re-run 17/17 + authenticated e2e 28/28 + release gates** as verification result for Tasks 1–28.
