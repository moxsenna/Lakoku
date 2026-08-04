/**
 * M10-A1 — Blueprint resolution (pure).
 *
 * SATU-SATUNYA primitive resolusi blueprint kanonik: highest version wins.
 * Compiler, Layer A, dan state resolver WAJIB memakai helper ini agar tidak
 * ada divergence resolusi versi (finding M10-A
 * `BLUEPRINT_VERSION_RESOLUTION_DIVERGENCE`):
 *   - writer/state policy → versi tertinggi
 *   - introduced-character allowlist → versi tertinggi
 */

import type { CanonSnapshot, ChapterBlueprint } from './types'

/** Ambil blueprint versi tertinggi untuk sebuah bab (atau null). */
export function latestBlueprintForChapter(
  snapshot: CanonSnapshot,
  chapterNumber: number,
): ChapterBlueprint | null {
  const candidates = snapshot.blueprints
    .filter((blueprint) => blueprint.chapterNumber === chapterNumber)
    .sort((a, b) => b.version - a.version)
  return candidates[0] ?? null
}
