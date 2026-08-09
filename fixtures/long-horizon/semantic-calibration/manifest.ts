import {
  D1_EXPECTED_ROW_COUNT,
  D1_PARTITIONS,
  D1_ROWS_PER_RUBRIC_PARTITION,
  D1_RUBRICS,
  D1_TIERS,
  type D1CorpusFixture,
  type D1Partition,
  type D1RubricId,
  type D1RubricRow,
  type D1Tier,
} from './corpus'
import { D1_SCENARIOS, paragraphForTier } from './contexts'
import { SemanticCorpusManifestSchema, SemanticCorpusRubricRowSchema } from '../../../lib/narrative-qa/contracts/semantic-judge-contract'
import { computeSha256, stableStringify } from '../../../lib/narrative-qa/scoring/canonical-serializer'

const tierCount: Readonly<Record<D1Tier, number>> = {
  STRONG: 5,
  WEAK: 5,
  BORDERLINE: 3,
}

function chapter(chapterNumber: number, title: string, prose: string): D1CorpusFixture['chapters'][number] {
  return { chapterNumber, title, paragraphs: [prose] }
}

function chaptersFor(
  rubricId: D1RubricId,
  tier: D1Tier,
  variant: number,
  partition: D1Partition,
): D1CorpusFixture['chapters'] {
  const scenario = D1_SCENARIOS[rubricId]
  const suffix = `${partition === 'CALIBRATION' ? 'kalibrasi' : 'holdout'}-${variant + 1}`
  const standard = [
    chapter(18, 'Jembatan Menjelang Fajar', `${scenario.setup} Catatan ${suffix} menjaga konteks ini sebagai data cerita.`),
    chapter(19, 'Harga Sebuah Nama', paragraphForTier(rubricId, tier, 19, variant)),
    chapter(20, 'Gerbang yang Tersisa', `${scenario.payoff} Detail ${suffix} membedakan fixture ini dari fixture lain.`),
  ]

  if (rubricId === 'D-R4') {
    return [
      chapter(14, 'Arsip Berdebu', `${scenario.setup} Sari menemukan cap lilin biru di bawah daftar pengiriman.`),
      chapter(15, 'Lorong Sunyi', paragraphForTier(rubricId, tier, 15, variant)),
      chapter(16, 'Pertemuan Kedua', `${tier === 'WEAK' ? 'Damar kembali menyangkal cap lilin biru; Sari kembali menuduhnya, lalu keduanya pergi tanpa perubahan.' : `${paragraphForTier(rubricId, tier, 16, variant)} ${scenario.payoff}`}`),
      chapter(30, 'Pintu Sidang', 'Sari membawa cap lilin ke tribunal dan memilih menguji asalnya, bukan mengulang tuduhan lama.'),
      chapter(31, 'Saksi Palsu', paragraphForTier(rubricId, tier, 31, variant)),
      chapter(32, 'Tribunal', `${scenario.payoff} Di sini cap lilin bukan pengulangan jawaban lama, melainkan bukti siapa yang memalsukan daftar. Variasi ${suffix}.`),
    ]
  }

  if (rubricId === 'D-R6') {
    return [
      chapter(6, 'Kompas Milik Adik', `${scenario.setup} Jarumnya selalu berhenti ke arah rumah lama.`),
      chapter(21, 'Janji yang Menunggu', paragraphForTier(rubricId, tier, 21, variant)),
      chapter(34, 'Jarum dan Buku Besar', `${tier === 'WEAK' ? 'Sari berkata masalah kompas sudah selesai, lalu menyerahkannya tanpa membuka ledger atau menghadapi alasan ia menyembunyikan kebenaran.' : `${scenario.payoff} ${paragraphForTier(rubricId, tier, 34, variant)}`} Variasi ${suffix}.`),
    ]
  }

  if (rubricId === 'D-R7') {
    const bab49 = tier === 'STRONG'
      ? 'Sari menaruh surat ibunya di meja. Ia mengakui marahnya tidak hilang, tetapi ia tidak lagi memakai marah itu untuk menghukum dirinya. Ketika ibunya meminta maaf, Sari tidak memberi pengampunan mudah; ia meminta mereka membangun kembali kepercayaan lewat kesaksian besok.'
      : tier === 'WEAK'
        ? 'Sari memeriksa daftar saksi, menghitung penjaga, lalu mengirim pesan agar gerbang timur dibuka saat pagi. Ia menyimpan surat ibunya tanpa membacanya lagi. Rencana pengadilan selesai disusun.'
        : 'Sari berkata ia mendengar penjelasan ibunya dan matanya basah. Sebelum ia menjawab apakah hubungan mereka masih mungkin, pengawal mengetuk pintu dan membawa kabar sidang dimajukan.'
    return [
      chapter(45, 'Surat yang Disembunyikan', `${scenario.setup} Sari belum tahu apa yang akan ia lakukan dengan luka itu.`),
      chapter(48, 'Malam Sebelum Sidang', paragraphForTier(rubricId, tier, 48, variant)),
      chapter(49, 'Nama yang Dipilih', `${bab49} Variasi ${suffix}.`),
    ]
  }

  if (rubricId === 'D-R8') {
    const bab50 = tier === 'STRONG'
      ? 'Di depan warga, Sari menyerahkan bukti kepada tiga saksi, bukan kepada amarah massa. Ia memilih proses yang lambat karena pertanyaan terakhirnya bukan lagi bagaimana menang, melainkan keadilan macam apa yang sanggup ia tinggali. Saat gerbang dibuka kembali, ia pulang untuk memulai pekerjaan itu.'
      : tier === 'WEAK'
        ? 'Regent jatuh. Sari melihat matahari, menaiki kuda, dan pergi ke utara. Tamat.'
        : 'Sari memilih membawa bukti kepada saksi dan menolak kerusuhan. Warga mulai membubarkan diri, tetapi kisah berhenti sebelum terlihat harga pilihannya bagi kota atau keluarganya.'
    return [
      chapter(44, 'Dua Jalan di Alun-Alun', `${scenario.setup} Pilihan itu dibicarakan dengan saksi dan keluarga.`),
      chapter(47, 'Harga Kesaksian', paragraphForTier(rubricId, tier, 47, variant)),
      chapter(49, 'Pagi yang Ditahan', `${scenario.payoff} Namun jawaban belum diputuskan.`),
      chapter(50, 'Gerbang Terbuka', `${bab50} Variasi ${suffix}.`),
    ]
  }

  return standard
}

