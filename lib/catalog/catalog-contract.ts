import { StoryContractSchema, type StoryContract } from '@/lib/story-engine/story-contract'

/** Bab terakhir spine bersama; pilihan di sini mengunci ending per pembaca. */
export const CATALOG_SPINE_LAST_CHAPTER = 44
/** Bab pertama varian ending (closureRunway.endingLockChapter literal 45). */
export const CATALOG_VARIANT_FIRST_CHAPTER = 45

export function assertCatalogStoryId(storyId: string): void {
  if (!storyId.startsWith('catalog:') || storyId.length <= 'catalog:'.length) {
    throw new Error(`CATALOG_STORY_ID_INVALID:${storyId}`)
  }
}

/**
 * Kontrak katalog wajib punya tepat 3 kandidat ending (2 main + 1 secret).
 * Kontrak hasil LLM bisa membawa lebih banyak kandidat; sisakan dua main
 * pertama dan satu secret pertama, lalu validasi ulang.
 */
export function normalizeCatalogEndings(contract: StoryContract): StoryContract {
  const mains = contract.endingCandidates.filter((candidate) => candidate.kind === 'main')
  const secrets = contract.endingCandidates.filter((candidate) => candidate.kind === 'secret')
  if (mains.length < 2 || secrets.length < 1) {
    throw new Error(
      `CATALOG_ENDINGS_INVALID: butuh 2 main + 1 secret, dapat ${mains.length} main + ${secrets.length} secret`,
    )
  }
  const kept = [...mains.slice(0, 2), secrets[0]!]
  if (kept.length === contract.endingCandidates.length) return contract
  return StoryContractSchema.parse({ ...contract, endingCandidates: kept })
}

/** Validasi kontrak siap-generate: skema penuh + 3 kandidat ending katalog. */
export function assertCatalogContract(contract: StoryContract): StoryContract {
  const normalized = normalizeCatalogEndings(contract)
  const mains = normalized.endingCandidates.filter((candidate) => candidate.kind === 'main').length
  const secrets = normalized.endingCandidates.filter((candidate) => candidate.kind === 'secret').length
  if (normalized.endingCandidates.length !== 3 || mains !== 2 || secrets !== 1) {
    throw new Error('CATALOG_ENDINGS_INVALID: kontrak katalog wajib tepat 2 main + 1 secret')
  }
  return normalized
}

export function parseCatalogContractJson(raw: unknown): StoryContract {
  return StoryContractSchema.parse(raw)
}

/**
 * Overlay premis operator ke kontrak template (fallback): judul, nama tokoh,
 * corePromise/mainConflict dari sinopsis, dan finalQuestion dari tagline.
 * Struktur bab, reveal runway, dan kandidat ending tidak disentuh. Anchor ini
 * mengalir ke brief tiap bab via storyAnchors continuation, sehingga prosa
 * mengikuti premis meski kontrak berasal dari template.
 */
export function applyPremiseOverlay(
  contract: StoryContract,
  premise: { title: string; synopsis: string; protagonistName: string; tagline: string },
): StoryContract {
  const normalizedContract = normalizeCatalogEndings(contract)
  const bounded = (value: string, max: number): string => {
    const trimmed = value.trim()
    return trimmed.length <= max ? trimmed : trimmed.slice(0, max).trim()
  }
  const synopsis = bounded(premise.synopsis, 800)
  return StoryContractSchema.parse({
    ...normalizedContract,
    title: bounded(premise.title, 160),
    mainCharacter: {
      ...normalizedContract.mainCharacter,
      name: bounded(premise.protagonistName, 100),
    },
    corePromise: synopsis,
    mainConflict: synopsis,
    finalQuestion: bounded(premise.tagline, 500),
    styleProfile: 'kbm_viral_v1',
  })
}
