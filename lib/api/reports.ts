/**
 * T7.3 — Laporan pembaca (sisi BROWSER).
 *
 * Referensi bab dilampirkan otomatis oleh server — pembaca tidak perlu
 * screenshot. Fungsi ini gagal-halus: tidak pernah melempar ke UI.
 */

export type ReportReason =
  | 'KARAKTER_TIDAK_KONSISTEN'
  | 'MELANGGAR_BATAS_KONTEN'
  | 'PILIHAN_TIDAK_BERDAMPAK'
  | 'TYPO_BAHASA'
  | 'VISUAL_TIDAK_SESUAI'
  | 'LAINNYA'

/** Daftar alasan berlabel Indonesia (PRD §10.7) untuk UI report sheet. */
export const REPORT_REASONS: Array<{ value: ReportReason; label: string }> = [
  { value: 'KARAKTER_TIDAK_KONSISTEN', label: 'Karakter tidak konsisten' },
  { value: 'MELANGGAR_BATAS_KONTEN', label: 'Melanggar batas konten' },
  { value: 'PILIHAN_TIDAK_BERDAMPAK', label: 'Pilihan tidak berdampak' },
  { value: 'TYPO_BAHASA', label: 'Typo / masalah bahasa' },
  { value: 'VISUAL_TIDAK_SESUAI', label: 'Visual tidak sesuai' },
  { value: 'LAINNYA', label: 'Lainnya' },
]

/**
 * Kirim laporan masalah cerita. Selalu resolve (true = terkirim,
 * false = gagal jaringan/server) — UI tetap menampilkan pesan lembut.
 */
export async function submitContentReport(
  storyId: string,
  chapterNumber: number,
  reason: ReportReason,
  note?: string,
): Promise<boolean> {
  try {
    const res = await fetch(
      `/api/stories/${encodeURIComponent(storyId)}/reports`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chapterNumber, reason, note }),
      },
    )
    return res.ok
  } catch {
    return false
  }
}
