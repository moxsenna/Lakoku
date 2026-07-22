import 'server-only'

import { fantasiPetualanganContract } from '@/fixtures/contracts/fantasi-petualangan'
import { misteriDramaContract } from '@/fixtures/contracts/misteri-drama'
import { romansaDramaContract } from '@/fixtures/contracts/romansa-drama'
import { generateStoryContractRaw } from '@/lib/ai-gateway/gateway'
import { InvalidModelResponseError } from '@/lib/ai-gateway/model-call-errors'
import type {
  GenerationProvider,
  ModelCallExecutionOptions,
  StoryContractInput,
} from '@/lib/ai-gateway/provider'
import type { ProviderCallContext } from '@/lib/observability/generation-provider-call.contract'
import {
  createEmptyTasteProfile,
  type TasteProfileV2,
} from '@/lib/taste-profile/schema'
import {
  resolveGenreId,
} from '@/lib/taste-profile/catalog'
import { StoryContractSchema, type StoryContract } from './story-contract'

export type ContractSource = 'llm' | 'llm_repaired' | 'template_fallback'

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_REPAIR_ERRORS = 32
const MAX_REPAIR_ERROR_LENGTH = 500
const MAX_TASTE_ITEMS = 16
const MAX_TASTE_ITEM_LENGTH = 160
const TIMEOUT_ERROR = 'timeoutMs must be a finite positive integer no greater than 30000.'

class ContractGenerationTimeoutError extends Error {
  constructor() {
    super('Story contract generation timed out.')
    this.name = 'ContractGenerationTimeoutError'
  }
}

function issueStrings(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): string[] {
  return error.issues.slice(0, MAX_REPAIR_ERRORS).map((issue) => {
    const path = issue.path.length ? issue.path.map(String).join('.') : '(root)'
    return `${path}: ${issue.message}`.slice(0, MAX_REPAIR_ERROR_LENGTH)
  })
}

