import { describe, expect, it } from 'vitest'
import { misteriDramaContract } from '@/fixtures/contracts/misteri-drama'
import { computeSha256, stableStringify } from '@/lib/narrative-qa/scoring/canonical-serializer'
import {
  WRITER_QUALIFICATION_FIXTURE_V2,
  assertQualificationFixtureV2,
  buildWriterQualificationFixtureV2,
  computeQualificationFixtureV2Hashes,
  deriveQualificationFixtureV2SemanticSummary,
  type QualificationFixtureV2ValidationInput,
} from '@/fixtures/writer-qualification/v2'

function cloneInput(
  input: QualificationFixtureV2ValidationInput,
): QualificationFixtureV2ValidationInput {
  return structuredClone(input)
}

function issueCodes(input: QualificationFixtureV2ValidationInput): string[] {
  return assertQualificationFixtureV2(input).issues.map((issue) => issue.code)
}

function evidenceHash(domain: string, value: unknown): string {
  return computeSha256(`${domain}\0${stableStringify(value)}`)
}

describe('WRITER_QUALIFICATION_FIXTURE_V2', () => {
  it('builds five production-builder fixtures with a clean CHAPTER_BRIEF_V2 projection', async () => {
    const built = await buildWriterQualificationFixtureV2()
    const result = assertQualificationFixtureV2(built.validationInput)

    expect(built.manifest.track).toBe('WRITER_QUALIFICATION_FIXTURE_V2')
    expect(built.manifest.fixtureKeys).toEqual([
      'EARLY',
      'DIALOGUE',
      'MYSTERY',
      'EMOTIONAL',
      'LATER_ACT',
    ])
    expect(result.sourceValid).toBe(true)
    expect(result.schemaTraversalPassed).toBe(true)
    expect(result.builderTraversalPassed).toBe(true)
    expect(result.semanticSourcePassed).toBe(true)
    expect(result.issues).toEqual([])
    expect(built.manifest).toMatchObject({
      terminalVerdict: 'PROVISIONAL_VALIDATION_PASSED',
      qualificationAllowed: true,
      corpusBuilt: true,
      inferenceCount: 0,
      databaseCalls: 0,
      publicationCalls: 0,
    })
    expect(built.manifest.readyAuthorityManifestHash).toMatch(/^[a-f0-9]{64}$/)
    expect(built.manifest.fixtures.find((fixture) => fixture.key === 'LATER_ACT')).toMatchObject({
      persistedReaderLock: null,
      productionSelectedEndingLock: true,
      writerVisibleEndingLock: true,
    })
  })

  it('freezes fixture, provisional corpus, and projection hashes independently', async () => {
    const built = await buildWriterQualificationFixtureV2()

    expect(computeQualificationFixtureV2Hashes(built.validationInput)).toEqual({
      fixtureHashes: WRITER_QUALIFICATION_FIXTURE_V2.fixtureHashes,
      provisionalCorpusManifestHash: WRITER_QUALIFICATION_FIXTURE_V2.provisionalCorpusManifestHash,
      projectionValidationHash: WRITER_QUALIFICATION_FIXTURE_V2.projectionValidationHash,
      privacyValidationHash: WRITER_QUALIFICATION_FIXTURE_V2.privacyValidationHash,
    })
    expect(built.manifest.fixtureHashes).toEqual(WRITER_QUALIFICATION_FIXTURE_V2.fixtureHashes)
    expect(built.manifest.provisionalCorpusManifestHash)
      .toBe(WRITER_QUALIFICATION_FIXTURE_V2.provisionalCorpusManifestHash)
    expect(built.manifest.projectionValidationHash)
      .toBe(WRITER_QUALIFICATION_FIXTURE_V2.projectionValidationHash)
    expect(built.manifest.privacyValidationHash)
      .toBe(WRITER_QUALIFICATION_FIXTURE_V2.privacyValidationHash)
    expect(built.manifest.readyAuthorityManifestHash)
      .toBe(WRITER_QUALIFICATION_FIXTURE_V2.readyAuthorityManifestHash)
  })

  it('records representativeness and semantic summaries without raw prompt or private content', async () => {
    const { manifest } = await buildWriterQualificationFixtureV2()
    const serialized = JSON.stringify(manifest)

    expect(manifest.representativenessMatrix).toEqual([
      expect.objectContaining({ key: 'EARLY', chapterNumber: 1, referenceClass: 'OPENING_PRODUCTION_LIKE' }),
      expect.objectContaining({ key: 'DIALOGUE', chapterNumber: 8, referenceClass: 'DIALOGUE_PRODUCTION_LIKE' }),
      expect.objectContaining({ key: 'MYSTERY', chapterNumber: 12, referenceClass: 'SCHEDULED_REVEAL_PRODUCTION_LIKE' }),
      expect.objectContaining({ key: 'EMOTIONAL', chapterNumber: 25, referenceClass: 'MIDSTORY_EMOTIONAL_PRODUCTION_LIKE' }),
      expect.objectContaining({ key: 'LATER_ACT', chapterNumber: 45, referenceClass: 'ENDING_LOCK_PRODUCTION_LIKE' }),
    ])
    expect(manifest.semanticSummaries).toHaveLength(5)
    expect(serialized).not.toMatch(/writerEnvelope|systemPrompt|userPrompt|previousChapterParagraphs/i)
    expect(serialized).not.toContain('Sinta menerima buku besar kedai ibunya')
    expect(serialized).not.toContain('Hujan berhenti ketika Sinta meratakan kuitansi')
    expect(serialized).not.toMatch(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/)
  })

  it('binds every authority validation row to the exact V2 pre-prose production projection', async () => {
    const built = await buildWriterQualificationFixtureV2()

    for (const fixture of built.validationInput.fixtures) {
      const binding = (fixture.projection as unknown as {
        authorityBinding?: {
          fixtureHash: string
          chapterBriefHash: string
          preProseBriefHash: string
          planHash: string
          authorityMode: string
          briefBindingHash: string
          projectedObligationAuthorityIds: string[]
          writerDirectiveHashes: string[]
          forbiddenRevealIdentityHashes: string[]
          endingAuthorityProjectionHash: string | null
          writerVisibleInternalIdCount: number
          legacyFallbackUsed: boolean
        }
      }).authorityBinding
      const chapterBriefHash = fixture.provenance.stageEvidence.find(
        (evidence) => evidence.stage === 'buildChapterBrief',
      )?.outputHash
      const preProseHash = fixture.provenance.stageEvidence.find(
        (evidence) => evidence.stage === 'buildPreProseChapterBrief',
      )?.outputHash
      const planHash = fixture.provenance.stageEvidence.find(
        (evidence) => evidence.stage === 'generatePlan',
      )?.outputHash

      expect(binding).toMatchObject({
        fixtureHash: WRITER_QUALIFICATION_FIXTURE_V2.fixtureHashes[fixture.key],
        chapterBriefHash,
        preProseBriefHash: preProseHash,
        planHash,
        authorityMode: 'CHAPTER_BRIEF_V2',
        briefBindingHash: preProseHash,
        writerVisibleInternalIdCount: 0,
        legacyFallbackUsed: false,
      })
      expect(binding?.projectedObligationAuthorityIds).toEqual(expect.any(Array))
      expect(binding?.writerDirectiveHashes.every((hash) => /^[a-f0-9]{64}$/.test(hash))).toBe(true)
      expect(binding?.forbiddenRevealIdentityHashes.every((hash) => /^[a-f0-9]{64}$/.test(hash))).toBe(true)
    }
  })

  it('binds scheduled reveal identity internally and writer directive semantically', async () => {
    const built = await buildWriterQualificationFixtureV2()
    const mystery = built.validationInput.fixtures.find((fixture) => fixture.key === 'MYSTERY')!
    const binding = (mystery.projection as unknown as {
      authorityBinding?: {
        projectedObligationAuthorityIds: string[]
        writerDirectiveHashes: string[]
        writerVisibleInternalIdCount: number
      }
    }).authorityBinding

    expect(binding?.projectedObligationAuthorityIds).toContain('secret:ledger-author')
    expect(binding?.writerDirectiveHashes.length).toBeGreaterThan(0)
    expect(binding?.writerVisibleInternalIdCount).toBe(0)
    expect(mystery.projection.scheduledRevealWriterVisible).toBe(true)
    expect(deriveQualificationFixtureV2SemanticSummary(mystery).evidenceIds.revealPayoff)
      .toEqual(['reveal:secret:ledger-author'])
  })

  it('proves Bab 45 ending through structured metadata and semantic closure without raw key leakage', async () => {
    const built = await buildWriterQualificationFixtureV2()
    const later = built.validationInput.fixtures.find((fixture) => fixture.key === 'LATER_ACT')!
    const binding = (later.projection as unknown as {
      authorityBinding?: {
        endingAuthorityProjectionHash: string | null
        writerVisibleInternalIdCount: number
      }
    }).authorityBinding

    expect(later.projection.productionSelectedEndingLock).toBe(true)
    expect(later.projection.writerVisibleEndingLock).toBe(true)
    expect(later.projection.writerVisibleEndingMeaning).toBe(later.source.selectedEndingMeaning)
    expect(later.projection.writerVisibleEndingRawKey).toBeNull()
    expect(binding?.endingAuthorityProjectionHash).toMatch(/^[a-f0-9]{64}$/)
    expect(binding?.writerVisibleInternalIdCount).toBe(0)
    expect(issueCodes(built.validationInput)).not.toContain(
      'PRODUCTION_PROJECTION_ENDING_LOCK_NOT_WRITER_VISIBLE',
    )
  })

  it('rejects legacy fallback or missing exact brief binding as invalid projection evidence', async () => {
    const built = await buildWriterQualificationFixtureV2()
    const mutation = cloneInput(built.validationInput)
    const earlyProjection = mutation.fixtures[0]!.projection as unknown as {
      authorityBinding?: {
        authorityMode: string
        briefBindingHash: string
        legacyFallbackUsed: boolean
      }
    }

    expect(earlyProjection.authorityBinding).toBeDefined()
    earlyProjection.authorityBinding!.authorityMode = 'LEGACY'
    earlyProjection.authorityBinding!.legacyFallbackUsed = true
    earlyProjection.authorityBinding!.briefBindingHash = '0'.repeat(64)

    expect(issueCodes(mutation)).toContain('PRODUCTION_PROJECTION_SEMANTIC_EVIDENCE_INVALID')
  })

  it('keeps frozen source corpus hashes unchanged after V2 projection rebind', async () => {
    const built = await buildWriterQualificationFixtureV2()
    const hashes = computeQualificationFixtureV2Hashes(built.validationInput)

    expect(hashes.fixtureHashes).toEqual(WRITER_QUALIFICATION_FIXTURE_V2.fixtureHashes)
    expect(hashes.provisionalCorpusManifestHash).toBe(
      '712d46e7b9a06394b98593ee537fab43c376cea4aebcc951d48b654d51ca6a2a',
    )
  })

  it('keeps Bab 1 context empty of prior and future knowledge', async () => {
    const built = await buildWriterQualificationFixtureV2()
    const early = built.validationInput.fixtures.find((fixture) => fixture.key === 'EARLY')!

    expect(early.continuity.previousChapterNumber).toBeNull()
    expect(early.continuity.previousChoiceChapter).toBeNull()
    expect(early.continuity.visibleEstablishedChapters).toEqual([])
    expect(early.projection.futureRevealLeaks).toEqual([])
  })

  it('keeps Bab 8 pre-gate, makes Bab 12 reveal concrete, and keeps Bab 25 midstory', async () => {
    const built = await buildWriterQualificationFixtureV2()
    const dialogue = built.validationInput.fixtures.find((fixture) => fixture.key === 'DIALOGUE')!
    const mystery = built.validationInput.fixtures.find((fixture) => fixture.key === 'MYSTERY')!
    const emotional = built.validationInput.fixtures.find((fixture) => fixture.key === 'EMOTIONAL')!

    expect(dialogue.projection.futureRevealLeaks).toEqual([])
    expect(dialogue.source.forbiddenRevealIds).toContain('secret:ledger-author')
    expect(mystery.source.scheduledReveal).toMatchObject({
      secretId: 'secret:ledger-author',
      gateChapter: 12,
    })
    expect(mystery.projection.scheduledRevealObligationConcrete).toBe(true)
    expect(mystery.projection.scheduledRevealWriterVisible).toBe(true)
    expect(emotional.source.phaseKind).toBe('MIDSTORY')
    expect(emotional.source.remainingChapters).toBe(25)
  })

  it.each([
    ['generic placeholder', (input: QualificationFixtureV2ValidationInput) => {
      input.fixtures[0]!.source.beats[0] = 'beat utama bab 1'
    }, 'FIXTURE_SOURCE_GENERIC_PLACEHOLDER'],
    ['duplicate semantic beat', (input: QualificationFixtureV2ValidationInput) => {
      input.fixtures[1]!.source.beats[1] = input.fixtures[1]!.source.beats[0]!
    }, 'FIXTURE_SOURCE_DUPLICATE_SEMANTIC_BEAT'],
    ['premature reveal', (input: QualificationFixtureV2ValidationInput) => {
      const secret = input.fixtures[1]!.source.secretAuthorities[0]!
      input.fixtures[1]!.source.beats[0] = secret.explicitLeakMarker
    }, 'FIXTURE_SOURCE_PREMATURE_REVEAL'],
    ['invalid continuity', (input: QualificationFixtureV2ValidationInput) => {
      input.fixtures[3]!.continuity.previousChapterNumber = 12
    }, 'FIXTURE_SOURCE_ANACHRONISTIC_CONTINUITY'],
    ['scheduled reveal missing from writer', (input: QualificationFixtureV2ValidationInput) => {
      input.fixtures[2]!.projection.scheduledRevealWriterVisible = false
    }, 'PRODUCTION_PROJECTION_SCHEDULED_REVEAL_NOT_WRITER_VISIBLE'],
    ['future reveal leaked through context', (input: QualificationFixtureV2ValidationInput) => {
      input.fixtures[1]!.projection.futureRevealLeaks.push('secret:ledger-author')
    }, 'PRODUCTION_PROJECTION_FUTURE_REVEAL_LEAK'],
    ['ending lock missing from writer', (input: QualificationFixtureV2ValidationInput) => {
      input.fixtures[4]!.projection.writerVisibleEndingLock = false
    }, 'PRODUCTION_PROJECTION_ENDING_LOCK_NOT_WRITER_VISIBLE'],
    ['required brief field missing', (input: QualificationFixtureV2ValidationInput) => {
      input.fixtures[2]!.provenance.productionRequiredBriefFieldsPresent = false
    }, 'PRODUCTION_PROJECTION_REQUIRED_BRIEF_FIELD_MISSING'],
    ['builder bypass', (input: QualificationFixtureV2ValidationInput) => {
      input.fixtures[0]!.provenance.stages = input.fixtures[0]!.provenance.stages.filter(
        (stage) => stage !== 'buildPreProseChapterBrief',
      )
    }, 'BUILDER_PROVENANCE_STAGE_BYPASSED'],
    ['private identifier', (input: QualificationFixtureV2ValidationInput) => {
      input.fixtures[0]!.privacy.metadataValues.push('reader@example.com')
    }, 'PRIVACY_PRIVATE_IDENTIFIER'],
  ] as const)('rejects %s', async (_name, mutate, expectedCode) => {
    const built = await buildWriterQualificationFixtureV2()
    const mutation = cloneInput(built.validationInput)
    mutate(mutation)

    expect(issueCodes(mutation)).toContain(expectedCode)
  })

  it('keeps valid source valid when projection alone is removed', async () => {
    const built = await buildWriterQualificationFixtureV2()
    const mutation = cloneInput(built.validationInput)
    mutation.fixtures[2]!.projection.scheduledRevealWriterVisible = false
    const result = assertQualificationFixtureV2(mutation)

    expect(result.sourceValid).toBe(true)
    expect(result.issues.map((issue) => issue.code)).toContain(
      'PRODUCTION_PROJECTION_SCHEDULED_REVEAL_NOT_WRITER_VISIBLE',
    )
  })

  it('accepts semantic ending-lock projection rather than requiring raw key equality', async () => {
    const built = await buildWriterQualificationFixtureV2()
    const mutation = cloneInput(built.validationInput)
    const later = mutation.fixtures[4]!
    later.projection.writerVisibleEndingLock = true
    later.projection.writerVisibleEndingMeaning = later.source.selectedEndingMeaning
    later.projection.writerVisibleEndingRawKey = null
    const result = assertQualificationFixtureV2(mutation)

    expect(result.issues.map((issue) => issue.code)).not.toContain(
      'PRODUCTION_PROJECTION_ENDING_LOCK_NOT_WRITER_VISIBLE',
    )
  })

  it.each([
    'goal',
    'beats',
    'previousProse',
    'choiceConsequence',
    'facts',
    'timeline',
    'routeSummary',
    'storyAnchors',
  ] as const)('detects future reveal in positive %s channel even when prohibition remains', async (channel) => {
    const built = await buildWriterQualificationFixtureV2()
    const mutation = cloneInput(built.validationInput)
    const dialogue = mutation.fixtures.find((fixture) => fixture.key === 'DIALOGUE')!
    const secret = dialogue.source.secretAuthorities.find(
      (authority) => authority.secretId === 'secret:ledger-author',
    )!
    dialogue.source.positiveChannels[channel].push(secret.explicitLeakMarker)

    const result = assertQualificationFixtureV2(mutation)

    expect(dialogue.source.prohibitionChannel).toContain(secret.secretId)
    expect(result.issues).toContainEqual({
      code: 'FIXTURE_SOURCE_PREMATURE_REVEAL',
      fixtureKey: 'DIALOGUE',
      channel,
      secretId: secret.secretId,
    })
  })

  it('detects exact secret id and declared meaning without generic similarity guesses', async () => {
    const built = await buildWriterQualificationFixtureV2()
    const secretCases = ['secretId', 'meaning'] as const
    for (const secretCase of secretCases) {
      const mutation = cloneInput(built.validationInput)
      const dialogue = mutation.fixtures.find((fixture) => fixture.key === 'DIALOGUE')!
      const secret = dialogue.source.secretAuthorities.find(
        (authority) => authority.secretId === 'secret:ledger-author',
      )!
      dialogue.source.positiveChannels.goal.push(secretCase === 'secretId' ? secret.secretId : secret.meaning)
      expect(assertQualificationFixtureV2(mutation).issues).toContainEqual({
        code: 'FIXTURE_SOURCE_PREMATURE_REVEAL',
        fixtureKey: 'DIALOGUE',
        channel: 'goal',
        secretId: secret.secretId,
      })
    }
  })

  it('allows future reveal authority only in prohibition channel', async () => {
    const built = await buildWriterQualificationFixtureV2()
    const dialogue = built.validationInput.fixtures.find((fixture) => fixture.key === 'DIALOGUE')!

    expect(dialogue.source.prohibitionChannel).toContain('secret:ledger-author')
    expect(assertQualificationFixtureV2(built.validationInput).issues).not.toContainEqual(
      expect.objectContaining({ code: 'FIXTURE_SOURCE_PREMATURE_REVEAL' }),
    )
  })

  it('domain-separates source corpus hashes from projection and provenance', async () => {
    const built = await buildWriterQualificationFixtureV2()
    const baseline = computeQualificationFixtureV2Hashes(built.validationInput)
    const projectionMutation = cloneInput(built.validationInput)
    projectionMutation.fixtures[2]!.projection.scheduledRevealWriterVisible = false
    const projectionHashes = computeQualificationFixtureV2Hashes(projectionMutation)
    const provenanceMutation = cloneInput(built.validationInput)
    provenanceMutation.fixtures[0]!.provenance.stageEvidence.pop()
    const provenanceHashes = computeQualificationFixtureV2Hashes(provenanceMutation)
    const sourceMutation = cloneInput(built.validationInput)
    sourceMutation.fixtures[0]!.source.beats[0] = 'Sinta menemukan bekas lumpur baru di dekat lemari buku besar.'
    const sourceHashes = computeQualificationFixtureV2Hashes(sourceMutation)

    expect(projectionHashes.fixtureHashes).toEqual(baseline.fixtureHashes)
    expect(projectionHashes.provisionalCorpusManifestHash).toBe(baseline.provisionalCorpusManifestHash)
    expect(projectionHashes.projectionValidationHash).not.toBe(baseline.projectionValidationHash)
    expect(provenanceHashes.fixtureHashes).toEqual(baseline.fixtureHashes)
    expect(provenanceHashes.provisionalCorpusManifestHash).toBe(baseline.provisionalCorpusManifestHash)
    expect(provenanceHashes.projectionValidationHash).not.toBe(baseline.projectionValidationHash)
    expect(sourceHashes.fixtureHashes.EARLY).not.toBe(baseline.fixtureHashes.EARLY)
    expect(sourceHashes.provisionalCorpusManifestHash).not.toBe(baseline.provisionalCorpusManifestHash)
  })

  it('releases provisional authority only while every validation category passes', async () => {
    const built = await buildWriterQualificationFixtureV2()
    expect(built.manifest.readyAuthorityManifestHash).toMatch(/^[a-f0-9]{64}$/)
    expect(built.manifest.validationCategories).toEqual({
      source: true,
      schema: true,
      builder: true,
      privacy: true,
      projection: true,
    })
    expect(built.manifest.terminalVerdict).toBe('PROVISIONAL_VALIDATION_PASSED')
    expect(built.manifest.qualificationAllowed).toBe(true)

    const privacyMutation = cloneInput(built.validationInput)
    privacyMutation.fixtures[0]!.privacy.metadataValues.push('reader@example.com')
    const privacyResult = assertQualificationFixtureV2(privacyMutation)
    expect(privacyResult.qualificationAllowed).toBe(false)
    expect(privacyResult.terminalVerdict).toBe('BLOCKED_PRIVACY_GAP')

    const projectionMutation = cloneInput(built.validationInput)
    projectionMutation.fixtures[0]!.projection.semanticEvidence.artifactBindings.writer.safeArtifactHash
      = 'f'.repeat(64)
    const projectionResult = assertQualificationFixtureV2(projectionMutation)
    expect(projectionResult.qualificationAllowed).toBe(false)
    expect(projectionResult.terminalVerdict).toBe('BLOCKED_PRODUCTION_PROJECTION_GAP')
  })

  it('requires evidence emitted after every actual builder stage', async () => {
    const built = await buildWriterQualificationFixtureV2()
    for (const fixture of built.validationInput.fixtures) {
      expect(fixture.provenance.stageEvidence.map((evidence) => evidence.stage)).toEqual(
        fixture.provenance.stages,
      )
      expect(fixture.provenance.stageEvidence.every((evidence) => /^[a-f0-9]{64}$/.test(evidence.outputHash)))
        .toBe(true)
    }
    const mutation = cloneInput(built.validationInput)
    mutation.fixtures[0]!.provenance.stageEvidence = mutation.fixtures[0]!.provenance.stageEvidence
      .filter((evidence) => evidence.stage !== 'compileContext')

    expect(issueCodes(mutation)).toContain('BUILDER_PROVENANCE_STAGE_BYPASSED')
  })

  it('freezes independent class-specific production counterparts and assessments', async () => {
    const { manifest } = await buildWriterQualificationFixtureV2()
    const matrixJson = JSON.stringify(manifest.representativenessMatrix)

    expect(matrixJson).not.toMatch(/sceneMovement|spokenLine|emotionalBeat|interactingCharacter|namedCharacterIntroduction/i)
    for (const key of ['EARLY', 'DIALOGUE', 'EMOTIONAL'] as const) {
      const row = manifest.representativenessMatrix.find((candidate) => candidate.key === key)!
      expect(Object.keys(row.referenceCounterpart.semanticShape).sort()).toEqual([
        'chapterNumber',
        'mandatoryBeats',
        'normalizedChapterGoal',
      ])
      expect(Object.keys(row.fixtureV2Counterpart.semanticShape).sort()).toEqual([
        'chapterNumber',
        'mandatoryBeats',
        'normalizedChapterGoal',
      ])
    }

    expect(manifest.representativenessMatrix.map((row) => ({
      key: row.key,
      locator: row.committedProductionLikeReference,
      field: row.productionContractField,
      assessment: row.assessment,
      rationale: row.rationale,
      referenceShape: row.referenceCounterpart.semanticShape,
    }))).toEqual([
      {
        key: 'EARLY',
        locator: 'fixtures/narrative/premium-bilik-ketujuh-v2.ts:blueprintSpecs.0#L494',
        field: 'ChapterBlueprint.chapterNumber/chapterGoal/mandatoryBeats',
        assessment: 'INTENTIONAL_SYNTHETIC_SUBSTITUTION',
        rationale: 'Opening comparison records selected directly comparable committed and V2 ChapterBlueprint obligation fields at the same authority layer; differing stories remain an intentional synthetic substitution, not evidence of production draft behavior.',
        referenceShape: {
          chapterNumber: 1,
          normalizedChapterGoal: 'naya menemukan kunci hitam bilik ketujuh dan memilih langkah pertama',
          mandatoryBeats: [
            'kunci ditemukan',
            'marwah melarang',
            'hafiz memberi isyarat',
          ],
        },
      },
      {
        key: 'DIALOGUE',
        locator: 'fixtures/narrative/premium-bilik-ketujuh-v2.ts:blueprintSpecs.1#L495',
        field: 'ChapterBlueprint.chapterNumber/chapterGoal/mandatoryBeats',
        assessment: 'INTENTIONAL_SYNTHETIC_SUBSTITUTION',
        rationale: 'Dialogue-class comparison records selected directly comparable committed and V2 ChapterBlueprint obligation fields at the same authority layer; it makes no claim about spoken lines, emotion beats, cast, or production draft behavior.',
        referenceShape: {
          chapterNumber: 2,
          normalizedChapterGoal: 'naya melihat nama arman dicoret dari arsip lama',
          mandatoryBeats: [
            'surat bungkam',
            'kyai hamid menekan',
            'arsip koperasi lama',
          ],
        },
      },
      {
        key: 'MYSTERY',
        locator: 'fixtures/contracts/misteri-drama.ts:misteriDramaContract#L3-L80',
        field: 'ChapterTarget.mustInclude/revealRunway',
        assessment: 'MATCH',
        rationale: 'Scheduled-reveal comparison matches only exact gate obligation presence in independently parsed committed mystery contract; production writer visibility is not claimed without independent projection evidence.',
        referenceShape: {
          chapterNumber: 12,
          scheduledRevealPresent: true,
        },
      },
      {
        key: 'EMOTIONAL',
        locator: 'fixtures/narrative/premium-bilik-ketujuh-v2.ts:blueprintSpecs.24#L518',
        field: 'ChapterBlueprint.chapterNumber/chapterGoal/mandatoryBeats',
        assessment: 'INTENTIONAL_SYNTHETIC_SUBSTITUTION',
        rationale: 'Midstory emotional comparison records selected directly comparable committed and V2 ChapterBlueprint obligation fields at the same authority layer; it makes no proxy claim about draft emotion or relationship behavior.',
        referenceShape: {
          chapterNumber: 25,
          normalizedChapterGoal: 'naya marah pada arman yang hidup tetapi membiarkannya tumbuh tanpa ayah',
          mandatoryBeats: [
            'konfrontasi emosional',
            'arman memberi alasan belum lengkap',
            'naya memilih tetap mencari bukti',
          ],
        },
      },
      {
        key: 'LATER_ACT',
        locator: 'lib/story-engine/chapter-brief.ts:buildChapterBrief#L244-L337',
        field: 'ChapterBrief.lockedEndingKey/endingRunway + EndingCandidate.requiredClosure',
        assessment: 'INTENTIONAL_SYNTHETIC_SUBSTITUTION',
        rationale: 'Later-act comparison independently runs buildChapterBrief with committed production-like contract, snapshot, and route inputs; both lock at Bab 45 and carry selected semantic closure.',
        referenceShape: {
          lockChapter: 45,
          chapterNumber: 45,
          endingRunway: 'ending-lock',
          lockedEndingKey: 'publish-truth',
          selectedEndingClosure: [
            'Dalang sabotase banjir terungkap.',
            'Nama kakak Maya dipulihkan.',
            'Maya menerima akibat peran ayahnya.',
          ],
        },
      },
    ])

    expect(manifest.representativenessMatrix.map((row) => ({
      key: row.key,
      referenceHash: row.referenceCounterpart.valueHash,
      fixtureHash: row.fixtureV2Counterpart.valueHash,
    }))).toEqual([
      { key: 'EARLY', referenceHash: '35f0ed5392539b417c28492045ab40127195f1d0c6a3d7aa10101ec152d5a835', fixtureHash: '7ce0f907e173db6aa443b243fc30d7458887c13e351db686b8ea102f270043b6' },
      { key: 'DIALOGUE', referenceHash: 'ce4c64763f1845410e982f06bd6f4536a81903bb903e3952f77f015b43aeaea6', fixtureHash: '32a12ad9bb470b24f1f0016f2f781a36721fc99c7f11fef5d01975c08c451ccf' },
      { key: 'MYSTERY', referenceHash: '831b1a2267ddb5f4e09e54d8517462b1067c29846a4f8e80c70e220fe3c12bfe', fixtureHash: '831b1a2267ddb5f4e09e54d8517462b1067c29846a4f8e80c70e220fe3c12bfe' },
      { key: 'EMOTIONAL', referenceHash: '849fd52d84d39ef784b9a5864757c62cfa1f11d63d552029147326f708d720b5', fixtureHash: 'df84daf0b0dec0f1d218cd2084567bc3530085f20bcb020b1f0e4993cabbb4b1' },
      { key: 'LATER_ACT', referenceHash: '24a7663af484017d9d4d878f48705a795bce9152b1e1929b34afd1343e35a0af', fixtureHash: 'd6d2d3215c7bc35220d9e02968860630d06b9a73fd05681cbeff3922053ff184' },
    ])

    const later = manifest.representativenessMatrix.find((row) => row.key === 'LATER_ACT')!
    expect(later.referenceCounterpart.semanticShape).toMatchObject({
      lockChapter: 45,
      chapterNumber: 45,
      endingRunway: 'ending-lock',
      lockedEndingKey: 'publish-truth',
      selectedEndingClosure: misteriDramaContract.endingCandidates[0]!.requiredClosure,
    })
    expect(later.fixtureV2Counterpart.semanticShape).toMatchObject({
      lockChapter: 45,
      chapterNumber: 45,
      endingRunway: 'ending-lock',
      lockedEndingKey: 'rumah-bersama',
      selectedEndingClosure: ['Warga ikut menjaga kedai setelah bukti dibuka.'],
    })
  })

  it('derives semantic IDs only from captured production artifacts', async () => {
    const built = await buildWriterQualificationFixtureV2()
    const dialogue = built.validationInput.fixtures.find((fixture) => fixture.key === 'DIALOGUE')!
    const mystery = built.validationInput.fixtures.find((fixture) => fixture.key === 'MYSTERY')!

    const dialogueSummary = deriveQualificationFixtureV2SemanticSummary(dialogue)
    expect(dialogueSummary.evidenceIds.newState).toEqual(['plan:proposed-state-delta'])
    expect(dialogueSummary.evidenceIds.characterInteraction.length).toBeGreaterThan(0)
    expect(dialogueSummary.evidenceIds.continuity).toEqual([
      'continuity:previous-chapter',
      'continuity:previous-choice',
    ])
    expect(deriveQualificationFixtureV2SemanticSummary(mystery).evidenceIds.revealPayoff)
      .toEqual(['reveal:secret:ledger-author'])

    const noState = structuredClone(dialogue)
    noState.projection.semanticEvidence.proposedStateDelta = { keys: [], nonempty: false }
    expect(deriveQualificationFixtureV2SemanticSummary(noState).evidenceIds.newState).toEqual([])

    const noCharacters = structuredClone(dialogue)
    noCharacters.projection.semanticEvidence.characterOccurrences = []
    expect(deriveQualificationFixtureV2SemanticSummary(noCharacters).evidenceIds.characterInteraction)
      .toEqual([])

    const fabricatedCharacter = structuredClone(dialogue)
    fabricatedCharacter.projection.semanticEvidence.characterOccurrences.push({
      characterName: 'Tokoh Rekaan',
      inPlannedBeats: true,
      inWriterProjection: true,
      artifactHash: '0'.repeat(64),
    })
    expect(deriveQualificationFixtureV2SemanticSummary(fabricatedCharacter).evidenceIds.characterInteraction)
      .not.toContain('writer:character:tokoh rekaan')

    const fabricatedFinding = structuredClone(dialogue)
    fabricatedFinding.projection.semanticEvidence.writerVisibleFindings.push({
      channel: 'plannedBeat',
      normalizedValue: 'temuan rekaan',
      artifactHash: '0'.repeat(64),
    })
    expect(deriveQualificationFixtureV2SemanticSummary(fabricatedFinding).evidenceIds.sceneDriving)
      .toEqual([])

    const noContinuationHash = structuredClone(dialogue)
    noContinuationHash.projection.semanticEvidence.continuation.outputHash = '0'.repeat(64)
    expect(deriveQualificationFixtureV2SemanticSummary(noContinuationHash).evidenceIds.continuity)
      .toEqual([])

    const noRevealPlan = structuredClone(mystery)
    noRevealPlan.projection.semanticEvidence.scheduledReveal!.presentInExactPlan = false
    expect(deriveQualificationFixtureV2SemanticSummary(noRevealPlan).evidenceIds.revealPayoff)
      .toEqual([])

    const noRevealWriter = structuredClone(mystery)
    noRevealWriter.projection.semanticEvidence.scheduledReveal!.presentInWriterSemanticProjection = false
    expect(deriveQualificationFixtureV2SemanticSummary(noRevealWriter).evidenceIds.revealPayoff)
      .toEqual([])
  })

  it('rejects coordinated plan mirror mutation despite recomputed per-finding hashes', async () => {
    const built = await buildWriterQualificationFixtureV2()
    const mutation = cloneInput(built.validationInput)
    const dialogue = mutation.fixtures.find((fixture) => fixture.key === 'DIALOGUE')!
    const fabricatedGoal = 'Tujuan rekaan tanpa authority produksi'
    const fabricatedBeat = 'Beat rekaan menyebut Tokoh Rekaan'
    const fabricatedStateKey = 'state_rekaan'
    const normalizedGoal = fabricatedGoal.toLocaleLowerCase('id-ID').replace(/[^a-z0-9]+/g, ' ').trim()
    const normalizedBeat = fabricatedBeat.toLocaleLowerCase('id-ID').replace(/[^a-z0-9]+/g, ' ').trim()

    dialogue.projection.exactPlanChapterGoal = fabricatedGoal
    dialogue.projection.exactPlanPlannedBeats = [fabricatedBeat]
    dialogue.projection.exactPlanProposedStateDeltaKeys = [fabricatedStateKey]
    dialogue.projection.semanticEvidence.proposedStateDelta = {
      keys: [fabricatedStateKey],
      nonempty: true,
    }
    dialogue.projection.semanticEvidence.writerVisibleFindings = [
      {
        channel: 'chapterGoal',
        normalizedValue: normalizedGoal,
        artifactHash: evidenceHash('WRITER_VISIBLE_SEMANTIC_FINDING', {
          channel: 'chapterGoal',
          normalizedValue: normalizedGoal,
        }),
      },
      {
        channel: 'plannedBeat',
        normalizedValue: normalizedBeat,
        artifactHash: evidenceHash('WRITER_VISIBLE_SEMANTIC_FINDING', {
          channel: 'plannedBeat',
          normalizedValue: normalizedBeat,
        }),
      },
    ]
    dialogue.projection.semanticEvidence.characterOccurrences = [{
      characterName: 'Tokoh Rekaan',
      inPlannedBeats: true,
      inWriterProjection: true,
      artifactHash: evidenceHash('WRITER_CHARACTER_OCCURRENCE', {
        characterName: 'Tokoh Rekaan',
        inPlannedBeats: true,
        inWriterProjection: true,
      }),
    }]

    expect(issueCodes(mutation)).toContain('PRODUCTION_PROJECTION_SEMANTIC_EVIDENCE_INVALID')
    const summary = deriveQualificationFixtureV2SemanticSummary(dialogue)
    expect(summary.evidenceIds.newState).toEqual([])
    expect(summary.evidenceIds.characterInteraction).not.toContain('writer:character:tokoh rekaan')
    expect(summary.evidenceIds.sceneDriving).toEqual([])
  })

  it('rejects fully coordinated semantic mutation with every mutable authority hash recomputed', async () => {
    const built = await buildWriterQualificationFixtureV2()
    const mutation = cloneInput(built.validationInput)
    const dialogue = mutation.fixtures.find((fixture) => fixture.key === 'DIALOGUE')!
    const semantic = dialogue.projection.semanticEvidence
    const fabricatedGoal = 'Tujuan Rekaan'
    const fabricatedBeat = 'Tokoh Rekaan membuka rahasia rekaan'
    const normalizedGoal = 'tujuan rekaan'
    const normalizedBeat = 'tokoh rekaan membuka rahasia rekaan'
    const fabricatedStateKey = 'state_rekaan'
    const planStageHash = '1'.repeat(64)
    const writerStageHash = '2'.repeat(64)
    const continuationStageHash = '3'.repeat(64)

    dialogue.projection.exactPlanChapterGoal = fabricatedGoal
    dialogue.projection.exactPlanPlannedBeats = [fabricatedBeat]
    dialogue.projection.exactPlanProposedStateDeltaKeys = [fabricatedStateKey]
    dialogue.projection.auditedPositiveChannels.planChapterGoal = [fabricatedGoal]
    dialogue.projection.auditedPositiveChannels.planPlannedBeats = [fabricatedBeat]
    semantic.proposedStateDelta = { keys: [fabricatedStateKey], nonempty: true }
    semantic.writerVisibleFindings = [{
      channel: 'chapterGoal',
      normalizedValue: normalizedGoal,
      artifactHash: evidenceHash('WRITER_VISIBLE_SEMANTIC_FINDING', {
        channel: 'chapterGoal',
        normalizedValue: normalizedGoal,
      }),
    }, {
      channel: 'plannedBeat',
      normalizedValue: normalizedBeat,
      artifactHash: evidenceHash('WRITER_VISIBLE_SEMANTIC_FINDING', {
        channel: 'plannedBeat',
        normalizedValue: normalizedBeat,
      }),
    }]
    semantic.characterOccurrences = [{
      characterName: 'Tokoh Rekaan',
      inPlannedBeats: true,
      inWriterProjection: true,
      artifactHash: evidenceHash('WRITER_CHARACTER_OCCURRENCE', {
        characterName: 'Tokoh Rekaan',
        inPlannedBeats: true,
        inWriterProjection: true,
      }),
    }]
    semantic.continuation.outputHash = continuationStageHash
    semantic.artifactBindings.plan.stageOutputHash = planStageHash
    semantic.artifactBindings.plan.safeArtifact = {
      normalizedChapterGoal: normalizedGoal,
      normalizedPlannedBeats: [normalizedBeat],
      proposedStateDeltaKeys: [fabricatedStateKey],
      characterNamesInPlannedBeats: ['Tokoh Rekaan'],
      scheduledRevealSecretIds: [],
    }
    semantic.artifactBindings.plan.safeArtifactHash = evidenceHash('PLAN_SEMANTIC_ARTIFACT_BINDING', {
      stageOutputHash: planStageHash,
      safeArtifact: semantic.artifactBindings.plan.safeArtifact,
    })
    semantic.artifactBindings.writer.stageOutputHash = writerStageHash
    semantic.artifactBindings.writer.safeArtifact = {
      authorityMode: 'CHAPTER_BRIEF_V2',
      briefBindingHash: semantic.artifactBindings.writer.safeArtifact.briefBindingHash,
      visibleFindings: semantic.writerVisibleFindings.map(({ channel, normalizedValue }) => ({
        channel,
        normalizedValue,
      })),
      characterNamesInProjection: ['Tokoh Rekaan'],
      projectedObligationAuthorityIds: [],
      scheduledRevealSecretIds: [],
      writerDirectiveHashes: [],
      endingAuthorityProjectionHash: null,
      writerVisibleInternalIdCount: 0,
      legacyFallbackUsed: false,
    }
    semantic.artifactBindings.writer.safeArtifactHash = evidenceHash('WRITER_SEMANTIC_ARTIFACT_BINDING', {
      stageOutputHash: writerStageHash,
      safeArtifact: semantic.artifactBindings.writer.safeArtifact,
    })
    semantic.artifactBindings.continuation.stageOutputHash = continuationStageHash
    semantic.artifactBindings.continuation.safeArtifactHash = evidenceHash(
      'CONTINUATION_SEMANTIC_ARTIFACT_BINDING',
      {
        stageOutputHash: continuationStageHash,
        safeArtifact: semantic.artifactBindings.continuation.safeArtifact,
      },
    )
    dialogue.provenance.stageEvidence.find((item) => item.stage === 'generatePlan')!.outputHash = planStageHash
    dialogue.provenance.stageEvidence.find(
      (item) => item.stage === 'buildProductionChapterWriterPrompt',
    )!.outputHash = writerStageHash
    dialogue.provenance.stageEvidence.find(
      (item) => item.stage === 'buildContinuationContext',
    )!.outputHash = continuationStageHash
    dialogue.provenance.artifactAuthorityHash = evidenceHash(
      'BUILDER_STAGE_ARTIFACT_AUTHORITY',
      dialogue.provenance.stageEvidence,
    )

    expect(issueCodes(mutation)).toContain('PRODUCTION_PROJECTION_SEMANTIC_EVIDENCE_INVALID')
    const summary = deriveQualificationFixtureV2SemanticSummary(dialogue)
    expect(summary.evidenceIds.sceneDriving).toEqual([])
    expect(summary.evidenceIds.newState).toEqual([])
    expect(summary.evidenceIds.characterInteraction).not.toContain('writer:character:tokoh rekaan')
    expect(summary.evidenceIds.revealPayoff).not.toContain('reveal:secret:rekaan')
  })

  it('rejects coordinated scheduled-secret mutation despite internally consistent mirrors', async () => {
    const built = await buildWriterQualificationFixtureV2()
    const mutation = cloneInput(built.validationInput)
    const mystery = mutation.fixtures.find((fixture) => fixture.key === 'MYSTERY')!

    mystery.source.scheduledReveal = {
      secretId: 'secret:rekaan',
      gateChapter: 12,
      obligation: 'Buka rahasia rekaan.',
    }
    mystery.projection.semanticEvidence.scheduledReveal = {
      secretId: 'secret:rekaan',
      presentInExactPlan: true,
      presentInWriterSemanticProjection: true,
    }

    expect(issueCodes(mutation)).toContain('PRODUCTION_PROJECTION_SEMANTIC_EVIDENCE_INVALID')
    expect(deriveQualificationFixtureV2SemanticSummary(mystery).evidenceIds.revealPayoff)
      .not.toContain('reveal:secret:rekaan')
  })

  it('rejects coordinated continuation mutation bound to no production artifact', async () => {
    const built = await buildWriterQualificationFixtureV2()
    const mutation = cloneInput(built.validationInput)
    const dialogue = mutation.fixtures.find((fixture) => fixture.key === 'DIALOGUE')!
    const fabricatedContinuation = {
      present: true,
      outputHash: evidenceHash('BUILDER_STAGE_CONTINUATION_CONTEXT', { fabricated: true }),
      previousChapterNumber: 99,
      previousChoiceChapter: 99,
    }

    dialogue.projection.semanticEvidence.continuation = fabricatedContinuation
    dialogue.continuity.previousChapterNumber = 99
    dialogue.continuity.previousChoiceChapter = 99
    const continuationStage = dialogue.provenance.stageEvidence.find(
      (evidence) => evidence.stage === 'buildContinuationContext',
    )!
    continuationStage.outputHash = fabricatedContinuation.outputHash
    dialogue.provenance.artifactAuthorityHash = evidenceHash(
      'BUILDER_STAGE_ARTIFACT_AUTHORITY',
      dialogue.provenance.stageEvidence,
    )

    expect(issueCodes(mutation)).toContain('PRODUCTION_PROJECTION_SEMANTIC_EVIDENCE_INVALID')
    expect(deriveQualificationFixtureV2SemanticSummary(dialogue).evidenceIds.continuity).toEqual([])
  })

  it('publishes reproducible production comparisons and evidence-derived semantic obligations', async () => {
    const first = await buildWriterQualificationFixtureV2()
    const second = await buildWriterQualificationFixtureV2()
    expect(first.manifest.representativenessMatrix).toEqual(second.manifest.representativenessMatrix)

    for (const row of first.manifest.representativenessMatrix) {
      expect(row.productionContractField).toBeTruthy()
      expect(row.committedProductionLikeReference).toMatch(
        /^(fixtures|lib)\/.+\.ts:[A-Za-z0-9_.-]+(?:#L\d+(?:-L\d+)?)?$/,
      )
      expect(row.referenceCounterpart).toMatchObject({
        semanticShape: expect.any(Object),
        valueHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      })
      expect(row.fixtureV2Counterpart).toMatchObject({
        semanticShape: expect.any(Object),
        valueHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      })
      expect(['EXACT_CANONICAL_SHAPE', 'DECLARED_SYNTHETIC_EQUIVALENCE']).toContain(row.comparisonMethod)
      expect(['MATCH', 'INTENTIONAL_SYNTHETIC_SUBSTITUTION']).toContain(row.assessment)
      if (row.assessment === 'MATCH') {
        expect(row.fixtureV2Counterpart.valueHash).toBe(row.referenceCounterpart.valueHash)
      } else {
        expect(row.rationale.length).toBeGreaterThan(0)
      }
    }

    for (const summary of first.manifest.semanticSummaries) {
      expect(summary.endingShape).toBe(
        summary.endingEvidence.selected && !summary.endingEvidence.writerVisible
          ? 'PRODUCTION_SELECTED_NOT_WRITER_VISIBLE'
          : summary.endingEvidence.selected
            ? 'PRODUCTION_SELECTED_AND_WRITER_VISIBLE'
            : 'NOT_SELECTED',
      )
      for (const [category, ids] of Object.entries(summary.evidenceIds)) {
        expect(new Set(ids).size).toBe(ids.length)
        expect(summary.obligationCounts[category as keyof typeof summary.obligationCounts]).toBe(ids.length)
      }
      expect(summary.obligationCounts.sceneDriving).toBeGreaterThan(0)
    }
    expect(JSON.stringify(first.manifest)).not.toMatch(/previousChapterParagraphs|writerEnvelope|systemPrompt|userPrompt/i)
  })

  it.each([
    'blueprintGoal',
    'blueprintBeat',
    'voiceGuidance',
    'previousProse',
    'choiceLabel',
    'choiceConsequence',
    'routeState',
    'thread',
    'fact',
    'timeline',
    'rollup',
    'storyAnchor',
  ] as const)('audits future-secret injection through real %s production source', async (channel) => {
    const built = await buildWriterQualificationFixtureV2({
      sourceAuthorityOverrides: [{
        fixtureKey: 'DIALOGUE',
        channel,
        value: 'EXPLICIT_SECRET_LEAK:secret:ledger-author',
      }],
    })
    const dialogue = built.validationInput.fixtures.find((fixture) => fixture.key === 'DIALOGUE')!
    const result = assertQualificationFixtureV2(built.validationInput)

    expect(dialogue.source.prohibitionChannel).toContain('secret:ledger-author')
    expect(dialogue.projection.auditedPositiveChannels[channel].some(
      (value) => value.includes('EXPLICIT_SECRET_LEAK:secret:ledger-author'),
    )).toBe(true)
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: 'PRODUCTION_PROJECTION_FUTURE_REVEAL_LEAK',
      fixtureKey: 'DIALOGUE',
      secretId: 'secret:ledger-author',
    }))
  })

  it('fails closed when display content collides with an internal authority identifier', async () => {
    const build = buildWriterQualificationFixtureV2({
      sourceAuthorityOverrides: [{
        fixtureKey: 'DIALOGUE',
        channel: 'characterName',
        value: 'EXPLICIT_SECRET_LEAK:secret:ledger-author',
      }],
    })

    await expect(build).rejects.toMatchObject({
      name: 'ContradictionError',
      code: 'WRITER_VISIBLE_INTERNAL_AUTHORITY_IDENTIFIER',
    })

    const clean = await buildWriterQualificationFixtureV2()
    expect(clean.manifest.inferenceCount).toBe(0)
    expect(clean.manifest.databaseCalls).toBe(0)
    expect(clean.manifest.publicationCalls).toBe(0)
  })

  it('audits exact plan and writer projection while excluding explicit prohibition text', async () => {
    const built = await buildWriterQualificationFixtureV2()
    const dialogue = built.validationInput.fixtures.find((fixture) => fixture.key === 'DIALOGUE')!

    expect(dialogue.projection.auditedPositiveChannels.planChapterGoal).toEqual([
      dialogue.projection.exactPlanChapterGoal,
    ])
    expect(dialogue.projection.auditedPositiveChannels.planPlannedBeats)
      .toEqual(dialogue.projection.exactPlanPlannedBeats)
    expect(dialogue.projection.auditedPositiveChannels).toHaveProperty('writerPrompt')
    expect(dialogue.projection.auditedPositiveChannels).toHaveProperty('writerSystem')
    expect(dialogue.projection.prohibitionChannel).toContain('secret:ledger-author')
    expect(dialogue.projection.futureRevealLeaks).toEqual([])
  })

  it('uses null continuation through every Bab 1 production consumer', async () => {
    const built = await buildWriterQualificationFixtureV2()
    const early = built.validationInput.fixtures.find((fixture) => fixture.key === 'EARLY')!
    const earlyManifest = built.manifest.fixtures.find((fixture) => fixture.key === 'EARLY')!

    expect(early.provenance.stages).not.toContain('buildContinuationContext')
    expect(early.provenance.notApplicableStages).toEqual([{
      stage: 'buildContinuationContext',
      reason: 'BAB_1_PRODUCTION_CONTINUATION_IS_NULL',
    }])
    expect(early.proof.continuationWasNullForPreProse).toBe(true)
    expect(early.proof.continuationWasNullForPlan).toBe(true)
    expect(early.proof.continuationWasNullForWriter).toBe(true)
    expect(earlyManifest.continuationSemantics).toBe('NULL_FOR_BAB_1_PRODUCTION_PATH')
    expect(early.source.positiveChannels.previousProse).toEqual([])
    expect(early.source.positiveChannels.choiceConsequence).toEqual([])
    expect(early.projection.auditedPositiveChannels.storyAnchor).toEqual([])
  })

  it.each([
    ['corrupt hash', (row: QualificationFixtureV2ValidationInput['fixtures'][number]) => {
      row.provenance.stageEvidence[2]!.outputHash = '0'.repeat(64)
    }],
    ['duplicate stage', (row: QualificationFixtureV2ValidationInput['fixtures'][number]) => {
      row.provenance.stageEvidence.splice(3, 0, structuredClone(row.provenance.stageEvidence[2]!))
    }],
    ['reordered stages', (row: QualificationFixtureV2ValidationInput['fixtures'][number]) => {
      const item = row.provenance.stageEvidence[2]!
      row.provenance.stageEvidence[2] = row.provenance.stageEvidence[3]!
      row.provenance.stageEvidence[3] = item
    }],
    ['swapped hashes', (row: QualificationFixtureV2ValidationInput['fixtures'][number]) => {
      const hash = row.provenance.stageEvidence[2]!.outputHash
      row.provenance.stageEvidence[2]!.outputHash = row.provenance.stageEvidence[3]!.outputHash
      row.provenance.stageEvidence[3]!.outputHash = hash
    }],
  ] as const)('rejects %s in ordered stage provenance', async (_name, mutate) => {
    const built = await buildWriterQualificationFixtureV2()
    const mutation = cloneInput(built.validationInput)
    mutate(mutation.fixtures[1]!)

    expect(issueCodes(mutation)).toContain('BUILDER_PROVENANCE_STAGE_BYPASSED')
  })

  it.each([
    ['email', 'reader@example.com'],
    ['phone', '+6281234567890'],
    ['api key', 'sk-1234567890abcdef1234567890'],
    ['uuid user id', 'user:550e8400-e29b-41d4-a716-446655440000'],
  ] as const)('recursively rejects private %s outside privacy metadata list', async (_name, value) => {
    const built = await buildWriterQualificationFixtureV2()
    const mutation = cloneInput(built.validationInput)
    mutation.fixtures[1]!.source.positiveChannels.facts.push(value)

    const result = assertQualificationFixtureV2(mutation)
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: 'PRIVACY_PRIVATE_IDENTIFIER',
      fixtureKey: 'DIALOGUE',
    }))
    expect(result.terminalVerdict).toBe('BLOCKED_PRIVACY_GAP')
  })

  it('freezes privacy evidence into projection validation authority', async () => {
    const built = await buildWriterQualificationFixtureV2()
    const baseline = computeQualificationFixtureV2Hashes(built.validationInput)
    const mutation = cloneInput(built.validationInput)
    mutation.fixtures[0]!.privacy.metadataValues.push('new-public-category')
    const changed = computeQualificationFixtureV2Hashes(mutation)

    expect(changed.fixtureHashes).toEqual(baseline.fixtureHashes)
    expect(changed.provisionalCorpusManifestHash).toBe(baseline.provisionalCorpusManifestHash)
    expect(changed.projectionValidationHash).not.toBe(baseline.projectionValidationHash)
    expect(built.manifest.privacyValidationHash).toBe(
      WRITER_QUALIFICATION_FIXTURE_V2.privacyValidationHash,
    )
  })
})