function justificationFor(rubricId: D1RubricId, tier: D1Tier, index: number): string {
  const scenario = D1_SCENARIOS[rubricId]
  const tierReason = tier === 'STRONG'
    ? scenario.strong
    : tier === 'WEAK'
      ? scenario.weak
      : scenario.borderline
  return `${rubricId} ${tier.toLowerCase()} row ${index + 1}: ${tierReason} Review must judge ${scenario.focus} from prose, not structural context.`
}

export function canonicalFixtureContent(fixture: Pick<D1CorpusFixture, 'chapters'>): string {
  return stableStringify(fixture.chapters)
}

export function computeFixtureContentHash(fixture: Pick<D1CorpusFixture, 'chapters'>): string {
  return computeSha256(canonicalFixtureContent(fixture))
}

function parseD1Rows(rows: readonly D1RubricRow[]): void {
  for (const row of rows) SemanticCorpusRubricRowSchema.parse(row)
}

function makeRow(
  rubricId: D1RubricId,
  partition: D1Partition,
  tier: D1Tier,
  index: number,
): D1RubricRow {
  const key = `${partition.toLowerCase()}-${rubricId.toLowerCase()}-${tier.toLowerCase()}-${index + 1}`
  const chapters = chaptersFor(rubricId, tier, index, partition)
  const fixtureWithoutHash = {
    fixtureId: `d1-fixture-${key}`,
    // Five variants share one base family; weak/borderline variants mutate one rubric axis.
    fixtureFamilyId: `d1-family-${partition.toLowerCase()}-${rubricId.toLowerCase()}-${tier.toLowerCase()}`,
    // One rubric-specific story lineage per partition, never crossing partitions.
    lineageId: `d1-lineage-${partition.toLowerCase()}-${rubricId.toLowerCase()}`,
    mutationSiblingId: `d1-sibling-${partition.toLowerCase()}-${rubricId.toLowerCase()}-${tier.toLowerCase()}-${index === 0 ? 'base' : `mutation-${index + 1}`}`,
    partition,
    provenance: 'human-authored' as const,
    chapters,
    structuralContext: {
      storyPromise: 'Sari membuktikan pengkhianatan Regent tanpa mewarisi kekerasannya.',
      finalDramaticQuestion: 'Akankah Sari memilih keadilan yang bisa ia pertanggungjawabkan setelah pengkhianatan keluarganya?',
      actPosition: rubricId === 'D-R7' || rubricId === 'D-R8' ? 'penutupan Bab 45–50' : 'tekanan pertengahan cerita',
      setupAndPayoff: `${D1_SCENARIOS[rubricId].setup} ${D1_SCENARIOS[rubricId].payoff}`,
    },
  }
  const fixture: D1CorpusFixture = { ...fixtureWithoutHash, contentHash: computeFixtureContentHash(fixtureWithoutHash) }
  return {
    rowId: `d1-row-${key}`,
    rubricId,
    partition,
    tier,
    fixture,
    reviewState: 'PENDING_REVIEW',
    justification: justificationFor(rubricId, tier, index),
  }
}

/** Frozen deterministic list: 8 rubrics × 2 partitions × (5 strong + 5 weak + 3 borderline). */
export const D1_RUBRIC_ROWS: readonly D1RubricRow[] = Object.freeze(
  D1_PARTITIONS.flatMap((partition) => D1_RUBRICS.flatMap((rubricId) =>
    D1_TIERS.flatMap((tier) => Array.from(
      { length: tierCount[tier] },
      (_, index) => makeRow(rubricId, partition, tier, index),
    )),
  )),
)

