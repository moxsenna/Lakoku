## Plan: Update `/docs` untuk mencerminkan kondisi repo per 10 Juli 2026

### 1. Update `docs/PROGRESS_CHECKLIST.md` (Prioritas High)

Perubahan yang dilakukan:
- **Update "Last updated"** ke 10 Juli 2026
- **Centang task UX Polish yang sudah selesai** di bagian M6-WEB:
  - Batch A: A1 landing badge, A2 onboarding defaults/progress/ETA, A4 reader tap feedback, A5 font min 16, A6 fallback banner, A7 library empty CTA, A8 numeric progress, A9 profile greeting, A10 credit contrast badge, A11 bounded balance polling, A12 ending cleanup, A14 guest pricing
  - Batch B: B1 guest-to-login preservation, B2 theme + text-size settings
  - Batch C: C1 stable completed-story seed, C2 targeted TestSprite replay
- **Catat Poetry Lottie onboarding** — building screen kini menampilkan animasi Lottie (quill/parchment) menggantikan brand text statis (commit `814445c`)
- **Catat dependency baru** `lottie-react ^2.4.1`
- **Catat optimasi performa** (lazy load onboarding flow, shared shell layout, reduced auth fetches) sebagai bagian dari M6-WEB hardening
- **Catat Cloudflare Worker fixes** (env resolution, platform-safe patch, dynamic page flags)

### 2. Update `docs/IMPLEMENTATION_PLAN.md` (Prioritas Medium)

- **Update "Last updated"** ke 10 Juli 2026
- **T6W.1** — update status: design system + app shell sudah termasuk UX Polish Batch A
- **T6W.2** — update status: onboarding building screen kini pakai Poetry Lottie animation
- **T6W.4** — update status: UX Polish Batch B (guest-to-login preservation) sudah selesai

### 3. Update `.gitignore` (Prioritas Low)

- Tambahkan baris `.playwright-mcp/` (analog dengan `.v0-trash/` dan `.snowflake/` yang sudah di-ignore)