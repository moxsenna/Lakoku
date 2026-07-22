/**
 * Taste Profile V2 — stable IDs, Indonesian labels, V1 migration maps.
 *
 * ID stabil = canonical key. Label boleh berubah tanpa merusak data.
 * File ini tidak import schema.ts (hindari circular).
 */

// ═══════════════════════════════════════════════════════════════════════
// Genre
// ═══════════════════════════════════════════════════════════════════════

export const GENRE_IDS = [
  'family_drama',
  'romance',
  'mystery',
  'fantasy_kingdom',
  'slice_of_life',
  'survival_thriller',
] as const

export type GenreCatalogId = (typeof GENRE_IDS)[number]

export const GENRE_CATALOG: ReadonlyArray<{ id: GenreCatalogId; label: string }> = [
  { id: 'family_drama', label: 'Drama keluarga' },
  { id: 'romance', label: 'Romansa' },
  { id: 'mystery', label: 'Misteri & rahasia' },
  { id: 'fantasy_kingdom', label: 'Fantasi & kerajaan' },
  { id: 'slice_of_life', label: 'Slice of life' },
  { id: 'survival_thriller', label: 'Thriller & bertahan hidup' },
]

/** Genre ID → Indonesian display label */
export const GENRE_LABEL: Record<string, string> = Object.fromEntries(
  GENRE_CATALOG.map((g) => [g.id, g.label]),
)

/** Indonesian label (lower) → Genre ID */
export const GENRE_BY_LABEL: Record<string, string> = {}
for (const g of GENRE_CATALOG) {
  GENRE_BY_LABEL[g.label.toLowerCase()] = g.id
}

/** V1 genre label → V2 genre id (normalized keys, lowercase) */
export const V1_GENRE_LABEL_TO_ID: Record<string, string> = {
  'drama keluarga': 'family_drama',
  romansa: 'romance',
  romance: 'romance',
  'misteri & rahasia': 'mystery',
  misteri: 'mystery',
  'misteri keluarga': 'mystery',
  'fantasi & kerajaan': 'fantasy_kingdom',
  fantasi: 'fantasy_kingdom',
  'fantasi epik': 'fantasy_kingdom',
  'fantasi petualangan': 'fantasy_kingdom',
  petualangan: 'fantasy_kingdom',
  'slice of life': 'slice_of_life',
  'thriller & bertahan hidup': 'survival_thriller',
  thriller: 'survival_thriller',
}

/** @deprecated alias — same as V1_GENRE_LABEL_TO_ID */
export const GENRE_V1_ALIAS_MAP = V1_GENRE_LABEL_TO_ID

export function resolveGenreId(raw: string): string | null {
  const token = raw.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
  if (!token) return null
  return V1_GENRE_LABEL_TO_ID[token] ?? GENRE_BY_LABEL[token] ?? null
}

export function isGenreId(id: string): boolean {
  return (GENRE_IDS as readonly string[]).includes(id)
}

// ═══════════════════════════════════════════════════════════════════════
// Conflicts per genre (plan §6.3) — 6 each, stable IDs
// ═══════════════════════════════════════════════════════════════════════

export type ConflictEntry = { id: string; label: string }

