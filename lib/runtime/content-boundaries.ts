/**
 * Hard content-boundary validation for chapter drafts + choices.
 * Deterministic checks first; semantic checks can be layered later.
 */
import type { StoryCreativeDirection } from '@/lib/onboarding/creative-direction'
import { CONTENT_BOUNDARY_LABEL } from '@/lib/taste-profile/catalog'

export type BoundaryFinding = {
  code: string
  severity: 'CRITICAL' | 'MAJOR'
  message: string
  boundaryId: string
}

export type BoundaryValidationInput = {
  prose: string
  choiceLabels?: string[]
  direction: StoryCreativeDirection | null | undefined
  /** When true, protagonist death is always blocked if boundary set */
  chapterNumber?: number
}

const PROTAGONIST_DEATH_PATTERNS = [
  /\b(aku|saya)\s+(mati|tewas|meninggal)\b/i,
  /\bkematian\s+(tokoh\s+utama|protagonis)\b/i,
  /\b(protagonis|tokoh utama)\s+(mati|tewas|meninggal)\b/i,
]

const GRAPHIC_VIOLENCE_PATTERNS = [
  /\b(darah\s+menyembur|otak\s+terburai|usus\s+terurai)\b/i,
  /\b(mutilasi|disembelih\s+hidup-hidup)\b/i,
]

const SELF_HARM_PATTERNS = [
  /\b(bunuh\s+diri|mengakhiri\s+hidupku|menyayat\s+nadi)\b/i,
]

/**
 * Validate draft against hard boundaries in creative direction.
 * Empty findings = pass.
 */
export function validateContentBoundaries(
  input: BoundaryValidationInput,
): BoundaryFinding[] {
  const direction = input.direction
  if (!direction || direction.hardBoundaries.length === 0) return []

  const text = [input.prose, ...(input.choiceLabels ?? [])].join('\n')
  const findings: BoundaryFinding[] = []
  const set = new Set(direction.hardBoundaries)

  if (set.has('boundary_protagonist_death')) {
    for (const re of PROTAGONIST_DEATH_PATTERNS) {
      if (re.test(text)) {
        findings.push({
          code: 'BOUNDARY_PROTAGONIST_DEATH',
          severity: 'CRITICAL',
          message: 'Draf melanggar batas: kematian tokoh utama.',
          boundaryId: 'boundary_protagonist_death',
        })
        break
      }
    }
  }

  if (set.has('boundary_graphic_violence')) {
    for (const re of GRAPHIC_VIOLENCE_PATTERNS) {
      if (re.test(text)) {
        findings.push({
          code: 'BOUNDARY_GRAPHIC_VIOLENCE',
          severity: 'CRITICAL',
          message: 'Draf melanggar batas: kekerasan grafis.',
          boundaryId: 'boundary_graphic_violence',
        })
        break
      }
    }
  }

  if (set.has('boundary_self_harm_suicide')) {
    for (const re of SELF_HARM_PATTERNS) {
      if (re.test(text)) {
        findings.push({
          code: 'BOUNDARY_SELF_HARM',
          severity: 'CRITICAL',
          message: 'Draf melanggar batas: menyakiti diri / bunuh diri.',
          boundaryId: 'boundary_self_harm_suicide',
        })
        break
      }
    }
  }

  return findings
}

/** Lines to inject into chapter brief mustNotInclude. */
export function boundaryMustNotInclude(
  direction: StoryCreativeDirection | null | undefined,
): string[] {
  if (!direction) return []
  return direction.hardBoundaries.map((id) => {
    const label = CONTENT_BOUNDARY_LABEL[id] ?? id
    return `Jangan tampilkan: ${label}`
  })
}

/** Soft preference lines for chapter brief (non-hard). */
export function softPreferenceHints(
  direction: StoryCreativeDirection | null | undefined,
): string[] {
  if (!direction) return []
  const hints: string[] = []
  if (direction.preferences.languageStyle === 'cinematic_visual') {
    hints.push('Gaya prosa sinematik dan visual.')
  } else if (direction.preferences.languageStyle === 'poetic_emotional') {
    hints.push('Gaya prosa puitis dan emosional.')
  } else if (direction.preferences.languageStyle === 'clear_concise') {
    hints.push('Gaya prosa jernih dan ringkas.')
  }
  if (direction.preferences.dramaIntensity === 'intense') {
    hints.push('Intensitas tinggi: taruhan dan emosi tajam.')
  } else if (direction.preferences.dramaIntensity === 'warm') {
    hints.push('Intensitas hangat: beri ruang bernapas.')
  }
  if (direction.preferences.pacing === 'fast_eventful') {
    hints.push('Ritme cepat: gerakan plot sering, tanpa melanggar reveal gate.')
  } else if (direction.preferences.pacing === 'slow_deep') {
    hints.push('Ritme mendalam: ruang relasi dan detail.')
  }
  return hints
}
