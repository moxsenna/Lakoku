/**
 * M10-A Task 2 — Story-contract field propagation detectors.
 *
 * Traces StoryContract fields (corePromise, mainConflict, finalQuestion,
 * chapterTargets[n], emotionalTurn, expectedThreadMovement, plotDebts,
 * endingCandidates, closureRunway, ...) through ChapterBrief -> PreProseBrief ->
 * ContinuationContext -> writer prompt, using trace records derived from reading
 * the real code. Findings are emitted per trace record; the default trace table
 * below encodes the code-reading conclusions as DATA, so the detectors stay
 * deterministic and testable.
 *
 * Evidence cited (source strings):
 *   - lib/story-engine/story-contract.ts :: StoryContractSchema — the declared
 *     contract surface (chapterTargets.length(50), plotDebts, endingCandidates,
 *     closureRunway, revealRunway, corePromise/mainConflict/finalQuestion).
 *   - lib/story-engine/chapter-brief.ts :: buildChapterBrief — maps chapterTargets
 *     goal/mustInclude/emotionalTurn/expectedThreadMovement into mustInclude,
 *     closureRunway into allowedNewThread/allowedMajorNewConflict/endingRunway/
 *     lockEnding, plotDebts into plotDebtsToProgress/plotDebtsToClose,
 *     resolveEnding(endingCandidates) into lockedEndingKey.
 *   - lib/story-engine/pre-prose-brief.ts :: buildPreProseChapterBrief — consumes
 *     brief.chapterGoal, mustNotInclude, mustNotReveal, routeStateSummary,
 *     lockedEndingKey; previousChoice hierarchy.
 *   - lib/ai-gateway/gateway-provider.ts :: buildPrompt — the writer prompt is
 *     built ONLY from `plan` + `continuation`; the ChapterBrief/PreProseChapterBrief
 *     is NOT passed into buildWriterPrompt, so brief-only fields (plotDebtsToProgress/
 *     ToClose, endingRunway) never appear in the writer prompt.
 *   - lib/prose/prompt-engine/build-writer-prompt.ts :: buildWriterPrompt — M10-A
 *     closure (GLOBAL_STORY_ANCHOR_NOT_DIRECTLY_PROPAGATED + locked-ending): layer
 *     1a renders storyAnchors (Janji Inti Cerita / Konflik Utama / Pertanyaan Akhir,
 *     finalQuestion emphasized at ch >= 45) and the locked-ending invariant
 *     ("ENDING SUDAH TERKUNCI pada ...") from continuationContext.
 *   - lib/narrative/loader.ts :: persistRetrievalLog — write function exists and is
 *     wired into deps, but has NO production call sites (see RETRIEVAL_LOG finder).
 *   - lib/narrative/compiler.ts :: ChapterContextPacket — carries actRollups and
 *     contextBudgetReport; lib/narrative/continuation-context.ts :: buildContinuationContext
 *     projects storyAnchors, actRollups, lockedEndingKey (all now consumed by the
 *     writer) but still drops contextBudgetReport and storyContractSummary before
 *     the writer prompt.
 */

import type {
  AuditSeverity,
  StoryBibleAuditFinding,
  StructuredEvidence,
} from './story-bible-audit-contract'

export interface ContractFieldTrace {
  field: string
  /** Declared on the persisted story contract (StoryContractSchema). */
  persisted: boolean
  /** Reaches ChapterBrief (buildChapterBrief output). */
  inChapterBrief: boolean
  /** Reaches PreProseChapterBrief. */
  inPreProseBrief: boolean
  /** Reaches ContinuationContext (projected from the compiled packet). */
  inContinuation: boolean
  /** Appears in the writer prompt (buildWriterPrompt output). */
  inWriterPrompt: boolean
  /** Evidence note for this field's path. */
  note: string
}

/**
 * Default trace table — conclusions from reading the production code, expressed
 * as data. Consumers (tests/CLI/reports) may override per field.
 */