export const CONFLICT_CATALOG_BY_GENRE: Record<string, readonly ConflictEntry[]> = {
  family_drama: [
    { id: 'family_inheritance_split', label: 'Warisan yang memecah keluarga' },
    { id: 'family_return_with_secret', label: 'Anak yang pulang membawa rahasia' },
    { id: 'family_parent_hidden_past', label: 'Masa lalu orang tua yang sengaja ditutup' },
    { id: 'family_sibling_rivalry', label: 'Saudara yang berubah menjadi rival' },
    { id: 'family_unknown_sacrifice', label: 'Pengorbanan lama yang tak pernah diketahui' },
    {
      id: 'family_chosen_vs_blood',
      label: 'Memilih antara keluarga kandung dan keluarga yang menerima kita',
    },
  ],
  romance: [
    { id: 'romance_enemies_allies', label: 'Dua musuh yang terpaksa bekerja sama' },
    { id: 'romance_old_love_returns', label: 'Cinta lama kembali saat hidup sudah berubah' },
    {
      id: 'romance_contract_relationship',
      label: 'Hubungan kontrak yang perlahan menjadi nyata',
    },
    { id: 'romance_friends_hidden_feelings', label: 'Sahabat yang lama menyimpan perasaan' },
    { id: 'romance_different_worlds', label: 'Dua orang dari dunia yang sulit disatukan' },
    { id: 'romance_second_chance', label: 'Kesempatan kedua setelah hubungan yang hancur' },
  ],
  mystery: [
    { id: 'mystery_hidden_identity', label: 'Identitas asli yang sengaja disembunyikan' },
    { id: 'mystery_old_death', label: 'Kematian lama yang menyisakan kejanggalan' },
    { id: 'mystery_old_object_clue', label: 'Surat atau benda lama yang membuka rahasia' },
    { id: 'mystery_conflicting_witness', label: 'Saksi yang muncul dengan cerita berbeda' },
    { id: 'mystery_missing_person', label: 'Hilangnya seseorang yang terkait masa lalu' },
    {
      id: 'mystery_family_coverup',
      label: 'Keluarga besar yang bersama-sama menutup kebenaran',
    },
  ],
  fantasy_kingdom: [
    { id: 'fantasy_throne_struggle', label: 'Perebutan takhta yang mengancam kerajaan' },
    { id: 'fantasy_forbidden_magic', label: 'Sihir terlarang yang kembali bangkit' },
    { id: 'fantasy_hidden_heir', label: 'Pewaris yang tidak mengetahui asal-usulnya' },
    {
      id: 'fantasy_misread_prophecy',
      label: 'Ramalan yang selama ini dipahami dengan salah',
    },
    { id: 'fantasy_fragile_alliance', label: 'Aliansi dua kerajaan yang nyaris runtuh' },
    {
      id: 'fantasy_curse_price',
      label: 'Kutukan yang hanya bisa dipatahkan dengan harga besar',
    },
  ],
  slice_of_life: [
    { id: 'slice_new_life', label: 'Memulai hidup baru di tempat yang asing' },
    { id: 'slice_return_home', label: 'Pulang dan menghadapi masa lalu yang belum selesai' },
    { id: 'slice_adult_friendship', label: 'Persahabatan dewasa yang tumbuh di saat sulit' },
    { id: 'slice_small_dream', label: 'Mimpi kecil yang perlahan menjadi nyata' },
    { id: 'slice_community', label: 'Menemukan keluarga baru di sebuah komunitas' },
    {
      id: 'slice_second_career',
      label: 'Kesempatan kedua untuk mengejar jalan hidup berbeda',
    },
  ],
  survival_thriller: [
    { id: 'thriller_trapped', label: 'Terjebak di tempat tanpa jalan keluar' },
    { id: 'thriller_hunted_by_past', label: 'Diburu oleh sesuatu dari masa lalu' },
    { id: 'thriller_betrayer_inside', label: 'Salah satu sekutu ternyata berkhianat' },
    {
      id: 'thriller_race_against_time',
      label: 'Berpacu dengan waktu sebelum semuanya terlambat',
    },
    {
      id: 'thriller_survival_sacrifice',
      label: 'Bertahan hidup dengan pilihan yang menuntut pengorbanan',
    },
    {
      id: 'thriller_personal_conspiracy',
      label: 'Konspirasi besar yang berpusat pada tokoh utama',
    },
  ],
}

/** Labels only (compat for buildOptions / resolver). Prefer CONFLICT_CATALOG_BY_GENRE. */
export const CONFLICT_CATALOG: Record<string, readonly string[]> = Object.fromEntries(
  Object.entries(CONFLICT_CATALOG_BY_GENRE).map(([genre, entries]) => [
    genre,
    entries.map((e) => e.label),
  ]),
)

/** Flat conflict id → label */
export const CONFLICT_LABEL: Record<string, string> = {}
for (const entries of Object.values(CONFLICT_CATALOG_BY_GENRE)) {
  for (const e of entries) {
    CONFLICT_LABEL[e.id] = e.label
  }
}

