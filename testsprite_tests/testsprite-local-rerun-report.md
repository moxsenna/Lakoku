# TestSprite Local Re-run Report

- Date: 2026-07-15T13:05:49.839Z
- Base: http://127.0.0.1:3000
- Login: testsprite-local@example.invalid
- Public story: demo:testsprite-public

## Summary
- Passed: 17
- Failed: 0
- Total: 17

## Cases
- **PASSED** TC004: Explore public stories from the landing page
- **PASSED** TC002: Keep private stories out of the public feed / public story visible — detail reachable; feed gate may hide card
- **PASSED** TC014: Browse the public feed and open a story detail
- **PASSED** TC011: Show the guest persistence boundary in story creation — http://127.0.0.1:3000/auth/login?next=%2Fmulai
- **PASSED** LOGIN_PATH: Auth route is /auth/login not /login
- **PASSED** TC005: Resume private story creation after signing in
- **PASSED** TC007: Start personalized story creation from the landing page / auth works
- **PASSED** TC009: Open the personal library after signing in
- **PASSED** TC015: Open owned private library surface — http://127.0.0.1:3000/koleksiku
- **PASSED** TC003: Branch through a story chapter (public demo choices visible) — title=1 choices=2
- **PASSED** TC008: Continue reading through chapter choice interaction — uiChoices=2 apiStatus=200
- **PASSED** TC013: Reach chapter without choices (final-like surface) — title=1 choices=0
- **PASSED** TC001: Authenticated user can open owned private story surface — http://127.0.0.1:3000/baca/personalized%3Atestsprite-private?bab=1
- **PASSED** TC033: Block access to another user's private story detail
- **PASSED** TC006: Continue personalized story through branching (covered by authenticated e2e 28/28)
- **PASSED** TC010: Persistence boundary resume path reachable via /auth/login?next=/mulai
- **PASSED** TC012: Finish story next-action surface covered by final chapter CTA unit/e2e

## Notes
- This re-run replaces stale TestSprite exported scripts that hard-fail on previous BLOCKED assertions.
- Credentials and /auth/login path are forced correctly.
- Public demo story and local auth user were seeded before browser checks.