export const DEFAULT_CONTRACT_FIELD_TRACES: ContractFieldTrace[] = [
  {
    field: 'corePromise',
    persisted: true,
    inChapterBrief: false,
    inPreProseBrief: false,
    inContinuation: true,
    inWriterPrompt: true,
    note: 'StoryContractSchema declares it; contract-persistence.server.ts persists it into voice sample_lines; M10-A closure: loadStoryAnchors resolves it into ContinuationContext.storyAnchors and buildWriterPrompt layer 1a renders "Janji Inti Cerita".',
  },
  {
    field: 'mainConflict',
    persisted: true,
    inChapterBrief: false,
    inPreProseBrief: false,
    inContinuation: true,
    inWriterPrompt: true,
    note: 'Persisted into facts_ledger (contract-persistence.server.ts); M10-A closure: propagates via ContinuationContext.storyAnchors -> layer 1a "Konflik Utama (harus tetap terasa di bab ini)".',
  },
  {
    field: 'finalQuestion',
    persisted: true,
    inChapterBrief: false,
    inPreProseBrief: false,
    inContinuation: true,
    inWriterPrompt: true,
    note: 'Persisted into facts_ledger and referenced by secret rows; M10-A closure: ContinuationContext.storyAnchors -> layer 1a renders it, emphasized "PERTANYAAN AKHIR (WAJIB diarahkan ke jawaban, ending mendekat)" at ch >= 45.',
  },
  {
    field: 'chapterTargets[n]',
    persisted: true,
    inChapterBrief: true,
    inPreProseBrief: true,
    inContinuation: false,
    inWriterPrompt: true,
    note: 'buildChapterBrief maps target.goal -> chapterGoal, mustInclude/emotionalTurn/expectedThreadMovement -> mustInclude; goal flows brief -> preProse -> plan -> writer layer 4.',
  },
  {
    field: 'emotionalTurn',
    persisted: true,
    inChapterBrief: true,
    inPreProseBrief: false,
    inContinuation: false,
    inWriterPrompt: true,
    note: 'Folded into ChapterBrief.mustInclude (buildChapterBrief line ~276); reaches writer via plan beats/goal, losing its distinct identity.',
  },
  {
    field: 'expectedThreadMovement',
    persisted: true,
    inChapterBrief: true,
    inPreProseBrief: false,
    inContinuation: false,
    inWriterPrompt: true,
    note: 'Folded into ChapterBrief.mustInclude (line ~277); same identity-loss as emotionalTurn.',
  },
  {
    field: 'plotDebts',
    persisted: true,
    inChapterBrief: true,
    inPreProseBrief: false,
    inContinuation: false,
    inWriterPrompt: false,
    note: 'plotDebtsToProgress/plotDebtsToClose land on the brief; preProse drops them and buildWriterPrompt has no debt section (writer layer 3 renders timeline/facts/threads/rollups only) — known residual gap, see M10-B trade-off.',
  },
  {
    field: 'endingCandidates',
    persisted: true,
    inChapterBrief: true,
    inPreProseBrief: true,
    inContinuation: false,
    inWriterPrompt: false,
    note: 'resolveEnding picks lockedEndingKey -> brief.lockedEndingKey -> preProse -> continuation -> layer 1a "ENDING SUDAH TERKUNCI" line (M10-A closure); the candidate list itself stays brief-only.',
  },
  {
    field: 'closureRunway',
    persisted: true,
    inChapterBrief: true,
    inPreProseBrief: false,
    inContinuation: false,
    inWriterPrompt: false,
    note: 'Drives brief policy (allowedNewThread/allowedMajorNewConflict/endingRunway/lockEnding); never prompt-visible itself.',
  },
  {
    field: 'lockedEndingKey (reader_states)',
    persisted: true,
    inChapterBrief: true,
    inPreProseBrief: true,
    inContinuation: true,
    inWriterPrompt: true,
    note: 'M10-A closure: buildContinuationContext projects lockedEndingKey and buildWriterPrompt layer 1a renders "ENDING SUDAH TERKUNCI pada <key>. Semua pilihan/akibat bab ini harus mengarah ke ending tersebut." when present.',
  },
]