/** Conflict label (lower) → id */
export const CONFLICT_BY_LABEL: Record<string, string> = {}
for (const [id, label] of Object.entries(CONFLICT_LABEL)) {
  CONFLICT_BY_LABEL[label.toLowerCase()] = id
}

/** Partial V1 liked-trope labels → conflict ids */
export const V1_LIKED_TROPE_TO_CONFLICT: Record<string, string> = {
  'konflik warisan yang memecah keluarga': 'family_inheritance_split',
  'warisan yang memecah keluarga': 'family_inheritance_split',
  'rahasia keluarga & warisan': 'family_inheritance_split',
  'rahasia keluarga dan warisan': 'family_inheritance_split',
  'anak yang kembali setelah bertahun-tahun': 'family_return_with_secret',
  'anak yang pulang membawa rahasia': 'family_return_with_secret',
  'pengorbanan demi keluarga': 'family_unknown_sacrifice',
  'cinta lama yang kembali': 'romance_old_love_returns',
  'cinta lama kembali saat hidup sudah berubah': 'romance_old_love_returns',
  'pernikahan kontrak': 'romance_contract_relationship',
  'hubungan kontrak yang perlahan menjadi nyata': 'romance_contract_relationship',
  'pernikahan kontrak yang berubah arah': 'romance_contract_relationship',
  'sekutu jadi cinta': 'romance_enemies_allies',
  'dua musuh yang terpaksa bekerja sama': 'romance_enemies_allies',
  'hubungan pura-pura yang jadi nyata': 'romance_contract_relationship',
  'cinta yang harus diperjuangkan lagi': 'romance_second_chance',
  'kesempatan kedua setelah hubungan yang hancur': 'romance_second_chance',
  'rahasia keluarga yang dikubur lama': 'mystery_family_coverup',
  'identitas asli yang disembunyikan': 'mystery_hidden_identity',
  'identitas asli yang sengaja disembunyikan': 'mystery_hidden_identity',
  'kematian lama yang belum terjawab': 'mystery_old_death',
  'kematian lama yang menyisakan kejanggalan': 'mystery_old_death',
  'surat lama yang mengubah warisan': 'mystery_old_object_clue',
  'surat atau benda lama yang membuka rahasia': 'mystery_old_object_clue',
  'saksi yang tiba-tiba muncul': 'mystery_conflicting_witness',
  'saksi yang muncul dengan cerita berbeda': 'mystery_conflicting_witness',
  'kebenaran yang sengaja ditutup keluarga': 'mystery_family_coverup',
  'tahta yang diperebutkan': 'fantasy_throne_struggle',
  'perebutan takhta yang mengancam kerajaan': 'fantasy_throne_struggle',
  'sihir terlarang yang kembali muncul': 'fantasy_forbidden_magic',
  'sihir terlarang yang kembali bangkit': 'fantasy_forbidden_magic',
  'ramalan yang mengubah segalanya': 'fantasy_misread_prophecy',
  'ramalan yang selama ini dipahami dengan salah': 'fantasy_misread_prophecy',
  'aliansi dua kerajaan yang rapuh': 'fantasy_fragile_alliance',
  'aliansi dua kerajaan yang nyaris runtuh': 'fantasy_fragile_alliance',
  'pengkhianatan di balik takhta': 'fantasy_throne_struggle',
  'takdir kerajaan yang tersembunyi': 'fantasy_hidden_heir',
  'hidup baru di tempat tak terduga': 'slice_new_life',
  'memulai hidup baru di tempat yang asing': 'slice_new_life',
  'pulang ke kampung halaman': 'slice_return_home',
  'pulang dan menghadapi masa lalu yang belum selesai': 'slice_return_home',
  'persahabatan yang mengubah hidup': 'slice_adult_friendship',
  'mimpi kecil yang akhirnya tercapai': 'slice_small_dream',
  'mimpi kecil yang perlahan menjadi nyata': 'slice_small_dream',
  'terjebak tanpa jalan keluar': 'thriller_trapped',
  'terjebak di tempat tanpa jalan keluar': 'thriller_trapped',
  'berlari dari masa lalu': 'thriller_hunted_by_past',
  'dikhianati oleh orang terdekat': 'thriller_betrayer_inside',
  'salah satu sekutu ternyata berkhianat': 'thriller_betrayer_inside',
  'balas dendam yang tertunda': 'thriller_personal_conspiracy',
}

