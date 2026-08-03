# Dokumen Kebijakan & Audit Kontinuitas Naratif (P0 Fix)

## 1. Topologi Cerita Publik vs Private
- **Standard Public (Shared-Linear)**: Banyak reader membaca satu `story_id` global. Reader non-owner tidak dapat men-trigger generasi bab baru yang dapat menimpa alur pembaca lain.
- **Personalized AI / Premium Instance**: Menggunakan `clone_premium_story_instance` sehingga 1 reader = 1 `story_id` independen. Pilihan pembaca secara langsung mempengaruhi bab berikutnya.

## 2. Kebijakan Bab Produksi yang Sudah Terpublikasi (Existing Published Chapters)
- Penyesuaian `GENERATION_PROMPT_CONTRACT_VERSION` dari 2 ke 3 memvalidasi ulang checkpoint generasi baru.
- Bab yang sudah terbit di produksi **TIDAK DIHAPUS ATAU DIUBAH DENGAN SKRIP AUTO-MIGRATION/REGENERASI**.
- Perbaikan kontinuitas berlaku secara **forward-looking** untuk setiap pembuatan bab baru N>1 atau cerita privat baru.

## 3. Rencana Kompatibilitas Opsi B (Auto-Clone Follow-up)
- Apabila di masa mendatang produk mengizinkan branching publik untuk reader individual, mekanik auto-clone dari standard public ke private instance akan diterapkan sebelum trigger generasi bab baru.
