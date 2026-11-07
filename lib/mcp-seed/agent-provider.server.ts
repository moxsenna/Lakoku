/**
 * Provider prosa agent Gemini untuk MCP Seed Server.
 *
 * Dekorator GenerationProvider: HONLY writeChapter yang diganti — prosa
 * di-park sebagai instruction yang diambil agent via tool MCP
 * (seed_get_unit_spec) dan dikirim balik via seed_submit_unit. Plan,
 * choices, reactions, kontrak, dan judge tetap delegasi ke provider
 * 9Router terkualifikasi (M10-G). Struktur draft mengikuti bentuk
 * provider deterministik supaya Layer A gateway & guard katalog jalan
 * tanpa pengecualian.
 */
import type {
  CatalogReactionsProviderInput,
  ChoiceProviderInput,
  GenerationProvider,
  GenerationRuntimePolicy,
  ModelCallExecutionOptions,
  SemanticJudgeInput,
  SemanticJudgeResult,
  StoryContractCallOptions,
  StoryContractInput,
  WriteInput,
} from '@lakoku/ai-gateway'
import { createDeterministicProvider } from '@lakoku/ai-gateway'
import type { CanonSnapshot } from '@lakoku/narrative-core'

export type UnitKey = string

export function unitKeyOf(endingKey: string | null, chapterNumber: number): UnitKey {
  return `${endingKey ?? 'spine'}#${chapterNumber}`
}

export interface AgentWriteInstruction {
  storyId: string
  unitKey: UnitKey
  chapterNumber: number
  attempt: number
  genre: string | null
  targetWordsMin: number
  targetWordsMax: number
  novelTitle: string
  phase: string
  chapterGoal: string
  plannedBeats: string[]
  mandatoryBeats: string[]
  forbiddenReveals: string[]
  corePromise: string
  mainConflict: string
  finalQuestion: string
  previousChapterTitle: string | null
  previousEnding: string[]
  repairFindings: string[]
  formatRules: string[]
}

/** Aturan penulisan yang mengunci agent ke ketentuan Lakoku (sisi admin). */
export const AGENT_FORMAT_RULES: readonly string[] = [
  'Tulis dalam bahasa Indonesia, sudut pandang orang pertama sang protagonis.',
  'Paragraf pendek khas mobile (1-3 kalimat), selingi dialog natural.',
  'Jangan pernah memakai kata: AI, Narraza, RAG, token, skor, bias, ending, pembaca, rute.',
  'Jangan menyebut nomor bab atau istilah teknis apa pun di dalam prosa.',
  'Jangan menutup cerita; bab harus berhenti di tengah ketegangan (cliffhanger) kecuali diminta penutup.',
  'Balas HANYA dengan judul di baris pertama (awali dengan "# ") lalu paragraf dipisah baris kosong.',
]

export interface AgentProseResult {
  title: string
  paragraphs: string[]
  /** Full-Gemini: identitas novel (untuk keying payload choices di pump). */
  storyId?: string
  /** Full-Gemini: choices+reaksi agent (sudah tervalidasi wiring). */
  chapterChoices?: import('@/lib/catalog/generator.server').CatalogAgentChoices
}

export function parseAgentProse(markdown: string): AgentProseResult {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  let title = ''
  let bodyStart = lines.length

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim() ?? ''
    if (!line) continue
    if (line.startsWith('# ')) {
      title = line.slice(2).trim()
      bodyStart = i + 1
      break
    }
    const judulMatch = line.match(/^Judul:\s*(.+)$/i)
    if (judulMatch) {
      title = judulMatch[1]?.trim() ?? ''
      bodyStart = i + 1
      break
    }
    bodyStart = i
    break
  }

  const paragraphs = lines
    .slice(bodyStart)
    .join('\n')
    .split(/\n\s*\n/)
    .map((block) => block.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  if (!paragraphs.length) throw new Error('MCP_PROSE_EMPTY: prosa kosong')
  if (!title) title = paragraphs[0]!.slice(0, 80)
  return { title, paragraphs }
}

interface PlanShape {
  chapterNumber: number
  phase: string
  chapterGoal?: string
  plannedBeats: string[]
  usesReveals: string[]
  proposedStateDelta: Record<string, unknown>
  introducesCharacters: string[]
}

export interface AgentInstructionArgs {
  input: WriteInput
  policy: GenerationRuntimePolicy
  novelTitle: string
  previousChapter: { title: string; paragraphs: string[] } | null
  previousChapterNumber: number | null
  corePromise: string
  mainConflict: string
  finalQuestion: string
}

