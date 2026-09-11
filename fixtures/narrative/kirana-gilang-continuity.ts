/**
 * Fixture kontinuitas Kirana/Gilang — novel ketiga M10-G (kota pesisir).
 *
 * Cermin dari `nadia-raka-continuity.ts` / `sinta-bagas-continuity.ts`:
 * snapshot kosong dengan karakter terdaftar agar runner full-proof bisa
 * membangun brief Bab 1 nyata dari kontrak `fixtures/contracts/kirana-gilang.ts`.
 */

import type { CanonSnapshot } from '@/lib/narrative/types'

export const KIRANA_GILANG_STORY_ID = 'story-kirana-gilang'

export function kiranaGilangSnapshot(storyId: string = KIRANA_GILANG_STORY_ID): CanonSnapshot {
  return {
    storyId,
    characters: [
      { id: 'kirana', storyId, canonicalName: 'Kirana', role: 'Protagonis', motivation: 'Menjaga arsip kapal', introducedChapter: 1, status: 'ALIVE' },
      { id: 'gilang', storyId, canonicalName: 'Gilang', role: 'Antagonis', motivation: 'Menguasai lelang dermaga', introducedChapter: 1, status: 'ALIVE' },
    ],
    aliases: [],
    voiceSheets: [],
    facts: [],
    knowledge: [],
    secrets: [],
    timeline: [],
    threads: [],
    actRollups: [],
    blueprints: [],
  }
}
