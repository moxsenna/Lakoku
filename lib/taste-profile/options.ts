/**
 * Dynamic option builder dari genre yang dipilih.
 *
 * Digunakan oleh TasteProfileFlow untuk membangun opsi-opsi trope-liked
 * dan avoided-options berdasarkan pilihan genre user.
 *
 * Default: balanced 4+2 interleave (primer 4 + sekunder 2), stabil, dedupe by ID.
 * buildBalancedOptionsFromGenres tetap diekspor (sama algoritma).
 *
 * Lihat: tests/taste-profile/build-options-from-genres.test.ts
 */

const MAX_OPTIONS = 6

/**
 * Build options dari genre terpilih.
 * Default = balanced 4+2 interleave (alias production path).
 *
 *   1 genre → 6 dari genre tersebut.
 *   2 genre → 4 primer + 2 sekunder, diinterleave, urutan stabil, dedupe by ID.
 *   0 genre / unknown → fallback (max 6).
 */
export function buildOptionsFromGenres(
  selectedGenres: string[],
  genreMap: Record<string, string[]>,
  fallback: string[],
): string[] {
  return buildBalancedOptionsFromGenres(selectedGenres, genreMap, fallback)
}

/**
 * Build balanced options: genre primer 4 slot, sekunder 2 slot (interleave).
 *
 * Algoritma interleave:
 *   Primer: ambil 1, Sekunder: ambil 1, Primer: ambil 1, ...
 *   — sampai primer habis (4 terpenuhi) atau sekunder habis (2 terpenuhi).
 *   Lalu fill sisanya dari primer/secondary/fallback.
 *   Dedupe by ID (Set tracking).
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
