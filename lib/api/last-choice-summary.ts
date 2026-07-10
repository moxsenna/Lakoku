/**
 * Lakoku — Ringkasan pilihan terakhir (fallback guest).
 *
 * Saat tamu (belum login) memilih, server tidak mencatat jejak ke reader_states.
 * Modul ini menyediakan fallback client-side agar card "Pilihanmu sebelumnya"
 * tetap muncul di bab berikutnya, walaupun story.jejak belum terisi.
 *
 * Sumber utama tetap server jejak. localStorage hanya fallback.
 *
 * Aman SSR: semua akses localStorage dijaga typeof window.
 */

import type { JejakItem } from './types'

const STORAGE_KEY = 'lakoku:last-choice-summary:v1'

interface LastChoiceEntry {
  storyId: string
  fromChapter: number
  toChapter: number
  decision: string
  consequence: string
}

type SummaryMap = Record<string, LastChoiceEntry[]>

function readMap(): SummaryMap {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as SummaryMap) : {}
  } catch {
    return {}
  }
}

function writeMap(map: SummaryMap): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    // Storage penuh / diblokir — abaikan.
  }
}

/**
 * Simpan ringkasan pilihan terakhir (upsert per storyId + toChapter).
 * Maksimal 60 entry per cerita — aman untuk 50 bab + sedikit retry/duplikat.
 */
export function recordLastChoiceSummary(entry: LastChoiceEntry): void {
  const map = readMap()
  const list = map[entry.storyId] ?? []

  map[entry.storyId] = [
    ...list.filter((e) => e.toChapter !== entry.toChapter),
    entry,
  ].slice(-60)

  writeMap(map)
}

/**
 * Dapatkan ringkasan pilihan dari localStorage untuk bab tertentu.
 * Mencari dari belakang list agar entry terbaru yang ditemukan.
 * Mengembalikan objek JejakItem-compatible, atau null.
 */
export function getLastChoiceSummary(
  storyId: string,
  chapterNumber: number,
): JejakItem | null {
  const map = readMap()
  const list = map[storyId]
  if (!list || list.length === 0) return null

  // Cari dari belakang — entry terbaru yang cocok
  const entry = [...list].reverse().find((e) => e.toChapter === chapterNumber)
  if (!entry) return null

  return {
    chapter: entry.fromChapter,
    decision: entry.decision,
    consequence: entry.consequence,
  }
}
