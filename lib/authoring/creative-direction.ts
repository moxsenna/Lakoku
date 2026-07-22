/**
 * Creative direction prompt blocks for authoring stages (cast / mystery / world).
 * Accepts StoryCreativeDirection (preferred) or legacy CreativeDirectionInput.
 */
import type { StoryCreativeDirection } from '@/lib/onboarding/creative-direction'
import {
  AGENCY_LABEL,
  RELATIONSHIP_LABEL,
  ROLE_LABEL,
} from '@/lib/onboarding/role-catalog'
import {
  CONFLICT_LABEL,
  CONTENT_BOUNDARY_LABEL,
  DRAMA_INTENSITY_LABEL,
  ENDING_BIAS_LABEL,
  GENRE_LABEL,
  LANGUAGE_STYLE_LABEL,
  SOFT_AVOIDANCE_LABEL,
} from '@/lib/taste-profile/catalog'

/** Legacy shape used by early Fase 0 tests. */
export type CreativeDirectionInput = {
  hardBoundaries: string[]
  softAvoidances: string[]
  storySetup: Record<string, string>
}

export type AuthoringStageWithDirection = 'cast' | 'mystery' | 'world'

export function authoringStageAcceptsDirection(
  _stage: AuthoringStageWithDirection,
): boolean {
  return true
}

function isStoryCreativeDirection(value: unknown): value is StoryCreativeDirection {
  return (
    typeof value === 'object' &&
    value !== null &&
    'version' in value &&
    (value as { version: unknown }).version === 1 &&
    'storySetup' in value &&
    'hardBoundaries' in value
  )
}

/**
 * Build prompt block from creative direction (V1 snapshot or legacy input).
 */
export function buildCreativeDirectionPromptBlock(
  direction: CreativeDirectionInput | StoryCreativeDirection,
): string {
  if (isStoryCreativeDirection(direction)) {
    return buildFromSnapshot(direction)
  }
  return buildFromLegacy(direction)
}

function buildFromLegacy(direction: CreativeDirectionInput): string {
  const lines: string[] = ['ARAAN KREATIF CERITA:']
  if (direction.hardBoundaries.length > 0) {
    lines.push('BATAS KONTEN WAJIB:')
    for (const b of direction.hardBoundaries) lines.push(`- ${b}`)
  }
  if (direction.softAvoidances.length > 0) {
    lines.push(
      `Kurangi atau hindari bila tidak diperlukan: ${direction.softAvoidances.join(', ')}.`,
    )
  }
  for (const [k, v] of Object.entries(direction.storySetup)) {
    if (v) lines.push(`- ${k}: ${v}`)
  }
  return lines.join('\n')
}

