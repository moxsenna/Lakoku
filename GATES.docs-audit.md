# Gates: Audit dokumen vs kondisi repo terkini (fase Android live + referral + paycore)

OWNS: docs/**, AGENT_RULES.md, GATES.docs-audit.md

Scope: Selaraskan dokumen normatif/operasional yang kedaluwarsa oleh
perubahan nyata: Android Capacitor live, referral wallet, katalog kredit
per-kanal + Play Billing, deploy shared-VPS systemd. PRD/NCS/NTM adalah
baseline terkunci — hanya diberi catatan status, tidak ditulis ulang.
Otorisasi: instruksi user eksplisit 2026-09-19 ("cek juga dokumen lain...
update segera").

Boundary: Tanpa commit/push. Tanpa ubah kode. Tanpa menulis ulang sejarah
(amendment lama tidak disunting isinya; koreksi via catatan versi baru).

- [x] A0: ledger ini bisa di-lint dan mencantumkan outcome yang dapat gagal
  CHECK: node "C:\Users\bimap\.agents\skills\unlazy\scripts\gate-lint.mjs" GATES.docs-audit.md
  EXPECT: LINT OK
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=49037f729fe2/57 entries; EXPECT=matched; output-sha256=11560ea3fd0abaa0dfd23b2ef3aa8505bbe7b24326efa76b76fa1d10a030f056; output-bytes=161

- [x] A1: kebenaran deploy tunggal (shared-VPS systemd, bukan docker-/opt saja)
  CHECK: node scripts/android/docs-audit-check.mjs deploy
  EXPECT: deploy truth verification passed
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=49037f729fe2/57 entries; EXPECT=matched; output-sha256=5668791e9ee62075908924f774792b39c912f824380a3092ce5721bfa3537d1f; output-bytes=184

- [x] A2: IMPLEMENTATION_PLAN mencatat Android Capacitor (bukan Kotlin-nanti)
  CHECK: node scripts/android/docs-audit-check.mjs implplan
  EXPECT: implplan android verification passed
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=49037f729fe2/57 entries; EXPECT=matched; output-sha256=2ca9a47a669abfa8b7990eb1d3d7858baed273ab35b90f2a8e1392a03114c961; output-bytes=111

- [x] A3: PROGRESS_CHECKLIST mencatat status Android live
  CHECK: node scripts/android/docs-audit-check.mjs progress
  EXPECT: progress android verification passed
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=49037f729fe2/57 entries; EXPECT=matched; output-sha256=c997b25b28673171b718fbc187495a745608b7d9a2d21ece84b778a5edb38a0d; output-bytes=111

- [x] A4: PAYCORE_INTEGRATION mencatat kanal android + Play Billing
  CHECK: node scripts/android/docs-audit-check.mjs paycore
  EXPECT: paycore channel verification passed
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=49037f729fe2/57 entries; EXPECT=matched; output-sha256=b72d6e4541136b4cacb7d578feb9173f1c53ec7677b44752346585d17a11b032; output-bytes=154

- [x] A5: peta amandemen konsisten (versi terbaru + rujukan Android)
  CHECK: node scripts/android/docs-audit-check.mjs amendments
  EXPECT: amendments map verification passed
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=D:\Coding\lakoku v2; path=49037f729fe2/57 entries; EXPECT=matched; output-sha256=2d05ab797ad05f11087455b42fdd422426efb0184e6283c135b5a7bbb3555e5e; output-bytes=80

- [x] A6: manual review - berkas yang berubah hanya dokumen yang dimaksud, tanpa sisa edit lain
  EVIDENCE: reviewed 2026-09-19 — file saya: AGENT_RULES.md, docs/{CLIENT_SEQUENCING,IMPLEMENTATION_PLAN,PAYCORE_INTEGRATION,PROGRESS_CHECKLIST}.md, GATES.docs-audit.md, scripts/android/docs-audit-check.mjs. Sisa status (misi/ads/admin/pages/lakoin) milik workstream lain, tidak saya sentuh.