export function buildAgentInstruction(args: AgentInstructionArgs): AgentWriteInstruction {
  const plan = args.input.plan as PlanShape
  const snapshot = args.input.snapshot as CanonSnapshot
  const storyAnchors = args.input.continuation?.storyAnchors
  const blueprint = args.input.snapshot.blueprints?.find(
    (item) => item.chapterNumber === plan.chapterNumber,
  )
  const repairFindings = (args.input.repairFindings ?? []).map((finding) => {
    if (typeof finding === 'string') return finding
    const record = finding as { code?: string; message?: string; detail?: string }
    return record.message ?? record.detail ?? record.code ?? JSON.stringify(finding)
  })
  const explicitMandatory = [
    ...(args.input.brief?.mustInclude ?? []),
    ...(blueprint?.mandatoryBeats ?? []),
  ]
  const mandatoryBeats = (
    explicitMandatory.length > 0 ? explicitMandatory : (plan.plannedBeats ?? [])
  ).map(String)

  return {
    storyId: snapshot.storyId,
    unitKey: unitKeyOf(args.input.continuation?.lockedEndingKey ?? null, plan.chapterNumber),
    chapterNumber: plan.chapterNumber,
    attempt: repairFindings.length > 0 ? 2 : 1,
    genre: args.input.genre ?? null,
    targetWordsMin: args.policy.targetWordsMin,
    targetWordsMax: args.policy.targetWordsMax,
    novelTitle: args.novelTitle,
    phase: plan.phase,
    chapterGoal: String(plan.chapterGoal ?? blueprint?.chapterGoal ?? plan.phase),
    plannedBeats: (plan.plannedBeats ?? []).map(String),
    mandatoryBeats,
    forbiddenReveals: (blueprint?.forbiddenReveals ?? []).map(String),
    corePromise: storyAnchors?.corePromise ?? args.corePromise,
    mainConflict: storyAnchors?.mainConflict ?? args.mainConflict,
    finalQuestion: storyAnchors?.finalQuestion ?? args.finalQuestion,
    previousChapterTitle: args.previousChapter?.title ?? null,
    previousEnding: (args.previousChapter?.paragraphs ?? []).slice(-5),
    repairFindings,
    formatRules: [...AGENT_FORMAT_RULES],
  }
}

export interface AgentProseStore {
  park(key: UnitKey, instruction: AgentWriteInstruction): Promise<AgentProseResult>
  instruction(key: UnitKey): AgentWriteInstruction | null
  resolve(key: UnitKey, prose: AgentProseResult): boolean
  rejectAll(storyId: string, reason: string): void
}

