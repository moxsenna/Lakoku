/**
 * Fixture kontinuitas Sinta/Bagas — novel kedua M10-G (desa lereng gunung).
 *
 * Cermin dari `nadia-raka-continuity.ts`: snapshot kosong dengan karakter
 * terdaftar agar runner full-proof bisa membangun brief Bab 1 nyata dari
 * kontrak `fixtures/contracts/sinta-bagas.ts`. Tokoh (Sinta protagonis,
 * Bagas antagonis) dan konflik (keris pusaka hilang) berbeda total dari
 * Nadia/Raka agar memenuhi syarat DoD "3 distinct novels".
 */

import type { CanonSnapshot } from '@/lib/narrative/types'

export const SINTA_BAGAS_STORY_ID = 'story-sinta-bagas'

export function sintaBagasSnapshot(storyId: string = SINTA_BAGAS_STORY_ID): CanonSnapshot {
  return {
    storyId,
    characters: [
      { id: 'sinta', storyId, canonicalName: 'Sinta', role: 'Protagonis', motivation: 'Menjaga amanah pusaka', introducedChapter: 1, status: 'ALIVE' },
      { id: 'bagas', storyId, canonicalName: 'Bagas', role: 'Antagonis', motivation: 'Menguasai tanah dan pusaka', introducedChapter: 1, status: 'ALIVE' },
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
