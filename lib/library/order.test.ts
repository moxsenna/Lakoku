import { describe, expect, it } from 'vitest'
import {
  compareByLastRead,
  filterLibraryStories,
  libraryChapterLabel,
  libraryProgressPercent,
  sortLibraryStories,
} from './order'
import type { LibraryStoryItem } from './types'

function item(overrides: Partial<LibraryStoryItem> & { id: string }): LibraryStoryItem {
  return {
    title: overrides.id,
    cover: '/covers/default-cover.webp',
    status: 'BERJALAN',
    currentChapter: 1,
    totalChapters: 50,
    isOwned: false,
    visibility: null,
    ...overrides,
  }
}

describe('compareByLastRead', () => {
  it('menaruh yang terakhir dibaca di atas', () => {
    const older = item({ id: 'a', lastReadAt: '2026-01-01T00:00:00.000Z' })
    const newer = item({ id: 'b', lastReadAt: '2026-02-01T00:00:00.000Z' })
    expect([older, newer].sort(compareByLastRead).map((s) => s.id)).toEqual(['b', 'a'])
  })

  it('menaruh cerita tanpa stempel waktu di bawah dan mengurutkan judul', () => {
    const noStampB = item({ id: 'b', title: 'Beta' })
    const noStampA = item({ id: 'a', title: 'Alfa' })
    const stamped = item({ id: 'c', title: 'Zeta', lastReadAt: '2026-02-01T00:00:00.000Z' })
    expect([noStampB, stamped, noStampA].sort(compareByLastRead).map((s) => s.id)).toEqual([
      'c',
      'a',
      'b',
    ])
  })

  it('deterministik saat stempel waktu sama', () => {
    const first = item({ id: 'z', title: 'Sama' })
    const second = item({ id: 'a', title: 'Sama' })
    expect([first, second].sort(compareByLastRead).map((s) => s.id)).toEqual(['a', 'z'])
  })
})

describe('sortLibraryStories', () => {
  const stories = [
    item({ id: 'a', title: 'Beta', currentChapter: 10, lastReadAt: '2026-01-01T00:00:00.000Z' }),
    item({ id: 'b', title: 'Alfa', currentChapter: 40, lastReadAt: '2026-03-01T00:00:00.000Z' }),
    item({ id: 'c', title: 'Gama', currentChapter: 25, lastReadAt: '2026-02-01T00:00:00.000Z' }),
  ]

  it('default: terakhir dibaca', () => {
    expect(sortLibraryStories(stories, 'lastRead').map((s) => s.id)).toEqual(['b', 'c', 'a'])
  })

  it('judul A-Z', () => {
    expect(sortLibraryStories(stories, 'title').map((s) => s.id)).toEqual(['b', 'a', 'c'])
  })

  it('progres menurun', () => {
    expect(sortLibraryStories(stories, 'progress').map((s) => s.id)).toEqual(['b', 'c', 'a'])
  })

  it('tidak mengubah array masukan', () => {
    const original = [...stories]
    sortLibraryStories(stories, 'title')
    expect(stories).toEqual(original)
  })
})

describe('filterLibraryStories', () => {
  const stories = [
    item({ id: 'a', title: 'Bayang Dokumen', status: 'SELESAI' }),
    item({ id: 'b', title: 'Hujan di Kota', status: 'BERJALAN' }),
    item({ id: 'c', title: 'bayangan kedua', status: 'BARU' }),
  ]

  it('mencari judul tanpa peduli huruf besar/kecil', () => {
    expect(filterLibraryStories(stories, { query: 'BAYANG', status: 'SEMUA' }).map((s) => s.id))
      .toEqual(['a', 'c'])
  })

  it('menyaring status', () => {
    expect(filterLibraryStories(stories, { query: '', status: 'SELESAI' }).map((s) => s.id))
      .toEqual(['a'])
  })

  it('mengabaikan spasi di tepi pencarian', () => {
    expect(filterLibraryStories(stories, { query: '  hujan  ', status: 'SEMUA' }).map((s) => s.id))
      .toEqual(['b'])
  })
})

describe('label kartu', () => {
  it('cerita tamat memakai label Selesai, bukan Bab 50/50', () => {
    expect(
      libraryChapterLabel(item({ id: 'a', status: 'SELESAI', currentChapter: 50, totalChapters: 50 })),
    ).toBe('Selesai')
  })

  it('cerita berjalan memakai Bab N/M', () => {
    expect(libraryChapterLabel(item({ id: 'a', currentChapter: 7, totalChapters: 50 }))).toBe(
      'Bab 7/50',
    )
  })

  it('persentase dijepit 0-100', () => {
    expect(libraryProgressPercent(item({ id: 'a', currentChapter: 120, totalChapters: 50 }))).toBe(100)
    expect(libraryProgressPercent(item({ id: 'a', currentChapter: 0, totalChapters: 50 }))).toBe(0)
  })
})
