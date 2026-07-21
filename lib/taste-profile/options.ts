/**
 * Dynamic option builder dari genre yang dipilih.
 *
 * Digunakan oleh TasteProfileFlow untuk membangun opsi-opsi trope-liked
 * dan avoided-options berdasarkan pilihan genre user.
 *
 * BUG DIDOKUMENTASIKAN: Loop saat ini berurutan (sequential) — jika genre
 * pertama memiliki >=6 opsi, semua 6 opsi akan diambil dari genre pertama
 * tanpa memberi slot ke genre kedua. Perilaku yang diinginkan: interleave
 * 4 dari genre primer + 2 dari genre sekunder, stabil, dedupe by ID.
 *
 * Lihat: tests/taste-profile/build-options-from-genres.test.ts
 */

const MAX_OPTIONS = 6

/**
 * Gabungkan opsi dari genre yang dipilih, deduplicate, max 6.
 *
 * Perilaku SAAT INI (Bug 1 — sequential):
 *   Loop outer genre → inner options → jika penuh, break.
 *   Dengan 1 genre: 6 dari genre tersebut (OK).
 *   Dengan 2 genre (mis. Misteri 6 + Romansa 6):
 *    6 opsi pertama Misteri mengisi semua slot → Romansa tidak dapat slot.
 *
 * Perilaku yang DIINGINKAN (dari plan Fase 0):
 *   1 genre → 6 dari genre tersebut.
 *   2 genre → 4 dari genre primer + 2 dari genre sekunder,
 *     diinterleave, urutan stabil, dedupe by ID.
 */
export function buildOptionsFromGenres(
  selectedGenres: string[],
  genreMap: Record<string, string[]>,
  fallback: string[],
): string[] {
  if (!selectedGenres.length) {
    return fallback.slice(0, MAX_OPTIONS)
  }

  const seen = new Set<string>()
  const result: string[] = []

  for (const genre of selectedGenres) {
    const options = genreMap[genre]
    if (!options) continue
    for (const opt of options) {
      if (result.length >= MAX_OPTIONS) break
      if (seen.has(opt)) continue
      seen.add(opt)
      result.push(opt)
    }
    if (result.length >= MAX_OPTIONS) break
  }

  if (result.length < MAX_OPTIONS) {
    for (const opt of fallback) {
      if (result.length >= MAX_OPTIONS) break
      if (seen.has(opt)) continue
      seen.add(opt)
      result.push(opt)
    }
  }

  return result
}

/**
 * DESIRED: Build balanced options di mana genre primer dapat 4 slot,
 * genre sekunder dapat 2 slot (diinterleave untuk stabilitas urutan).
 *
 * Algoritma interleave:
 *   Primer: ambil 1, Sekunder: ambil 1, Primer: ambil 1, ...
 *   — sampai primer habis (4 terpenuhi) atau sekunder habis (2 terpenuhi).
 *   Lalu fill sisanya dari primer atau fallback.
 *   Dedupe by ID (Set tracking).
 *
 * Fungsi ini adalah target behavior yang belum diimplementasi di komponen.
 * Test di tests/taste-profile/build-options-from-genres.test.ts akan FAIL
 * sampai buildOptionsFromGenres diganti dengan algoritma balanced ini.
 */
export function buildBalancedOptionsFromGenres(
  selectedGenres: string[],
  genreMap: Record<string, string[]>,
  fallback: string[],
): string[] {
  if (!selectedGenres.length) {
    return fallback.slice(0, MAX_OPTIONS)
  }

  const primaryGenre = selectedGenres[0]
  const secondaryGenre = selectedGenres[1] ?? null

  const primaryOpts = genreMap[primaryGenre] ?? []
  const secondaryOpts = secondaryGenre ? (genreMap[secondaryGenre] ?? []) : []

  if (!secondaryGenre) {
    // Hanya 1 genre: ambil 6 dari genre tersebut, dedupe + fallback
    const seen = new Set<string>()
    const result: string[] = []
    for (const o of primaryOpts) {
      if (result.length >= MAX_OPTIONS) break
      if (seen.has(o)) continue
      seen.add(o)
      result.push(o)
    }
    for (const o of fallback) {
      if (result.length >= MAX_OPTIONS) break
      if (seen.has(o)) continue
      seen.add(o)
      result.push(o)
    }
    return result
  }

  // 2+ genre: interleave primary (max 4) & secondary (max 2)
  const seen = new Set<string>()
  const result: string[] = []

  let primaryIdx = 0
  let secondaryIdx = 0
  const PRIMARY_MAX = 4
  const SECONDARY_MAX = 2
  let primaryCount = 0
  let secondaryCount = 0

  // Interleave loop
  while (result.length < MAX_OPTIONS) {
    let added = false

    // Ambil dari primary
    if (primaryCount < PRIMARY_MAX && primaryIdx < primaryOpts.length) {
      while (primaryIdx < primaryOpts.length) {
        const opt = primaryOpts[primaryIdx]
        primaryIdx++
        if (!seen.has(opt)) {
          seen.add(opt)
          result.push(opt)
          primaryCount++
          added = true
          break
        }
      }
    }

    // Ambil dari secondary
    if (secondaryCount < SECONDARY_MAX && secondaryIdx < secondaryOpts.length) {
      while (secondaryIdx < secondaryOpts.length) {
        const opt = secondaryOpts[secondaryIdx]
        secondaryIdx++
        if (!seen.has(opt)) {
          seen.add(opt)
          result.push(opt)
          secondaryCount++
          added = true
          break
        }
      }
    }

    // Jika tidak ada yang ditambahkan, isi sisanya
    if (!added) {
      // Coba habiskan primary yang tersisa
      while (primaryIdx < primaryOpts.length && result.length < MAX_OPTIONS) {
        const opt = primaryOpts[primaryIdx]
        primaryIdx++
        if (!seen.has(opt)) {
          seen.add(opt)
          result.push(opt)
          primaryCount++
        }
      }
      // Coba habiskan secondary yang tersisa
      while (secondaryIdx < secondaryOpts.length && result.length < MAX_OPTIONS) {
        const opt = secondaryOpts[secondaryIdx]
        secondaryIdx++
        if (!seen.has(opt)) {
          seen.add(opt)
          result.push(opt)
          secondaryCount++
        }
      }
      // Fallback
      for (const opt of fallback) {
        if (result.length >= MAX_OPTIONS) break
        if (seen.has(opt)) continue
        seen.add(opt)
        result.push(opt)
      }
      break
    }
  }

  return result
}