// ═══════════════════════════════════════════════════════════════════════
// Soft avoidances (plan §6.4 A)
// ═══════════════════════════════════════════════════════════════════════

export const SOFT_AVOIDANCE_IDS = [
  'avoid_unearned_twist',
  'avoid_plot_induced_stupidity',
  'avoid_repetitive_conflict',
  'avoid_unanswered_secret',
  'avoid_excessive_melodrama',
  'avoid_romance_takeover',
  'avoid_shock_death',
  'avoid_ambiguous_ending',
] as const

export type SoftAvoidanceId = (typeof SOFT_AVOIDANCE_IDS)[number]

export const SOFT_AVOIDANCE_CATALOG: ReadonlyArray<{ id: SoftAvoidanceId; label: string }> = [
  { id: 'avoid_unearned_twist', label: 'Twist yang muncul tanpa petunjuk' },
  { id: 'avoid_plot_induced_stupidity', label: 'Tokoh bertindak bodoh hanya demi plot' },
  { id: 'avoid_repetitive_conflict', label: 'Konflik yang berulang tanpa perkembangan' },
  { id: 'avoid_unanswered_secret', label: 'Rahasia penting dibiarkan tanpa jawaban' },
  { id: 'avoid_excessive_melodrama', label: 'Drama yang terlalu dipaksakan' },
  { id: 'avoid_romance_takeover', label: 'Romansa mengambil alih cerita utama' },
  { id: 'avoid_shock_death', label: 'Kematian tokoh hanya demi kejutan' },
  { id: 'avoid_ambiguous_ending', label: 'Akhir menggantung tanpa kepastian yang cukup' },
]

export const SOFT_AVOIDANCE_LABEL: Record<string, string> = Object.fromEntries(
  SOFT_AVOIDANCE_CATALOG.map((e) => [e.id, e.label]),
)

export const SOFT_AVOIDANCE_BY_LABEL: Record<string, string> = {}
for (const e of SOFT_AVOIDANCE_CATALOG) {
  SOFT_AVOIDANCE_BY_LABEL[e.label.toLowerCase()] = e.id
}

export function isSoftAvoidanceId(id: string): boolean {
  return (SOFT_AVOIDANCE_IDS as readonly string[]).includes(id)
}

// ═══════════════════════════════════════════════════════════════════════
// Content boundaries (plan §6.4 B) + exclusive "none"
// ═══════════════════════════════════════════════════════════════════════

export const CONTENT_BOUNDARY_IDS = [
  'boundary_graphic_violence',
  'boundary_sexual_violence',
  'boundary_self_harm_suicide',
  'boundary_torture',
  'boundary_intense_horror',
  'boundary_child_death',
  'boundary_protagonist_death',
  'boundary_partner_infidelity',
  'boundary_explicit_sexual_content',
] as const

export type ContentBoundaryId = (typeof CONTENT_BOUNDARY_IDS)[number]

export const BOUNDARY_NONE = 'boundary_none' as const
/** @deprecated alias */
export const CONTENT_BOUNDARY_NONE = BOUNDARY_NONE

export const CONTENT_BOUNDARY_CATALOG: ReadonlyArray<{ id: ContentBoundaryId; label: string }> = [
  { id: 'boundary_graphic_violence', label: 'Kekerasan yang digambarkan secara grafis' },
  { id: 'boundary_sexual_violence', label: 'Kekerasan seksual' },
  { id: 'boundary_self_harm_suicide', label: 'Menyakiti diri atau bunuh diri' },
  { id: 'boundary_torture', label: 'Penyiksaan' },
  { id: 'boundary_intense_horror', label: 'Horor atau jumpscare yang intens' },
  { id: 'boundary_child_death', label: 'Kematian anak' },
  { id: 'boundary_protagonist_death', label: 'Kematian tokoh utama' },
  { id: 'boundary_partner_infidelity', label: 'Perselingkuhan pasangan' },
  { id: 'boundary_explicit_sexual_content', label: 'Adegan seksual eksplisit' },
]

