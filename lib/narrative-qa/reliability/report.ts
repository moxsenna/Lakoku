import type { ValidatedReliabilitySemanticArtifact } from './artifacts'

/**
 * Deterministic Markdown report generator. Accepts only the branded
 * `ValidatedReliabilitySemanticArtifact` produced by the semantic validator.
 * Every displayed value carries provenance. The report never serializes
 * observation records, user/reader content, operational instance ids, or any
 * private data; it renders aggregates, authorities, model outputs, gates, and
 * declared scope limits only.
 */

const STATUS_LINES = (artifact: ValidatedReliabilitySemanticArtifact): readonly string[] => {
  const verdict = artifact.engineeringGate.result
  const engineering = verdict.engineeringGate === 'PASS' ? 'PASS  // when earned' : verdict.engineeringGate
  return [
    `engineeringGate = ${engineering}`,
    `budgetGate = ${artifact.budget.result.budgetGate}`,
    'G2-BUDGET = OPEN',
    'M10-E = OPEN',
  ]
}

const SEPARATE_FIELDS = (artifact: ValidatedReliabilitySemanticArtifact): readonly string[] => {
  const verdict = artifact.engineeringGate.result
  return [
    `executionProfile = ${artifact.executionProfile}`,
    `engineeringGate = ${verdict.engineeringGate}`,
    `releaseReadiness = ${verdict.releaseReadiness}`,
    `budgetGate = ${artifact.budget.result.budgetGate}`,
    'G2-BUDGET = OPEN',
    'M10-E = OPEN',
  ]
}

function measurementLine(label: string, state: { state: string; value?: unknown; detail?: string }, provenance: string): string {
  if (state.state === 'PRESENT') return `${label} = ${String(state.value)} (${provenance}, PRESENT)`
  if (state.state === 'MISSING') return `${label} = MISSING (${provenance}; ${String(state.detail ?? 'no value')})`
  return `${label} = NOT_APPLICABLE (${provenance})`
}

