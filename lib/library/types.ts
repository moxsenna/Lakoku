/** Bentuk data ringkas untuk daftar Koleksiku (tanpa `jejak`, tanpa tagline). */
export interface LibraryStoryItem {
  id: string
  title: string
  cover: string
  status: 'BARU' | 'BERJALAN' | 'SELESAI'
  currentChapter: number
  totalChapters: number
  /** ISO timestamp sentuhan terakhir pembaca. */
  lastReadAt?: string
  /** True bila pengguna adalah pemilik cerita (boleh ubah visibilitas). */
  isOwned: boolean
  visibility: string | null
}

export type LibrarySortKey = 'lastRead' | 'title' | 'progress'

export type LibraryStatusFilter = 'SEMUA' | 'BARU' | 'BERJALAN' | 'SELESAI'