export const CONTENT_BOUNDARY_LABEL: Record<string, string> = Object.fromEntries(
  CONTENT_BOUNDARY_CATALOG.map((e) => [e.id, e.label]),
)

export const CONTENT_BOUNDARY_BY_LABEL: Record<string, string> = {}
for (const e of CONTENT_BOUNDARY_CATALOG) {
  CONTENT_BOUNDARY_BY_LABEL[e.label.toLowerCase()] = e.id
}
CONTENT_BOUNDARY_BY_LABEL['tidak ada batas khusus'] = BOUNDARY_NONE

export function isContentBoundaryId(id: string): boolean {
  return id === BOUNDARY_NONE || (CONTENT_BOUNDARY_IDS as readonly string[]).includes(id)
}

// ═══════════════════════════════════════════════════════════════════════
// Intensity / pacing / language / ending
// ═══════════════════════════════════════════════════════════════════════

export const DRAMA_INTENSITY_IDS = ['warm', 'balanced', 'intense'] as const

export const DRAMA_INTENSITY_LABEL: Record<string, string> = {
  warm: 'Hangat',
  balanced: 'Seimbang',
  intense: 'Intens',
}

export const PACING_IDS = ['slow_deep', 'balanced', 'fast_eventful'] as const

export const PACING_LABEL: Record<string, string> = {
  slow_deep: 'Perlahan & mendalam',
  balanced: 'Seimbang',
  fast_eventful: 'Cepat & penuh kejadian',
}

export const LANGUAGE_STYLE_IDS = [
  'clear_concise',
  'poetic_emotional',
  'cinematic_visual',
] as const

export const LANGUAGE_STYLE_LABEL: Record<string, string> = {
  clear_concise: 'Jernih & ringkas',
  poetic_emotional: 'Puitis & emosional',
  cinematic_visual: 'Sinematik & visual',
}

export const ENDING_BIAS_IDS = ['peaceful', 'justice', 'victory', 'bittersweet'] as const

export const ENDING_BIAS_LABEL: Record<string, string> = {
  peaceful: 'Lega & damai',
  justice: 'Keadilan',
  victory: 'Kemenangan',
  bittersweet: 'Pahit, tetapi bermakna',
}

// ═══════════════════════════════════════════════════════════════════════
// V1 enum → V2 maps
// ═══════════════════════════════════════════════════════════════════════

export const V1_DRAMA_INTENSITY_MAP: Record<string, string> = {
  ringan: 'warm',
  sedang: 'balanced',
  tinggi: 'intense',
}

export const V1_PACING_MAP: Record<string, string> = {
  'slow-burn': 'slow_deep',
  seimbang: 'balanced',
  cepat: 'fast_eventful',
}

export const V1_LANGUAGE_STYLE_MAP: Record<string, string> = {
  ringkas: 'clear_concise',
  puitis: 'poetic_emotional',
  sinematik: 'cinematic_visual',
}

export const V1_ENDING_BIAS_MAP: Record<string, string> = {
  keadilan: 'justice',
  kedamaian: 'peaceful',
  kemenangan: 'victory',
  'tragis-manis': 'bittersweet',
}

/** Reverse V2 → V1 for asV1Compat */
export const V2_DRAMA_INTENSITY_TO_V1: Record<string, 'ringan' | 'sedang' | 'tinggi'> = {
  warm: 'ringan',
  balanced: 'sedang',
  intense: 'tinggi',
}

export const V2_PACING_TO_V1: Record<string, 'slow-burn' | 'seimbang' | 'cepat'> = {
  slow_deep: 'slow-burn',
  balanced: 'seimbang',
  fast_eventful: 'cepat',
}