export const PROPAGATION_AUDIT_EVIDENCE: StructuredEvidence[] = [
  {
    source: 'lib/story-engine/story-contract.ts :: StoryContractSchema',
    evidenceClass: 'SCHEMA_CONTRACT',
    observation:
      'Declares corePromise (800), mainConflict (800), finalQuestion (500), chapterTargets (exactly 50, each with goal/mustInclude/mustNotReveal/emotionalTurn/expectedThreadMovement), plotDebts, endingCandidates (2..8), closureRunway, revealRunway.',
  },
  {
    source: 'lib/story-engine/chapter-brief.ts :: buildChapterBrief',
    evidenceClass: 'SOURCE_TRACE',
    observation:
      'Consumes chapterTargets (goal, mustInclude, emotionalTurn, expectedThreadMovement, mustNotReveal), closureRunway (allowedNewThread/allowedMajorNewConflict/endingRunway/lockEnding), plotDebts (plotDebtsToProgress/ToClose), endingCandidates via resolveEnding -> lockedEndingKey.',
  },
  {
    source: 'lib/ai-gateway/gateway-provider.ts :: buildPrompt',
    evidenceClass: 'SOURCE_TRACE',
    observation:
      'buildWriterPrompt is called with ONLY plan-derived fields + continuation; the ChapterBrief / PreProseChapterBrief object is not passed to the prompt builder at all (grep: no `brief` reference in gateway-provider.ts). Anchor/ending propagation therefore rides continuationContext (M10-A closure), and brief-only fields (plotDebtsToProgress/ToClose, endingRunway) still die before the prompt.',
  },
  {
    source: 'lib/prose/prompt-engine/build-writer-prompt.ts :: buildWriterPrompt',
    evidenceClass: 'SOURCE_TRACE',
    observation:
      'M10-A closure: layer 1a renders storyAnchors (corePromise "Janji Inti Cerita", mainConflict "Konflik Utama", finalQuestion — emphasized "PERTANYAAN AKHIR (WAJIB diarahkan ke jawaban, ending mendekat)" when chapter >= 45) and the locked-ending line "ENDING SUDAH TERKUNCI pada ..." when continuationContext.lockedEndingKey is present.',
  },
  {
    source: 'lib/narrative/loader.ts :: persistRetrievalLog',
    evidenceClass: 'SOURCE_TRACE',
    observation:
      'Write function exists (append-only insert into retrieval_logs, failures ignored) and is wired into PersonalizedGenerationDeps.defaultDeps, but no production call site invokes it.',
  },
  {
    source: 'lib/narrative/compiler.ts :: ChapterContextPacket / lib/narrative/continuation-context.ts :: buildContinuationContext',
    evidenceClass: 'SOURCE_TRACE',
    observation:
      'Packet carries actRollups + contextBudgetReport + storyContractSummary; buildContinuationContext projects loadBearingFacts, relevantFacts, activeThreads, recentTimeline, routeStateSummary, mustNotReveal, storyAnchors, actRollups, lockedEndingKey — actRollups are consumed by the writer layer-3 "Ringkasan Babak Terlewati" section, but contextBudgetReport and storyContractSummary still never reach the writer prompt.',
  },
]

export interface PropagationInput {
  traces?: ContractFieldTrace[]
  /** Claimed write-path flags; defaults encode the code-reading result. */
  retrievalLogInvoked?: boolean
  retrievalLogConsumers?: string[]
  contextPacketConsumerProven?: boolean
}

/**
 * Global story anchors whose HIGH findings carry the renamed code
 * GLOBAL_STORY_ANCHOR_NOT_DIRECTLY_PROPAGATED (reviewer correction: the old
 * code DEPENDENCY_DECLARED_BUT_UNUSED mis-described the finding — these anchors
 * CAN influence the story contract/chapter targets at bootstrap; they are
 * persisted into canon but never propagated into the writer prompt).
 */
export const GLOBAL_STORY_ANCHOR_FIELDS = new Set([
  'corePromise',
  'mainConflict',
  'finalQuestion',
])

/**
 * Emit propagation findings.
 * - GLOBAL_STORY_ANCHOR_NOT_DIRECTLY_PROPAGATED (HIGH): corePromise /
 *   mainConflict / finalQuestion are persisted but never reach the writer
 *   prompt directly; they only shape the story at bootstrap (via contract /
 *   chapter targets) and must also surface in the final act (finalQuestion
 *   becomes critical at 45–50).
 * - DEPENDENCY_DECLARED_BUT_UNUSED: non-anchor fields persisted but never
 *   prompt-visible; MEDIUM when the field reaches a brief but dies before
 *   the prompt (death-between-brief-and-prompt variant).
 * - RETRIEVAL_LOG_WRITE_PATH_UNPROVEN: retrieval_logs write function exists but no
 *   invocation found in production code.
 * - CONTEXT_PACKET_CONSUMER_UNPROVEN: compiled packet sections (act rollups,
 *   budget report) are not consumed by the writer path.
 */