export function computeD1ManifestHash(rows: readonly D1RubricRow[]): string {
  parseD1Rows(rows)
  return computeSha256(stableStringify(rows.map((row) => ({
    rowId: row.rowId,
    rubricId: row.rubricId,
    partition: row.partition,
    tier: row.tier,
    reviewState: row.reviewState,
    justification: row.justification,
    fixtureId: row.fixture.fixtureId,
    fixtureFamilyId: row.fixture.fixtureFamilyId,
    lineageId: row.fixture.lineageId,
    mutationSiblingId: row.fixture.mutationSiblingId,
    contentHash: row.fixture.contentHash,
  }))))
}

export interface D1Manifest {
  schemaVersion: 1
  corpusId: 'M10-D1-semantic-calibration-v1'
  provenance: 'frozen human-authored fixture corpus'
  manifestHash: string
  rows: readonly D1RubricRow[]
}

export const D1_MANIFEST: D1Manifest = Object.freeze({
  schemaVersion: 1,
  corpusId: 'M10-D1-semantic-calibration-v1',
  provenance: 'frozen human-authored fixture corpus',
  manifestHash: computeD1ManifestHash(D1_RUBRIC_ROWS),
  rows: D1_RUBRIC_ROWS,
})

export function assertD1Manifest(manifest: D1Manifest = D1_MANIFEST): void {
  SemanticCorpusManifestSchema.parse(manifest)
  if (manifest.manifestHash !== computeD1ManifestHash(manifest.rows)) {
    throw new Error('Frozen manifestHash does not match registered labels and fixture hashes.')
  }
}

export function d1MatrixCount(
  rubricId: D1RubricId,
  partition: D1Partition,
  tier: D1Tier,
): number {
  parseD1Rows(D1_RUBRIC_ROWS)
  return D1_RUBRIC_ROWS.filter((row) => row.rubricId === rubricId && row.partition === partition && row.tier === tier).length
}

export function assertD1CorpusIsolation(rows: readonly D1RubricRow[]): void {
  parseD1Rows(rows)
  for (const field of ['fixtureFamilyId', 'lineageId', 'mutationSiblingId'] as const) {
    const calibration = new Set(rows.filter((row) => row.partition === 'CALIBRATION').map((row) => row.fixture[field]))
    const holdout = new Set(rows.filter((row) => row.partition === 'VALIDATION_HOLDOUT').map((row) => row.fixture[field]))
    if ([...calibration].some((identity) => holdout.has(identity))) {
      throw new Error(`Cross-partition ${field} is forbidden.`)
    }
  }
  const calibrationHashes = new Set(rows.filter((row) => row.partition === 'CALIBRATION').map((row) => row.fixture.contentHash))
  const holdoutHashes = new Set(rows.filter((row) => row.partition === 'VALIDATION_HOLDOUT').map((row) => row.fixture.contentHash))
  if ([...calibrationHashes].some((contentHash) => holdoutHashes.has(contentHash))) {
    throw new Error('Cross-partition contentHash is forbidden.')
  }
}

export function assertD1CorpusMatrix(rows: readonly D1RubricRow[] = D1_RUBRIC_ROWS): void {
  parseD1Rows(rows)
  if (rows.length !== D1_EXPECTED_ROW_COUNT) throw new Error(`Expected ${D1_EXPECTED_ROW_COUNT} D1 rows.`)
  for (const rubricId of D1_RUBRICS) for (const partition of D1_PARTITIONS) {
    if (rows.filter((row) => row.rubricId === rubricId && row.partition === partition).length !== D1_ROWS_PER_RUBRIC_PARTITION) {
      throw new Error(`Expected ${D1_ROWS_PER_RUBRIC_PARTITION} rows for ${rubricId}/${partition}.`)
    }
    for (const tier of D1_TIERS) if (rows.filter((row) => row.rubricId === rubricId && row.partition === partition && row.tier === tier).length !== tierCount[tier]) {
      throw new Error(`Invalid ${tier} count for ${rubricId}/${partition}.`)
    }
  }
  const fixtureIds = rows.map((row) => row.fixture.fixtureId)
  if (new Set(fixtureIds).size !== fixtureIds.length) throw new Error('Duplicate fixtureId.')
  if (rows.some((row) => row.fixture.contentHash !== computeFixtureContentHash(row.fixture))) {
    throw new Error('Frozen contentHash does not match canonical fixture content.')
  }
  if (new Set(rows.map((row) => row.fixture.contentHash)).size !== rows.length) throw new Error('Duplicate canonical fixture content.')
  if (rows.some((row) => row.reviewState !== 'PENDING_REVIEW' || row.justification.length === 0)) {
    throw new Error('Every D1 row needs PENDING_REVIEW and written justification.')
  }
  assertD1CorpusIsolation(rows)
}

assertD1CorpusMatrix()
assertD1Manifest()