export const V2_LANGUAGE_STYLE_TO_V1: Record<string, 'ringkas' | 'puitis' | 'sinematik'> = {
  clear_concise: 'ringkas',
  poetic_emotional: 'puitis',
  cinematic_visual: 'sinematik',
}

export const V2_ENDING_BIAS_TO_V1: Record<
  string,
  'keadilan' | 'kedamaian' | 'kemenangan' | 'tragis-manis'
> = {
  peaceful: 'kedamaian',
  justice: 'keadilan',
  victory: 'kemenangan',
  bittersweet: 'tragis-manis',
}

export const V1_ROMANCE_LEVELS = ['none', 'subtle', 'utama'] as const

export const ROMANCE_LEVEL_LABEL: Record<string, string> = {
  none: 'Tanpa romansa',
  subtle: 'Romansa ringan',
  utama: 'Romansa utama',
}

// ═══════════════════════════════════════════════════════════════════════
// V1 avoidedTropes → soft / hard (normalized lowercase keys)
// ═══════════════════════════════════════════════════════════════════════

/**
 * V1 avoided quality strings → softAvoidanceIds.
 * Keys must be lowercase-normalized tokens.
 */
export const V1_AVOIDED_TO_SOFT: Record<string, string> = {
  'cinta segitiga': 'avoid_romance_takeover',
  'romansa berlebihan': 'avoid_romance_takeover',
  'twist terlalu tiba-tiba': 'avoid_unearned_twist',
  'twist tanpa petunjuk': 'avoid_unearned_twist',
  'twist yang muncul tanpa petunjuk': 'avoid_unearned_twist',
  'tokoh terlalu bodoh demi plot': 'avoid_plot_induced_stupidity',
  'tokoh bertindak bodoh hanya demi plot': 'avoid_plot_induced_stupidity',
  'plot armor berlebihan': 'avoid_plot_induced_stupidity',
  'rahasia yang tidak terjawab': 'avoid_unanswered_secret',
  'rahasia penting dibiarkan tanpa jawaban': 'avoid_unanswered_secret',
  'drama berlebihan': 'avoid_excessive_melodrama',
  'drama yang terlalu dipaksakan': 'avoid_excessive_melodrama',
  'konflik yang berulang tanpa perkembangan': 'avoid_repetitive_conflict',
  'akhir menggantung tanpa kepastian yang cukup': 'avoid_ambiguous_ending',
  'kematian tokoh hanya demi kejutan': 'avoid_shock_death',
  'hubungan toxic yang diromantisasi': 'avoid_romance_takeover',
}

/**
 * V1 avoided / boundary strings → contentBoundaryIds (hard).
 * Includes both old UI avoided labels and explicit boundary labels.
 */
export const V1_AVOIDED_TO_HARD: Record<string, string> = {
  'kekerasan eksplisit': 'boundary_graphic_violence',
  'kekerasan yang digambarkan secara grafis': 'boundary_graphic_violence',
  'konflik perang': 'boundary_graphic_violence',
  'pengkhianatan pasangan': 'boundary_partner_infidelity',
  'perselingkuhan pasangan': 'boundary_partner_infidelity',
  'pasangan yang berkhianat': 'boundary_partner_infidelity',
  'kematian tokoh utama': 'boundary_protagonist_death',
  'horor & jumpscare': 'boundary_intense_horror',
  'horor atau jumpscare yang intens': 'boundary_intense_horror',
  'horor berlebihan': 'boundary_intense_horror',
  'tanpa kekerasan eksplisit': 'boundary_graphic_violence',
  'tanpa adegan dewasa': 'boundary_explicit_sexual_content',
  'adegan seksual eksplisit': 'boundary_explicit_sexual_content',
  'tanpa konflik perang': 'boundary_graphic_violence',
  'tanpa bahaya pada anak': 'boundary_child_death',
  'kematian anak': 'boundary_child_death',
  'tanpa menyakiti diri sendiri': 'boundary_self_harm_suicide',
  'menyakiti diri atau bunuh diri': 'boundary_self_harm_suicide',
  'tanpa gore / body horror': 'boundary_graphic_violence',
  'kekerasan seksual': 'boundary_sexual_violence',
  penyiksaan: 'boundary_torture',
  'tidak ada batas khusus': BOUNDARY_NONE,
}