export function auditPropagation(input: PropagationInput = {}): StoryBibleAuditFinding[] {
  const findings: StoryBibleAuditFinding[] = []
  const traces = input.traces ?? DEFAULT_CONTRACT_FIELD_TRACES

  for (const trace of traces) {
    if (!trace.persisted || trace.inWriterPrompt) continue

    const isGlobalAnchor = GLOBAL_STORY_ANCHOR_FIELDS.has(trace.field)

    if (!trace.inChapterBrief && !trace.inPreProseBrief && !trace.inContinuation) {
      const code = isGlobalAnchor
        ? 'GLOBAL_STORY_ANCHOR_NOT_DIRECTLY_PROPAGATED'
        : 'DEPENDENCY_DECLARED_BUT_UNUSED'
      findings.push(baseFinding(
        code,
        'HIGH',
        {
          detail: { field: trace.field, trace },
          risk: isGlobalAnchor
            ? `Global story anchor "${trace.field}" is persisted (contract-persistence.server.ts) but never propagated directly to the writer prompt. It DOES influence the story at bootstrap (story contract + chapterTargets are derived from it), but once chapters run the writer prompt never sees it${trace.field === 'finalQuestion' ? ' — finalQuestion is the most critical anchor for chapters 45–50 (the finale must answer it explicitly)' : ''}.`
            : `Contract field "${trace.field}" is persisted but never reaches ChapterBrief, PreProseBrief, ContinuationContext, or the writer prompt. It is declared in StoryContractSchema and persisted (contract-persistence.server.ts) yet invisible to generation.`,
          followUp: isGlobalAnchor
            ? `Propagate "${trace.field}" directly into the writer prompt (or into ContinuationContext) so generation at every chapter — and the finale — can reference it, instead of relying on bootstrap-only influence.`
            : `Decide the real consumer for "${trace.field}" or drop it from the contract surface.`,
        },
      ))
    } else if (!trace.inWriterPrompt) {
      findings.push(baseFinding(
        'DEPENDENCY_DECLARED_BUT_UNUSED',
        'MEDIUM',
        {
          detail: { field: trace.field, trace },
          risk: `Contract field "${trace.field}" propagates to a brief but never reaches the writer prompt (buildWriterPrompt receives only plan + continuation). ${trace.note}`,
          followUp: `Bridge "${trace.field}" into ContinuationContext or the writer prompt, or record the intentional omission.`,
        },
      ))
    }
  }

  // --- Retrieval log write path ---
  if (input.retrievalLogInvoked === false) {
    findings.push(baseFinding(
      'RETRIEVAL_LOG_WRITE_PATH_UNPROVEN',
      'INFO',
      {
        detail: { consumers: input.retrievalLogConsumers ?? [] },
        risk: 'persistRetrievalLog (lib/narrative/loader.ts) is defined and wired into PersonalizedGenerationDeps but never invoked in production code — excluded/included ids and budget reports are computed by compileContext and then dropped.',
        followUp: 'Invoke persistRetrievalLog after compileContext in the generation path (personalized + standard) so exclusions become observable.',
      },
    ))
  }

  // --- Context packet consumer ---
  if (input.contextPacketConsumerProven === false) {
    findings.push(baseFinding(
      'CONTEXT_PACKET_CONSUMER_UNPROVEN',
      'INFO',
      {
      detail: { packetSectionsDropped: ['contextBudgetReport', 'storyContractSummary'] },
      risk: 'ChapterContextPacket sections (contextBudgetReport, storyContractSummary) are compiled but buildContinuationContext does not project them — actRollups were closed (writer layer 3 consumes them), yet the budget report and contract summary still never reach the writer prompt.',
      followUp: 'Either feed the budget report / contract summary into the continuation/writer layer or remove them from the packet contract.',
      },
    ))
  }

  return findings
}

function baseFinding(
  code: string,
  severity: AuditSeverity,
  args: { detail: Record<string, unknown>; risk: string; followUp: string },
): StoryBibleAuditFinding {
  return {
    code,
    severity,
    domain: 'Story Contract',
    status: severity === 'HIGH' ? 'WRITE_PATH_UNPROVEN' : 'CONSUMER_UNPROVEN',
    sourceOfTruth: ['story_generation_contracts'],
    producers: ['lib/story-engine/story-contract.ts :: StoryContractSchema', 'lib/story-engine/chapter-brief.ts :: buildChapterBrief'],
    consumers: ['lib/story-engine/pre-prose-brief.ts :: buildPreProseChapterBrief', 'lib/ai-gateway/gateway-provider.ts :: buildPrompt'],
    validators: ['lib/ai-gateway/gateway.ts :: generatePlan (plan schema)'],
    evidence: [
      ...PROPAGATION_AUDIT_EVIDENCE,
      {
        source: `lib/narrative-qa/propagation-audit.ts :: ${code}`,
        evidenceClass: 'PURE_CHARACTERIZATION',
        observation: `Detector emitted from trace data: ${JSON.stringify(args.detail)}`,
      } satisfies StructuredEvidence,
    ],
    risk: args.risk,
    recommendedFollowUp: args.followUp,
  }
}