function buildFromSnapshot(d: StoryCreativeDirection): string {
  const lines: string[] = ['ARAAN KREATIF CERITA (wajib dihormati, di bawah canon):']

  if (d.hardBoundaries.length > 0) {
    lines.push('BATAS KONTEN WAJIB:')
    lines.push(
      '- Jangan masukkan, menyiratkan sebagai kejadian utama, atau menjadikan payoff kategori berikut:',
    )
    for (const id of d.hardBoundaries) {
      lines.push(`  - ${CONTENT_BOUNDARY_LABEL[id] ?? id}`)
    }
  }

  if (d.genre.primary) {
    const p = GENRE_LABEL[d.genre.primary] ?? d.genre.primary
    const s = d.genre.secondary ? GENRE_LABEL[d.genre.secondary] ?? d.genre.secondary : null
    lines.push(`- Genre: ${s ? `${p} + ${s}` : p}`)
  }

  const conflict =
    d.storySetup.coreConflict.customText ||
    (d.storySetup.coreConflict.id
      ? CONFLICT_LABEL[d.storySetup.coreConflict.id]
      : null)
  if (conflict) lines.push(`- Konflik utama: ${conflict}`)

  const role =
    d.storySetup.protagonistRole.customText ||
    (d.storySetup.protagonistRole.id
      ? ROLE_LABEL[d.storySetup.protagonistRole.id]
      : null)
  if (role) lines.push(`- Peran protagonis: ${role}`)

  const rel =
    RELATIONSHIP_LABEL[d.storySetup.relationshipFocus] ?? d.storySetup.relationshipFocus
  lines.push(`- Hubungan emosional utama: ${rel}`)

  const agency =
    AGENCY_LABEL[d.storySetup.agencyStyle] ?? d.storySetup.agencyStyle
  lines.push(`- Kecenderungan keputusan: ${agency}`)

  if (d.preferences.dramaIntensity) {
    lines.push(
      `- Intensitas: ${DRAMA_INTENSITY_LABEL[d.preferences.dramaIntensity] ?? d.preferences.dramaIntensity}`,
    )
  }
  if (d.preferences.pacing) {
    lines.push(`- Ritme: ${d.preferences.pacing}`)
  }
  if (d.preferences.languageStyle) {
    lines.push(
      `- Gaya penulisan: ${LANGUAGE_STYLE_LABEL[d.preferences.languageStyle] ?? d.preferences.languageStyle}`,
    )
  }
  if (d.preferences.endingBias) {
    lines.push(
      `- Arah ending: ${ENDING_BIAS_LABEL[d.preferences.endingBias] ?? d.preferences.endingBias}`,
    )
  }

  if (d.preferences.softAvoidanceIds.length > 0) {
    const labels = d.preferences.softAvoidanceIds.map(
      (id) => SOFT_AVOIDANCE_LABEL[id] ?? id,
    )
    lines.push(`Kurangi atau hindari bila tidak diperlukan: ${labels.join(', ')}.`)
  }

  // Stage-specific hints (shared block; stages add more)
  if (d.storySetup.relationshipFocus === 'relationship_self_growth') {
    lines.push(
      '- Fokus pertumbuhan diri: romance tidak wajib; jangan paksakan satu love interest utama.',
    )
  }

  if (d.preferences.softAvoidanceIds.includes('avoid_unanswered_secret')) {
    lines.push(
      '- Setiap rahasia penting harus punya planned reveal/payoff; jangan tambah misteri tanpa jendela pembayaran.',
    )
  }

  return lines.join('\n')
}

/** Stage-specific extra lines. */
export function stageDirectionHints(
  stage: AuthoringStageWithDirection,
  direction: StoryCreativeDirection | null | undefined,
): string[] {
  if (!direction) return []
  const hints: string[] = []

  if (stage === 'cast') {
    const role =
      direction.storySetup.protagonistRole.customText ||
      (direction.storySetup.protagonistRole.id
        ? ROLE_LABEL[direction.storySetup.protagonistRole.id]
        : null)
    if (role) {
      hints.push(`Karakter PERTAMA harus mencerminkan peran: ${role}.`)
    }
    hints.push(
      'Minimal dua karakter harus mencerminkan hubungan emosional utama yang dipilih.',
    )
    if (direction.storySetup.relationshipFocus !== 'relationship_slow_romance') {
      hints.push('Romance tidak wajib sebagai poros cast.')
    }
  }

  if (stage === 'mystery') {
    if (direction.preferences.softAvoidanceIds.includes('avoid_unanswered_secret')) {
      hints.push('Semua secret harus punya reveal gate + payoff window yang jelas.')
    }
    if (direction.preferences.endingBias) {
      hints.push(
        `Bias ending: ${ENDING_BIAS_LABEL[direction.preferences.endingBias] ?? direction.preferences.endingBias} (bukan lock ending).`,
      )
    }
  }

  if (stage === 'world') {
    if (direction.preferences.pacing === 'slow_deep') {
      hints.push('Pacing mendalam: thread lebih sedikit, relasi dan detail lebih dalam.')
    } else if (direction.preferences.pacing === 'fast_eventful') {
      hints.push(
        'Pacing cepat: tekanan adegan lebih sering, tanpa menambah reveal gate ilegal.',
      )
    }
  }

  return hints
}