/** @deprecated aliases for older names */
export const V1_TROPE_TO_SOFT = V1_AVOIDED_TO_SOFT
export const V1_TROPE_TO_HARD = V1_AVOIDED_TO_HARD

// ═══════════════════════════════════════════════════════════════════════
// labelForId + conflict helpers
// ═══════════════════════════════════════════════════════════════════════

/**
 * Look up Indonesian label for any stable catalog ID.
 * Returns null if not found.
 */
export function labelForId(id: string): string | null {
  if (id === BOUNDARY_NONE) return 'Tidak ada batas khusus'
  return (
    GENRE_LABEL[id] ??
    CONFLICT_LABEL[id] ??
    SOFT_AVOIDANCE_LABEL[id] ??
    CONTENT_BOUNDARY_LABEL[id] ??
    DRAMA_INTENSITY_LABEL[id] ??
    PACING_LABEL[id] ??
    LANGUAGE_STYLE_LABEL[id] ??
    ENDING_BIAS_LABEL[id] ??
    null
  )
}

/**
 * Interleave conflicts from primary & secondary genre (labels):
 * 4 primary + 2 secondary, interleaved, deduped by plain text.
 */
export function conflictsForGenres(
  primaryGenreId: string | null,
  secondaryGenreId?: string | null,
): string[] {
  const primary = primaryGenreId ? (CONFLICT_CATALOG[primaryGenreId] ?? []) : []
  const secondary = secondaryGenreId ? (CONFLICT_CATALOG[secondaryGenreId] ?? []) : []

  if (!primary.length) return []

  const seen = new Set<string>()
  const result: string[] = []

  const PRIMARY_MAX = secondary.length ? 4 : 6
  const SECONDARY_MAX = 2
  let pIdx = 0
  let sIdx = 0
  let pCount = 0
  let sCount = 0

  while (result.length < 6) {
    let added = false

    if (pCount < PRIMARY_MAX && pIdx < primary.length) {
      const opt = primary[pIdx++]
      if (!seen.has(opt)) {
        seen.add(opt)
        result.push(opt)
        pCount++
        added = true
      }
    }

    if (sCount < SECONDARY_MAX && sIdx < secondary.length) {
      const opt = secondary[sIdx++]
      if (!seen.has(opt)) {
        seen.add(opt)
        result.push(opt)
        sCount++
        added = true
      }
    }

    if (!added) break
  }

  return result
}

/** Conflict entries (id+label) for balanced option building by ID. */
export function conflictEntriesForGenres(
  primaryGenreId: string | null,
  secondaryGenreId?: string | null,
): ConflictEntry[] {
  const primary = primaryGenreId
    ? (CONFLICT_CATALOG_BY_GENRE[primaryGenreId] ?? [])
    : []
  const secondary = secondaryGenreId
    ? (CONFLICT_CATALOG_BY_GENRE[secondaryGenreId] ?? [])
    : []

  if (!primary.length) return []

  const seen = new Set<string>()
  const result: ConflictEntry[] = []
  const PRIMARY_MAX = secondary.length ? 4 : 6
  const SECONDARY_MAX = 2
  let pIdx = 0
  let sIdx = 0
  let pCount = 0
  let sCount = 0

  while (result.length < 6) {
    let added = false

    if (pCount < PRIMARY_MAX && pIdx < primary.length) {
      const opt = primary[pIdx++]
      if (!seen.has(opt.id)) {
        seen.add(opt.id)
        result.push(opt)
        pCount++
        added = true
      }
    }

    if (sCount < SECONDARY_MAX && sIdx < secondary.length) {
      const opt = secondary[sIdx++]
      if (!seen.has(opt.id)) {
        seen.add(opt.id)
        result.push(opt)
        sCount++
        added = true
      }
    }

    if (!added) break
  }

  return result
}

export function buildLabelToIdMap(labelMap: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [id, label] of Object.entries(labelMap)) {
    result[label.toLowerCase()] = id
  }
  return result
}
