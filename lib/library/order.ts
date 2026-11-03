/**
 * Aturan urutan, saring, dan label daftar Koleksiku.
 *
 * Fungsi murni tanpa akses browser/server supaya bisa dipakai komponen klien
 * dan diuji tanpa DOM.
 */
import type {
  LibrarySortKey,
  LibraryStatusFilter,
  LibraryStoryItem,
} from './types'

function byTitle(a: LibraryStoryItem, b: LibraryStoryItem): number {
  return a.title.localeCompare(b.title, 'id', { sensitivity: 'base' })
}

function readTime(item: LibraryStoryItem): number {
  if (!item.lastReadAt) return 0
  const ms = Date.parse(item.lastReadAt)
  return Number.isNaN(ms) ? 0 : ms
}

function progressRatio(item: LibraryStoryItem): number {
  if (item.totalChapters <= 0) return 0
  return item.currentChapter / item.totalChapters
}

/**
 * Urutan bawaan: yang terakhir dibaca di atas. Cerita tanpa stempel waktu
 * jatuh ke bawah, lalu diurutkan judul supaya hasilnya tetap deterministik.
 */
export function compareByLastRead(a: LibraryStoryItem, b: LibraryStoryItem): number {
  const delta = readTime(b) - readTime(a)
  if (delta !== 0) return delta
  return byTitle(a, b) || a.id.localeCompare(b.id)
}

export function sortLibraryStories(
  items: readonly LibraryStoryItem[],
  key: LibrarySortKey,
): LibraryStoryItem[] {
  const copy = [...items]
  if (key === 'title') return copy.sort(byTitle)
  if (key === 'progress') {
    return copy.sort((a, b) => {
      const delta = progressRatio(b) - progressRatio(a)
      return delta !== 0 ? delta : byTitle(a, b)
    })
  }
  return copy.sort(compareByLastRead)
}

export function filterLibraryStories(
  items: readonly LibraryStoryItem[],
  options: { query: string; status: LibraryStatusFilter },
): LibraryStoryItem[] {
  const query = options.query.trim().toLowerCase()
  return items.filter((item) => {
    if (options.status !== 'SEMUA' && item.status !== options.status) return false
    if (query.length === 0) return true
    return item.title.toLowerCase().includes(query)
  })
}

/** Persentase progres 0-100, dijepit agar data rusak tidak merusak lebar bar. */
export function libraryProgressPercent(item: LibraryStoryItem): number {
  const percent = Math.round(progressRatio(item) * 100)
  return Math.min(100, Math.max(0, percent))
}

/** Label baris kedua kartu. Cerita tamat tidak menampilkan "Bab 50/50". */
export function libraryChapterLabel(item: LibraryStoryItem): string {
  if (item.status === 'SELESAI') return 'Selesai'
  return `Bab ${item.currentChapter}/${item.totalChapters}`
}