async function generateWithinBudget(
  provider: GenerationProvider,
  input: StoryContractInput,
  timeoutMs: number,
  options?: ModelCallExecutionOptions,
): Promise<unknown> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const providerResult = generateStoryContractRaw({ provider }, input, {
    signal: controller.signal,
    ...options,
    consume: options?.consume,
  })
  const timeout = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener('abort', () => {
      reject(new ContractGenerationTimeoutError())
    }, { once: true })
    timer = setTimeout(() => controller.abort(), timeoutMs)
  })

  try {
    return await Promise.race([providerResult, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function boundedTasteItems(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .slice(0, MAX_TASTE_ITEMS)
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().slice(0, MAX_TASTE_ITEM_LENGTH).trim())
    .filter(Boolean)
}

/**
 * Create a frozen snapshot of a V2 taste profile for use in contract generation.
 * Maps V2 stable IDs back to V1-era labels for template matching compatibility.
 */
function createTasteSnapshotV2(tasteJson: TasteProfileV2): TasteProfileV2 {
  const defaults = createEmptyTasteProfile()

  const snapshot: TasteProfileV2 = {
    version: 2,
    primaryGenreId: tasteJson?.primaryGenreId ?? defaults.primaryGenreId,
    secondaryGenreId: tasteJson?.secondaryGenreId ?? defaults.secondaryGenreId,
    likedConflictIds: boundedTasteItems(tasteJson?.likedConflictIds),
    customLikedConflict: tasteJson?.customLikedConflict ?? defaults.customLikedConflict,
    softAvoidanceIds: boundedTasteItems(tasteJson?.softAvoidanceIds),
    contentBoundaryIds: boundedTasteItems(tasteJson?.contentBoundaryIds),
    dramaIntensity: tasteJson?.dramaIntensity ?? defaults.dramaIntensity,
    pacing: tasteJson?.pacing ?? defaults.pacing,
    languageStyle: tasteJson?.languageStyle ?? defaults.languageStyle,
    endingBias: tasteJson?.endingBias ?? defaults.endingBias,
    completedAt: tasteJson?.completedAt ?? defaults.completedAt,
    skippedAt: tasteJson?.skippedAt ?? defaults.skippedAt,
    updatedAt: tasteJson?.updatedAt ?? defaults.updatedAt,
  }
  Object.freeze(snapshot.likedConflictIds)
  Object.freeze(snapshot.softAvoidanceIds)
  Object.freeze(snapshot.contentBoundaryIds)
  return Object.freeze(snapshot)
}

function parseRequestedContract(raw: unknown, storyId: string) {
  const parsed = StoryContractSchema.safeParse(raw)
  if (!parsed.success) return parsed
  if (parsed.data.storyId !== storyId) {
    return {
      success: false as const,
      error: {
        issues: [{
          path: ['storyId'],
          message: `Expected ${storyId}, received ${parsed.data.storyId}.`,
        }],
      },
    }
  }
  return parsed
}

function validateTimeout(timeoutMs: number): void {
  if (!Number.isFinite(timeoutMs) || !Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000) {
    throw new RangeError(TIMEOUT_ERROR)
  }
}

type TemplateKey = 'fantasy' | 'mystery' | 'romance'

type SelectedTemplate = {
  key: TemplateKey
  contract: StoryContract
  genre?: string
}

function normalizeTasteToken(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('id-ID')
}

/** Template selection maps V2 genre IDs to internal template keys. */
const GENRE_TO_TEMPLATE: Record<string, string> = {
  family_drama: 'mystery',
  mystery: 'mystery',
  slice_of_life: 'mystery',
  survival_thriller: 'mystery',
  romance: 'romance',
  fantasy_kingdom: 'fantasy',
}

const CURATED_TROPES = [
  'Rahasia keluarga yang dikubur lama',
  'Surat lama yang mengubah warisan',
  'Identitas asli yang disembunyikan',
  'Kematian lama yang belum terjawab',
  'Saksi yang tiba-tiba muncul',
  'Kebenaran yang sengaja ditutup keluarga',
  'Cinta lama yang kembali',
  'Pernikahan kontrak',
  'Sekutu jadi cinta',
  'Cinta yang harus diperjuangkan lagi',
  'Hubungan pura-pura yang jadi nyata',
  'Orang yang salah di waktu yang tepat',
  'Konflik warisan yang memecah keluarga',
  'Rahasia keluarga & warisan',
  'Bangkit setelah jatuh',
  'Pengorbanan demi keluarga',
  'Anak yang kembali setelah bertahun-tahun',
  'Pilihan antara keluarga dan cinta',
  'Tahta yang diperebutkan',
  'Takdir kerajaan yang tersembunyi',
  'Sihir terlarang yang kembali muncul',
  'Aliansi dua kerajaan yang rapuh',
  'Ramalan yang mengubah segalanya',
  'Pengkhianatan di balik takhta',
  'Hidup baru di tempat tak terduga',
  'Persahabatan yang mengubah hidup',
  'Kesempatan kedua di usia dewasa',
  'Menemukan makna di hal sederhana',
  'Pulang ke kampung halaman',
  'Mimpi kecil yang akhirnya tercapai',
  'Terjebak tanpa jalan keluar',
  'Balas dendam yang tertunda',
  'Dikhianati oleh orang terdekat',
  'Berlari dari masa lalu',
  'Permainan berbahaya yang tak bisa dihentikan',
  'Satu keputusan yang mengubah segalanya',
] as const

const CURATED_TROPE_BY_TOKEN = new Map(
  CURATED_TROPES.map((trope) => [normalizeTasteToken(trope), trope]),
)

type LanguageStyleKey = 'clear_concise' | 'poetic_emotional' | 'cinematic_visual'
type PacingKey = 'slow_deep' | 'balanced' | 'fast_eventful'
type EndingBiasKey = 'peaceful' | 'justice' | 'victory' | 'bittersweet'

const TITLES: Record<TemplateKey, Record<LanguageStyleKey, string>> = {
  fantasy: {
    clear_concise: 'Kompas Terakhir di Langit Retak',
    poetic_emotional: 'Nyanyian dari Langit yang Retak',
    cinematic_visual: 'Badai di Atas Takhta Langit',
  },
  mystery: {
    clear_concise: 'Arsip Hujan Terakhir',
    poetic_emotional: 'Nama-Nama yang Larut dalam Hujan',
    cinematic_visual: 'Malam Saat Arsip Kota Terbuka',
  },
  romance: {
    clear_concise: 'Duet untuk Pulang',
    poetic_emotional: 'Nada yang Menunggu di Pesisir',
    cinematic_visual: 'Panggung Terakhir Sebelum Pulang',
  },
}

const PROTAGONIST_ALIASES: Record<TemplateKey, Record<PacingKey, string>> = {
  fantasy: {
    slow_deep: 'Nara Arunika',
    balanced: 'Sena Aksara',
    fast_eventful: 'Tara Dirgantara',
  },
  mystery: {
    slow_deep: 'Ratri Pradana',
    balanced: 'Naya Adikara',
    fast_eventful: 'Dara Prabaswara',
  },
  romance: {
    slow_deep: 'Laras Maheswari',
    balanced: 'Nadira Ayuningrum',
    fast_eventful: 'Kaila Pramesti',
  },
}

const SETTING_PHRASES: Record<TemplateKey, Record<EndingBiasKey, string>> = {
  fantasy: {
    justice: 'Jejak kompas membawanya ke kerajaan awan, tempat hukum lama melindungi perebutan takhta.',
    peaceful: 'Jejak kompas membawanya ke kerajaan awan netral, tempat perdamaian antarpulau hampir runtuh.',
    victory: 'Jejak kompas membawanya ke kerajaan awan, pusat perebutan takhta yang menentukan nasib semua pulau.',
    bittersweet: 'Jejak kompas membawanya ke kerajaan awan yang sekarat, tempat satu takhta hanya dapat diselamatkan dengan kehilangan besar.',
  },
  mystery: {
    justice: 'Penyelidikan bergerak ke balai kota tua, tempat arsip hujan menentukan siapa yang harus bertanggung jawab.',
    peaceful: 'Penyelidikan bergerak ke kawasan sungai lama, tempat warga menjaga ingatan yang ingin dikubur pejabat kota.',
    victory: 'Penyelidikan bergerak ke ruang sidang kota, tempat jaringan pejabat mempertaruhkan kendali terakhirnya.',
    bittersweet: 'Penyelidikan bergerak ke permukiman banjir lama, tempat kebenaran dapat pulih meski keluarga tidak kembali utuh.',
  },
  romance: {
    justice: 'Perjuangan mereka berpusat di gedung kesenian pesisir, tempat hak sekolah musik diperebutkan secara terbuka.',
    peaceful: 'Perjuangan mereka berpusat di panggung komunitas pesisir, tempat luka lama mendapat ruang untuk reda.',
    victory: 'Perjuangan mereka berpusat di festival kota pesisir, kesempatan terakhir merebut kembali rumah bagi sekolah musik.',
    bittersweet: 'Perjuangan mereka berpusat di stasiun tua pesisir, tempat satu pertunjukan terakhir memaksa mereka memilih apa yang harus dilepas.',
  },
}

const STYLE_PROMISES: Record<LanguageStyleKey, string> = {
  clear_concise: 'Kisah bergerak dengan bahasa jernih dan keputusan konkret.',
  poetic_emotional: 'Kisah menjaga citraan puitis tanpa mengaburkan pilihan tokoh.',
  cinematic_visual: 'Kisah menonjolkan adegan sinematik dan perubahan emosi yang terlihat.',
}

function selectTemplate(tasteJson: TasteProfileV2): SelectedTemplate {
  // Check primary genre first
  if (tasteJson.primaryGenreId) {
    const template = GENRE_TO_TEMPLATE[tasteJson.primaryGenreId] as TemplateKey | undefined
    if (template) {
      return templateKeyToContract(template)
    }
  }
  return { key: 'mystery', contract: misteriDramaContract }
}

function templateKeyToContract(key: TemplateKey): SelectedTemplate {
  switch (key) {
    case 'fantasy':
      return { key: 'fantasy', contract: fantasiPetualanganContract, genre: 'Fantasi & kerajaan' }
    case 'romance':
      return { key: 'romance', contract: romansaDramaContract, genre: 'Romansa' }
    case 'mystery':
    default:
      return { key: 'mystery', contract: misteriDramaContract }
  }
}

function appendWholeWithinLimit(base: string, additions: string[], maximum: number): string {
  return additions.reduce((result, addition) => (
    result.length + 1 + addition.length <= maximum ? `${result} ${addition}` : result
  ), base)
}

function replaceProtagonistReferences(
  value: unknown,
  oldFullName: string,
  newFullName: string,
): void {
  if (!value || typeof value !== 'object') return
  const oldFirstName = oldFullName.split(/\s+/)[0]
  const newFirstName = newFullName.split(/\s+/)[0]

  for (const [key, nested] of Object.entries(value)) {
    if (typeof nested === 'string') {
      ;(value as Record<string, unknown>)[key] = nested
        .replaceAll(oldFullName, newFullName)
        .replaceAll(oldFirstName, newFirstName)
    } else {
      replaceProtagonistReferences(nested, oldFullName, newFullName)
    }
  }
}

function safeLikedTropes(tasteSnapshot: TasteProfileV2): string[] {
  const blockedTropes = new Set(
    [...tasteSnapshot.softAvoidanceIds, ...tasteSnapshot.contentBoundaryIds]
      .map(normalizeTasteToken),
  )
  const selected: string[] = []
  for (const rawTrope of tasteSnapshot.likedConflictIds) {
    const token = normalizeTasteToken(rawTrope)
    const trope = CURATED_TROPE_BY_TOKEN.get(token)
    if (!trope || blockedTropes.has(token) || selected.includes(trope)) continue
    selected.push(trope)
    if (selected.length === 3) break
  }
  return selected
}

function mapTasteSnapshotToTemplate(tasteSnapshot: TasteProfileV2, storyId: string): StoryContract {
  const selectedTemplate = selectTemplate(tasteSnapshot)
  const template = StoryContractSchema.parse(selectedTemplate.contract)
  const contract = structuredClone(template)
  const pacing: PacingKey = tasteSnapshot.pacing ?? 'balanced'
  const languageStyle: LanguageStyleKey = tasteSnapshot.languageStyle ?? 'cinematic_visual'
  const endingBias: EndingBiasKey = tasteSnapshot.endingBias ?? 'justice'
  const protagonistName = PROTAGONIST_ALIASES[selectedTemplate.key][pacing]
  const likedTropes = safeLikedTropes(tasteSnapshot)

  replaceProtagonistReferences(contract, template.mainCharacter.name, protagonistName)
  contract.storyId = storyId
  contract.title = TITLES[selectedTemplate.key][languageStyle]
  if (selectedTemplate.genre) contract.genre = selectedTemplate.genre
  contract.mainConflict = appendWholeWithinLimit(
    contract.mainConflict,
    [SETTING_PHRASES[selectedTemplate.key][endingBias]],
    800,
  )
  contract.corePromise = appendWholeWithinLimit(
    contract.corePromise,
    [
      STYLE_PROMISES[languageStyle],
      ...(likedTropes.length ? [`Trope pilihan: ${likedTropes.join(', ')}.`] : []),
    ],
    800,
  )

  return StoryContractSchema.parse(contract)
}

export function mapTasteToTemplate(tasteJson: TasteProfileV2, storyId: string): StoryContract {
  return mapTasteSnapshotToTemplate(createTasteSnapshotV2(tasteJson), storyId)
}

export async function createResilientStoryContract(input: {
  storyId: string
  tasteJson: TasteProfileV2
  provider: GenerationProvider
  telemetryContext?: ProviderCallContext
  timeoutMs?: number
}): Promise<{ contract: StoryContract; contractSource: ContractSource }> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
  validateTimeout(timeoutMs)
  const tasteSnapshot = createTasteSnapshotV2(input.tasteJson)
  const providerInput = (repairErrors?: string[]): StoryContractInput => ({
    storyId: input.storyId,
    tasteJson: structuredClone(tasteSnapshot),
    ...(repairErrors ? { repairErrors: structuredClone(repairErrors) } : {}),
  })

  try {
    let firstValidation: ReturnType<typeof parseRequestedContract> | undefined
    let raw: unknown
    try {
      raw = await generateWithinBudget(
        input.provider,
        providerInput(),
        timeoutMs,
        input.telemetryContext
          ? {
              telemetryContext: input.telemetryContext,
              workflowPhase: 'STORY_CONTRACT_INITIAL',
              consume: (candidate) => {
                const parsed = parseRequestedContract(candidate, input.storyId)
                if (!parsed.success) {
                  throw new InvalidModelResponseError(
                    'Story contract response failed validation.',
                    issueStrings(parsed.error),
                    candidate,
                  )
                }
                return candidate
              },
            }
          : undefined,
      )
    } catch (error) {
      if (!(error instanceof InvalidModelResponseError)) throw error
      raw = error.rejectedValue
      firstValidation = parseRequestedContract(raw, input.storyId)
    }
    const first = firstValidation ?? parseRequestedContract(raw, input.storyId)
    if (first.success) return { contract: first.data, contractSource: 'llm' }

    const repairedRaw = await generateWithinBudget(
      input.provider,
      providerInput(issueStrings(first.error)),
      timeoutMs,
      input.telemetryContext
        ? {
            telemetryContext: input.telemetryContext,
            workflowPhase: 'STORY_CONTRACT_REPAIR',
            consume: (candidate) => {
              const parsed = parseRequestedContract(candidate, input.storyId)
              if (!parsed.success) {
                throw new InvalidModelResponseError(
                  'Story contract repair failed validation.',
                  issueStrings(parsed.error),
                  candidate,
                )
              }
              return candidate
            },
          }
        : undefined,
    )
    const repaired = parseRequestedContract(repairedRaw, input.storyId)
    if (repaired.success) return { contract: repaired.data, contractSource: 'llm_repaired' }
  } catch {
    // Provider absence, rejection, or timeout must not fail story creation.
  }

  return {
    contract: mapTasteSnapshotToTemplate(tasteSnapshot, input.storyId),
    contractSource: 'template_fallback',
  }
}