export function renderReliabilityReport(artifact: ValidatedReliabilitySemanticArtifact): string {
  if (artifact === null || typeof artifact !== 'object'
    || typeof (artifact as Partial<ValidatedReliabilitySemanticArtifact>).schemaVersion !== 'string'
    || typeof (artifact as Partial<ValidatedReliabilitySemanticArtifact>).artifactSemanticHash !== 'string'
    || !Array.isArray((artifact as Partial<ValidatedReliabilitySemanticArtifact>).reasonCodes)) {
    throw new Error('Report requires validated semantic artifact')
  }
  const sections: string[] = []
  sections.push(`# M10-E — Laporan Evaluasi Ekonomi Reliabilitas (Reliability Economics Evaluation Report)`)

  const profile = artifact.executionProfile
  const stratum = artifact.compatibleStratum
  const authorities = artifact.authorities
  const completeness = artifact.completeness as Readonly<{
    engineeringGate: 'PASS' | 'HOLD' | 'FAIL'
    reasonCodes: readonly string[]
    profileCompleteness: Readonly<{
      engineeringGate: 'PASS' | 'HOLD' | 'FAIL'
      reasonCodes: readonly string[]
      stagePools: readonly Readonly<{ stageId: string; observed: number; minimum: number; complete: boolean }>[]
      applicableCells: readonly Readonly<{ chapterNumber: number; stageId: string; observed: number; minimum: number; complete: boolean }>[]
      completeNovels: Readonly<{ minimum: number; observed: number; complete: boolean }>
    }>
  }>

  const line = (text: string): string => `- ${text}`
  const kv = (key: string, value: string): string => `- ${key} = \`${value}\``

  // 1. Scope and authority
  sections.push(`## 1. Lingkup dan Otoritas (Scope and Authority)`)
  sections.push(kv('schemaVersion', artifact.schemaVersion))
  sections.push(kv('executionProfile', profile))
  sections.push(kv('sourceAuthority', artifact.sourceAuthority))
  sections.push(kv('baseGitSha', artifact.baseGitSha))
  sections.push(kv('gitDirty', String(artifact.gitDirty)))
  sections.push(kv('e2ClosureReference', artifact.e2ClosureReference))
  sections.push(line('Pengikatan SHA: `baseGitSha` adalah SHA Git mentah 40-heksa pada HEAD saat artefak generasi/sumber dibuat. SHA run akhir yang dihitung dicatat di status CLI dan diverifikasi comparator pada push; komit dokumen ini tidak pernah mengikat SHA komitnya sendiri sebagai SHA generasi.'))
  sections.push(`- compatibleStratum = provider \`${stratum.providerModelPolicyId}\`, pricing \`${stratum.pricingPolicyVersion}\`/\`${stratum.pricingSnapshotHash}\`, retry \`${stratum.retryFallbackPolicyId}\`/\`${stratum.retryFallbackPolicyHash}\``)
  sections.push(kv('stageCatalogVersion', `${stratum.stageCatalogVersion}#${stratum.stageCatalogHash}`))
  sections.push(kv('taskMappingVersion', `${stratum.taskMappingVersion}#${stratum.taskMappingHash}`))
  sections.push(kv('topologyVersion', `${stratum.topologyVersion}#${stratum.topologyHash}`))
  sections.push(kv('monteCarloAuthority', `${authorities.monteCarlo.authorityVersion}#${authorities.monteCarlo.canonicalHash}`))
  sections.push(kv('cumulativeModelAuthority', `${authorities.cumulativeModel.authorityVersion}#${authorities.cumulativeModel.canonicalHash}`))
  sections.push(kv('judgePlanAuthority', `${authorities.judgePlan.authorityVersion}#${authorities.judgePlan.canonicalHash} (${authorities.judgePlan.evaluations.length} evaluasi)`))
  sections.push(kv('independentDrawCorrelation', `${authorities.independentDrawCorrelation.authorityVersion}#${authorities.independentDrawCorrelation.canonicalHash}`))
  sections.push(kv('pricingSnapshotHash', authorities.pricingSnapshotHash))
  const e0 = artifact.budget.result.status === 'APPROVED_EVALUATED' ? 'APPROVED_EVALUATED' : artifact.budget.result.status === 'SUPPLIED_E0_INVALID' ? 'SUPPLIED_E0_INVALID' : 'ABSENT_OR_NOT_APPROVED'
  sections.push(kv('budgetAuthorityStatus', `${e0}; novelCostConditioning = SUCCESSFUL_50_CHAPTER_RUN`))
  for (const status of SEPARATE_FIELDS(artifact)) sections.push(line(status))

  // 2. Observed reliability
  sections.push(`## 2. Reliabilitas Teramati (Observed Reliability)`)
  sections.push(kv('evidenceClassification', `${completeness.engineeringGate} (${completeness.reasonCodes.length} alasan)`))
  for (const item of artifact.aggregate.requiredMetrics) {
    sections.push(measurementLine(`requiredMetric.${item.metricId}`, item.value, item.provenance
      + `; denominator ${item.denominator}; included ${item.counts.includedCount}, excluded ${item.counts.excludedCount}, eligible ${item.counts.eligibleCount}; coverage ${item.coverageRatio}`))
  }
  sections.push(line('Aggregasi dilakukan secara deterministik dari observasi teramati pada strata eksak terpilih (OBSERVED).'))
  sections.push(kv('profileThresholds', `stagePools ok=${completeness.profileCompleteness.stagePools.filter((s) => s.complete).length}/${completeness.profileCompleteness.stagePools.length}, applicableCells ok=${completeness.profileCompleteness.applicableCells.filter((c) => c.complete).length}/${completeness.profileCompleteness.applicableCells.length}, completeNovels ${completeness.profileCompleteness.completeNovels.observed}/${completeness.profileCompleteness.completeNovels.minimum}`))

  // 3. Observed token and cost coverage
  sections.push(`## 3. Cakupan Token dan Biaya Teramati (Observed Token and Cost Coverage)`)
  for (const metricId of ['INPUT_TOKEN_USAGE', 'OUTPUT_TOKEN_USAGE', 'TOTAL_TOKEN_USAGE', 'ACTUAL_PROVIDER_COST', 'PRICING_ESTIMATED_COST', 'ACTUAL_COST_COVERAGE_RATIO', 'PRICING_COST_COVERAGE_RATIO', 'CHAPTER_COST_P50', 'CHAPTER_COST_P95', 'JUDGE_EVALUATION_COST']) {
    const item = artifact.aggregate.requiredMetrics.find((metric) => metric.metricId === metricId)
    if (item) sections.push(measurementLine(`requiredMetric.${metricId}`, item.value, item.provenance
      + `; included ${item.counts.includedCount}, excluded ${item.counts.excludedCount}, eligible ${item.counts.eligibleCount}`))
  }
  sections.push(line('Perhitungan token eksak (input + output = total) dan biaya memakai denominasi mata uang strata eksak.'))
  sections.push(line('Biaya estimasi bersifat MODELED_FROM_PRICING dan tetap terpisah dari biaya aktual OBSERVED.'))

  // 4. Pricing-derived estimates
  sections.push(`## 4. Estimasi Turunan Harga (Pricing-Derived Estimates)`)
  for (const [slotId, slot] of Object.entries(artifact.aggregate.modeledPricingSlots)) {
    if (slot === null || typeof slot !== 'object' || !('value' in slot)) continue
    sections.push(measurementLine(`pricingSlot.${slotId}`, slot.value as { state: string; value?: unknown; detail?: string }, slot.provenance as string))
    if ('pricingSnapshotHash' in slot) sections.push(kv(`pricingSlot.${slotId}.pricingSnapshotHash`, String(slot.pricingSnapshotHash)))
  }
  sections.push(line('Estimasi turunan harga hanyalah proyeksi harga per unit dari snapshot otoritas, bukan biaya aktual dan bukan otoritas anggaran.'))
  sections.push(line('Binding E0 ke snapshot harga tidak mengubah estimasi menjadi observasi atau keputusan bisnis.'))

  // 5. Assumptions
  sections.push(`## 5. Asumsi (Assumptions)`)
  for (const authority of authorities.exchangeability) {
    sections.push(line(`chapterStageExchangeabilityAssumption ${authority.stageId}: versi \`${authority.authorityVersion}\`, hash \`${authority.canonicalHash}\`, scope bab ${authority.chapters[0]}..${authority.chapters[49]}, sumber keputusan \`${authority.decisionRef}\``))
  }
  sections.push(line(`independentDrawCorrelation: \`${authorities.independentDrawCorrelation.authorityVersion}\`#\`${authorities.independentDrawCorrelation.canonicalHash}\` — ${authorities.independentDrawCorrelation.rationale}`))
  sections.push(line('Asumsi independensi antar bab/node dan eksekusi judge deterministik adalah ASSUMPTION, bukan kebenaran terukur.'))
  sections.push(line('Distribusi fallback turunan harga bersifat MODELED_FROM_PRICING dan tidak pernah disajikan sebagai empiris/OBSERVED.'))
  sections.push(line('Exchangeability adalah otoritas model, bukan kebenaran teramati; efek bab kuat dilaporkan sebagai diagnostik/sensitivitas, tidak pernah sebagai input pusat model.'))
  sections.push(line('Probabilitas sel per-bab (diagnostik) tidak pernah menjadi input pusat model.'))
  sections.push(line('Stratum penyedia/model kebijakan yang berbeda tidak pernah digabung.'))

  // 6. Modeled cumulative reliability
  sections.push(`## 6. Reliabilitas Kumulatif Terpetakan (Modeled Cumulative Reliability)`)
  const model = artifact.model.output
  const result = model.result
  sections.push(kv('modelVersion', `${result.modelVersion} (iterasi ${result.iterations}, seed \`${result.seed}\`)`))
  sections.push(kv('modelInputHash', model.inputHash))
  sections.push(kv('modelOutputHash', model.outputHash))
  sections.push(kv('completionProbability', `${result.completionProbability} (MODELED)`))
  sections.push(kv('terminalFailureProbability', `${result.terminalFailureProbability} (MODELED)`))
  sections.push(kv('expectedRetryCount', result.expectedRetryCount))
  sections.push(kv('expectedGenerationProviderCallCount', result.expectedGenerationProviderCallCount))
  sections.push(kv('expectedJudgeProviderCallCount', result.expectedJudgeProviderCallCount))
  sections.push(kv('expectedTotalProviderCallCount', result.expectedTotalProviderCallCount))
  sections.push(measurementLine('maxExpectedCostPerChapter', result.maxExpectedCostPerChapter, 'MODELED'))
  sections.push(measurementLine('expectedGenerationCostPerSuccessfulNovelRun', result.successfulRunGenerationMean, `MODELED; successful-run denominator ${result.successfulRunCount}`))
  sections.push(measurementLine('modeledJudgeTotal', result.modeledJudgeTotal, 'MODELED'))
  sections.push(measurementLine('modeledFirstAttemptBaselineCost', result.modeledFirstAttemptBaselineCost, 'MODELED'))
  sections.push(measurementLine('modeledRetryFallbackCost', result.modeledRetryFallbackCost, 'MODELED'))
  sections.push(measurementLine('modeledRetryOverheadPercentage', result.modeledRetryOverheadPercentage, 'MODELED'))
  sections.push(kv('costComponentDenominator', String(result.costComponentDenominator)))
  sections.push(kv('expectedGenerationSpendPerStartedNovelAttempt', `${result.startedAttemptGenerationSpendDiagnostic} (MODELED diagnostic; started-attempt denominator ${result.startedAttemptCount})`))
  sections.push(kv('generationCostP50', String(result.generationCostP50.state === 'PRESENT' ? result.generationCostP50.value : result.generationCostP50.state)))
  sections.push(kv('generationCostP95', String(result.generationCostP95.state === 'PRESENT' ? result.generationCostP95.value : result.generationCostP95.state)))
  sections.push(kv('combinedTotalNovelCostP50', String(result.combinedTotalNovelCostP50.state === 'PRESENT' ? result.combinedTotalNovelCostP50.value : result.combinedTotalNovelCostP50.state)))
  sections.push(kv('combinedTotalNovelCostP95', String(result.combinedTotalNovelCostP95.state === 'PRESENT' ? result.combinedTotalNovelCostP95.value : result.combinedTotalNovelCostP95.state)))
  sections.push(`- rincian mean per bab (1..50)`);
  for (let chapterNumber = 1; chapterNumber <= 50; chapterNumber += 1) {
    const modeledMean = result.chapterMeans[chapterNumber - 1]!
    const observedMean = artifact.observedChapterCostMeans[chapterNumber - 1]!
    sections.push(line(`bab ${String(chapterNumber).padStart(2, '0')}: modeled mean ${measurementValue(modeledMean)} (denominator ${String(result.chapterMeanDenominators[chapterNumber - 1]!)}); observed mean ${measurementValue(observedMean)} (denominator ${String(artifact.observedChapterMeanDenominators[chapterNumber - 1]!)})`))
  }
  sections.push(line('Semua mean memakai penjumlahan koefisien eksak, pembagian skala antara 20, dan pembulatan HALF_UP ke skala 8; judge dikecualikan dari mean generasi.'))
  sections.push(line('Hasil model bersifat MODELED dan tidak pernah menjadi kebenaran teramati.'))

  // 7. Sensitivity bands
  sections.push(`## 7. Pita Sensitivitas (Sensitivity Bands)`)
  const bands = result.sensitivityBands
  if (bands === null) {
    sections.push(kv('sensitivityBands', 'TIDAK_TERSEDIA'))
    sections.push(line('Pita sensitivitas lower/central/upper tidak tersedia: input sensitivitas tidak diberikan; gerbang teknikal menahan tanpa pita lengkap.'))
  } else {
    sections.push(line('Probabilitas lower/upper adalah ASSUMPTION eksplisit; pita central memakai hanya probabilitas OBSERVED.'))
    for (const band of ['lower', 'central', 'upper'] as const) {
      const value = bands[band]
      const prefix = `sensitivity.${band}.`
      sections.push(kv(`${prefix}completionProbability`, String(value.completionProbability)))
      sections.push(kv(`${prefix}terminalFailureProbability`, String(value.terminalFailureProbability)))
      sections.push(kv(`${prefix}expectedRetryCount`, String(value.expectedRetryCount)))
      sections.push(kv(`${prefix}expectedGenerationProviderCallCount`, String(value.expectedGenerationProviderCallCount)))
      sections.push(kv(`${prefix}expectedJudgeProviderCallCount`, String(value.expectedJudgeProviderCallCount)))
      sections.push(kv(`${prefix}expectedTotalProviderCallCount`, String(value.expectedTotalProviderCallCount)))
      sections.push(measurementLine(`${prefix}maxExpectedCostPerChapter`, value.maxExpectedCostPerChapter, 'MODELED'))
      sections.push(measurementLine(`${prefix}modeledFirstAttemptBaselineCost`, value.modeledFirstAttemptBaselineCost, 'MODELED'))
      sections.push(measurementLine(`${prefix}modeledRetryFallbackCost`, value.modeledRetryFallbackCost, 'MODELED'))
      sections.push(measurementLine(`${prefix}modeledRetryOverheadPercentage`, value.modeledRetryOverheadPercentage, 'MODELED'))
      sections.push(measurementLine(`${prefix}successfulRunGenerationMean`, value.successfulRunGenerationMean, 'MODELED'))
      sections.push(measurementLine(`${prefix}modeledJudgeTotal`, value.modeledJudgeTotal, 'MODELED'))
      sections.push(measurementLine(`${prefix}modeledCombinedTotalNovelCostP95`, value.modeledCombinedTotalNovelCostP95, 'MODELED'))
      sections.push(kv(`${prefix}costComponentDenominator`, String(value.costComponentDenominator)))
    }
  }
  sections.push(line('Pita dilaporkan sebagai rentang model yang deterministik; bukan jaminan produksi dan bukan korelasi terukur.'))

  // 8. Engineering gate
  sections.push(`## 8. Gerbang Teknikal (Engineering Gate)`)
  const verdict = artifact.engineeringGate.result
  sections.push(kv('engineeringGate', verdict.engineeringGate))
  sections.push(kv('releaseReadiness', verdict.releaseReadiness))
  sections.push(kv('reasonCodes', verdict.reasonCodes.length === 0 ? '(tidak ada)' : verdict.reasonCodes.join(', ')))
  if (verdict.error !== null) sections.push(kv('error', verdict.error))
  sections.push(line(`${profile} engineering PASS hanya membuktikan validitas kontrak/aritmetika/determinisme; tidak menyiratkan kesiapan rilis dan tidak menutup G2-BUDGET atau M10-E.`))

  // 9. E0 budget status
  sections.push(`## 9. Status Anggaran E0 (E0 Budget Status)`)
  const budget = artifact.budget.result
  sections.push(kv('budgetGate', budget.budgetGate))
  if (budget.status === 'APPROVED_EVALUATED') {
    sections.push(kv('e0Authority', `${budget.authority.policyId} ${budget.authority.policyVersion} (${budget.authority.approvalStatus}; hash \`${budget.authority.canonicalHash}\`)`))
    sections.push(`- perbandingan (komparator <= langit-langit; kesetaraan lolos):`)
    for (const comparison of budget.comparisons) {
      sections.push(line(`${comparison.dimension}: ceiling ${String(comparison.ceiling ?? 'N/A')}; modeled ${comparison.modeled.outcome} (${measurementValue(comparison.modeled.value)}); observed ${comparison.observed.outcome} (${measurementValue(comparison.observed.value)})`))
    }
    if (budget.error !== null) sections.push(kv('budgetError', budget.error))
  } else if (budget.status === 'SUPPLIED_E0_INVALID') {
    sections.push(kv('budgetError', budget.error))
  } else {
    sections.push(line('Tidak ada otoritas E0 yang disetujui; klasifikasi blocked eksplisit. Persetujuan anggaran bisnis dibutuhkan sebelum evaluasi komparator.'))
  }
  for (const status of STATUS_LINES(artifact)) sections.push(line(status))

  // 10. Blockers and gaps
  sections.push(`## 10. Penghambat dan Celah (Blockers and Gaps)`)
  const holds = artifact.reasonCodes.filter((reason) => reason !== 'MALFORMED_EVIDENCE')
  if (holds.length === 0) {
    sections.push(line('Tidak ada penahan gerbang teknikal yang dipicu.'))
  } else {
    for (const reason of holds) sections.push(line(`gateReason.${reason}`))
  }
  for (const item of artifact.aggregate.requiredMetrics) {
    if (item.value.state === 'MISSING') {
      sections.push(line(`celah cakupan: ${item.metricId} — ${item.value.detail} (included ${item.counts.includedCount}, excluded ${item.counts.excludedCount}, eligible ${item.counts.eligibleCount})`))
    }
  }
  for (const cell of completeness.profileCompleteness.stagePools) {
    if (!cell.complete) sections.push(line(`celah threshold: stage pool ${cell.stageId} teramati ${cell.observed} < minimum ${cell.minimum}`))
  }
  for (const cell of completeness.profileCompleteness.applicableCells) {
    if (!cell.complete) sections.push(line(`celah threshold: eligible cell bab ${cell.chapterNumber} ${cell.stageId} teramati ${cell.observed} < minimum ${cell.minimum}`))
  }
  if (!completeness.profileCompleteness.completeNovels.complete) {
    sections.push(line(`celah threshold: novel lengkap teramati ${completeness.profileCompleteness.completeNovels.observed} < minimum ${completeness.profileCompleteness.completeNovels.minimum}`))
  }
  sections.push(line('Observasi tak lengkap dikecualikan dari mean/maks/p95, tidak pernah menjadi nol, dan dilaporkan lewat hitungan included/excluded/eligible dan rasio cakupan.'))

  // 11. Prohibited claims
  sections.push(`## 11. Klaim yang Dilarang (Prohibited Claims)`)
  sections.push(line(`${profile} membuktikan plumbing, aritmetika, determinisme, dan kebenaran kontrak engineering saja; ia tidak membuktikan ekonomi penyedia nyata tanpa RELEASE_EVIDENCE yang terotorisasi terpisah.`))
  sections.push(line('Tidak boleh diklaim: insidens produksi, korelasi produksi, reliabilitas produksi, atau ekonomi produksi tanpa dukungan RELEASE_EVIDENCE terotorisasi.'))
  sections.push(line('Exchangeability tidak boleh diklaim sebagai kebenaran teramati; independensi draw dan eksekusi judge deterministik adalah asumsi model.'))
  sections.push(line('Probabilitas sel per-bab yang kuat bukan input model pusat; topologi kondisional V1 dan semua keluaran model adalah model, bukan ukuran produksi.'))
  sections.push(line('Tidak ada klaim penutupan G2-BUDGET atau M10-E; keduanya tetap OPEN.'))
  sections.push(line('Laporan ini tidak mengandung data pribadi pembaca, konten prosa, prompt/response model, URL privat, atau kredensial layanan.'))

  const footer = [
    '',
    '---',
    'Deterministik: konten laporan hanya berasal dari artifacts semantik tervalidasi; hash laporan = SHA-256 byte Markdown persis.',
  ]
  return sections.join('\n') + footer.join('\n') + '\n'
}