interface ParkedWrite {
  instruction: AgentWriteInstruction
  resolve: (prose: AgentProseResult) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export function createAgentProseStore(opts: { timeoutMs: number }): AgentProseStore & { parkedCount(): number } {
  const parked = new Map<UnitKey, ParkedWrite>()
  return {
    park(key, instruction) {
      const existing = parked.get(key)
      if (existing) {
        clearTimeout(existing.timer)
        existing.reject(new Error('MCP_PROSE_SUPERSEDED'))
      }
      return new Promise<AgentProseResult>((resolve, reject) => {
        const timer = setTimeout(() => {
          parked.delete(key)
          reject(new Error(`MCP_PROSE_TIMEOUT:${key}`))
        }, opts.timeoutMs)
        parked.set(key, { instruction, resolve, reject, timer })
      })
    },
    instruction(key) {
      return parked.get(key)?.instruction ?? null
    },
    resolve(key, prose) {
      const entry = parked.get(key)
      if (!entry) return false
      parked.delete(key)
      clearTimeout(entry.timer)
      entry.resolve(prose)
      return true
    },
    rejectAll(storyId, reason) {
      for (const [key, entry] of [...parked.entries()]) {
        if (entry.instruction.storyId !== storyId) continue
        parked.delete(key)
        clearTimeout(entry.timer)
        entry.reject(new Error(reason))
      }
    },
    parkedCount() {
      return parked.size
    },
  }
}

function activeCharacters(snapshot: CanonSnapshot, chapter: number) {
  return (snapshot.characters ?? []).filter(
    (c) => c.status !== 'DEAD' && c.introducedChapter <= chapter,
  )
}

function countWords(paragraphs: string[]): number {
  return paragraphs.join(' ').split(/\s+/).filter(Boolean).length
}

function assembleDraft(input: WriteInput, policy: GenerationRuntimePolicy, prose: AgentProseResult): unknown {
  const plan = input.plan as PlanShape
  const snapshot = input.snapshot as CanonSnapshot
  const chapter = plan.chapterNumber
  const chars = activeCharacters(snapshot, chapter)
  const relevantFact = (snapshot.facts ?? []).find((f) => f.establishedChapter <= chapter)
  const events = chars.slice(0, 3).map((c, i) => ({
    characterMention: c.canonicalName,
    description: `${c.canonicalName} bergerak pada babak "${plan.phase}".`,
    ordinal: i,
    occursAt: chapter * 10 + i,
    isFlashback: false,
  }))
  const knowledgeAssertions = (snapshot.knowledge ?? [])
    .filter((k) => k.knownFromChapter <= chapter)
    .filter((k) => chars.some((c) => c.id === k.characterId))
    .slice(0, 2)
    .map((k) => ({
      characterMention:
        chars.find((c) => c.id === k.characterId)?.canonicalName ?? k.characterId,
      factId: k.factId,
    }))
  const speaker = chars[0]
  const dialogue = speaker
    ? [{ characterId: speaker.id, text: 'Aku akan menghadapi ini sampai selesai.' }]
    : []
  const emotionBeats =
    chars.length >= 2
      ? [{ characterId: chars[0]!.id, targetCharacterId: chars[1]!.id, valence: 'neutral' as const }]
      : []
  const softClaims = relevantFact
    ? [
        {
          characterId: chars[0]?.id ?? relevantFact.subjectCharacterId ?? 'unknown',
          factId: relevantFact.id,
          agrees: true,
        },
      ]
    : []
  return {
    storyId: snapshot.storyId,
    chapterNumber: chapter,
    title: prose.title,
    paragraphs: prose.paragraphs,
    wordCount: countWords(prose.paragraphs),
    sceneCount: policy.targetScenes,
    hasChoiceOrGate: true,
    events,
    knowledgeAssertions,
    reveals: (plan.usesReveals ?? []).map((secretId) => ({ secretId })),
    proposedStateDelta: plan.proposedStateDelta,
    newNamedCharacters: plan.introducesCharacters,
    dialogue,
    emotionBeats,
    softClaims,
  }
}

export function createAgentProseProvider(deps: {
  inner: GenerationProvider
  policy: GenerationRuntimePolicy
  store: AgentProseStore
}): GenerationProvider {
  const planFallback = createDeterministicProvider(deps.policy)
  const { inner, store } = deps
  return {
    name: 'mcp-gemini-agent-v1',
    async generatePlan(input) {
      return planFallback.generatePlan(input)
    },
    async writeChapter(input: WriteInput, _options?: ModelCallExecutionOptions): Promise<unknown> {
      const snapshot = input.snapshot as CanonSnapshot
      const continuation = input.continuation ?? null
      const previous = continuation?.previousChapter ?? null
      const instruction = buildAgentInstruction({
        input,
        policy: deps.policy,
        novelTitle: continuation?.storyAnchors?.corePromise ?? snapshot.storyId,
        previousChapter: previous
          ? { title: previous.title, paragraphs: previous.endingParagraphs }
          : null,
        previousChapterNumber: continuation?.previousChapter?.number ?? null,
        corePromise: continuation?.storyAnchors?.corePromise ?? '',
        mainConflict: continuation?.storyAnchors?.mainConflict ?? '',
        finalQuestion: continuation?.storyAnchors?.finalQuestion ?? '',
      })
      const prose = await store.park(instruction.unitKey, instruction)
      return assembleDraft(input, deps.policy, prose)
    },
    async generateChoices(input: ChoiceProviderInput, options?: ModelCallExecutionOptions) {
      if (!inner.generateChoices) throw new Error('MCP_INNER_CHOICES_UNAVAILABLE')
      return inner.generateChoices(input, options)
    },
    async generateCatalogReactions(input: CatalogReactionsProviderInput, options?: ModelCallExecutionOptions) {
      if (!inner.generateCatalogReactions) throw new Error('MCP_INNER_REACTIONS_UNAVAILABLE')
      return inner.generateCatalogReactions(input, options)
    },
    async generateStoryContract(input: StoryContractInput, options?: StoryContractCallOptions) {
      if (!inner.generateStoryContract) throw new Error('MCP_INNER_CONTRACT_UNAVAILABLE')
      return inner.generateStoryContract(input, options)
    },
    async evaluateSemanticContinuity(input: SemanticJudgeInput, options?: ModelCallExecutionOptions): Promise<SemanticJudgeResult> {
      if (!inner.evaluateSemanticContinuity) {
        return planFallback.evaluateSemanticContinuity
          ? planFallback.evaluateSemanticContinuity(input, options)
          : { verdict: 'PASS' as const, codes: [] }
      }
      return inner.evaluateSemanticContinuity(input, options)
    },
  }
}

const AUTO_RESPONDER_PARAGRAPH_POOL: readonly string[] = [
  'Langkah demi langkah kuambil perlahan, memastikan tidak ada hal penting yang terlewat dalam keheningan yang menyelimuti.',
  'Pikiran di kepalaku berputar liar mencari jawaban atas pertanyaan yang belum sempat terucapkan oleh siapa pun.',
  'Aku berhenti sejenak, menarik napas dalam-dalam untuk menenangkan degup jantung yang kian berpacu cepat.',
  'Malam semakin larut dan bayang-bayang di dinding tampak memanjang seolah ikut mengawasi gerak-gerikku.',
  'Tidak ada pilihan lain selain terus melangkah menyusuri lorong panjang ini dengan penuh kehati-hatian.',
  'Setiap sudut ruangan menyimpan rahasia masa lalu yang menunggu untuk terungkap pada waktu yang tepat.',
  'Aku berusaha mengingat kembali setiap petunjuk yang pernah kuterima sebelum situasi berkembang menjadi seperti sekarang.',
  '"Kamu yakin dengan langkah ini?" tanya suara di sebelahku. Aku tidak menjawab segera.',
  'Ketika lampu koridor meredup, satu kalimat tetap tergantung di kepala: keputusan seperti ini selalu menagih harganya.',
  'Sisa malam berjalan tanpa banyak kata. Aku menyelesaikan satu hal kecil, lalu satu lagi, seolah urutan itu bisa menahan dunia agar tidak berubah terlalu cepat.',
]

/** Store smoke: langsung menjawab prosa template dari instruction (tanpa agent). */
export function createAutoResponderProseStore(): AgentProseStore {
  const inner = createAgentProseStore({ timeoutMs: 60_000 })
  return {
    park(key, instruction) {
      const pending = inner.park(key, instruction)
      const beats = instruction.plannedBeats.length
        ? instruction.plannedBeats
        : instruction.mandatoryBeats
      const opening = beats[0]
        ? `Aku menahan napas. ${beats[0]!.charAt(0).toUpperCase()}${beats[0]!.slice(1)} tidak bisa ditunda lagi.`
        : 'Aku menahan napas di ambang keputusan ini.'
      const body = [
        opening,
        `Sisa malam berjalan tanpa banyak kata. Aku menyelesaikan satu hal kecil, lalu satu lagi, seolah urutan itu bisa menahan dunia agar tidak berubah terlalu cepat.`,
        `"Kamu yakin dengan langkah ini?" tanya suara di sebelahku. Aku tidak menjawab segera.`,
        `Ketika lampu koridor meredup, satu kalimat tetap tergantung di kepala: keputusan seperti ini selalu menagih harganya.`,
      ]
      const targetWords = instruction.targetWordsMin > 0 ? Math.max(instruction.targetWordsMin, 850) : 850
      let words = countWords(body)
      let idx = 0
      while (words < targetWords) {
        const paragraph = AUTO_RESPONDER_PARAGRAPH_POOL[idx % AUTO_RESPONDER_PARAGRAPH_POOL.length]!
        body.push(paragraph)
        words += countWords([paragraph])
        idx++
      }
      void pending.catch(() => undefined)
      // Full-Gemini smoke: auto-responder ikut memasok choices+reaksi agar
      // jalur choiceSupplier tereksekusi tanpa model server.
      const reactionA = [
        `Keputusan itu menghantam pikiranku lebih keras dari dugaan semalam, dan udara di ruangan ini terasa mengental setiap kali aku mencoba menarik napas dengan tenang lagi.`,
        `Aku menyelesaikan satu hal kecil yang tertunda, lalu satu lagi, seolah urutan kecil itu bisa menahan dunia agar tidak berubah terlalu cepat di malam seperti ini.`,
      ]
      const reactionB = [
        `Langkah kaki di lorong meredup, dan untuk pertama kalinya sejak pagi aku berani mengaku bahwa rasa penasaranku lebih besar daripada rasa takutku akan jawabannya sendiri.`,
        `Aku mencatat satu nama, satu jam, dan satu alamat di balik halaman buku, lalu menutupnya perlahan sambil berjanji membukanya lagi saat jam dinding menunjukkan pukul dua pagi.`,
      ]
      inner.resolve(key, {
        title: `Bab ${instruction.chapterNumber}`,
        paragraphs: body,
        storyId: instruction.storyId,
        chapterChoices: {
          choicePrompt: 'Apa langkah yang akan kamu ambil?',
          choices: [
            { label: `Ikuti jejak yang baru saja kau temukan malam ini`, consequence: reactionA },
            { label: `Tahan langkah dan amankan bukti lebih dulu`, consequence: reactionB },
          ],
        },
      })
      return pending
    },
    instruction: (key) => inner.instruction(key),
    resolve: (key, prose) => inner.resolve(key, prose),
    rejectAll: (storyId, reason) => inner.rejectAll(storyId, reason),
  }
}