function measurementValue(state: { state: string; value?: unknown; detail?: string }): string {
  if (state.state === 'PRESENT') return String(state.value)
  if (state.state === 'MISSING') return `MISSING(${String(state.detail ?? '')})`
  return 'NOT_APPLICABLE'
}

export function assertReliabilityReportHasNoProhibitedClaims(reportBytes: string): void {
  const lowered = reportBytes.toLowerCase()
  const forbiddenClaimPatterns = [
    /release readiness\s*=\s*ready/i,
    /closing?\s+(g2-budget|m10-e)/i,
    /observ(?:ed|e?d)?\s+independence/i,
    /chapter(?:s)?\s+invariant/i,
    /judge reliability/i,
    /production (?:incidence|correlation|reliability|economics) proven/i,
  ]
  for (const pattern of forbiddenClaimPatterns) {
    if (pattern.test(lowered)) throw new Error(`Report contains prohibited claim matching ${String(pattern)}`)
  }
}

export function assertReliabilityReportHasNoPrivateData(reportBytes: string): void {
  const lowered = reportBytes.toLowerCase()
  const privatePatterns = [
    /@[a-z0-9._-]+\.[a-z]{2,}/i,
    /(service[_-]?key|api[_-]?key|secret|password)/i,
    /(?:postgres|psql|supabase)\.(?:co|com|org|network)|localhost|127\.0\.0\.1|0\.0\.0\.0/i,
  ]
  for (const pattern of privatePatterns) {
    if (pattern.test(lowered)) throw new Error(`Report may leak private/secret material matching ${String(pattern)}`)
  }
}