/**
 * G3 Lapis A — Deterministic continuity validator (NCS §3.1).
 *
 * Cek murah, tanpa LLM, deterministik. Setiap cek menghasilkan Finding
 * dengan severity sesuai spec. CRITICAL memblokir publish; MAJOR masuk
 * antrean repair; MINOR dicatat.
 *
 * Delapan cek:
 *  1. Karakter yang muncul terdaftar & masih hidup/aktif        CRITICAL
 *  2. Tidak ada reveal sebelum gate                              CRITICAL
 *  3. Karakter tak tahu info di luar knowledge scope-nya         CRITICAL
 *  4. State delta ⊆ allowed_state_delta                          CRITICAL
 *  5. Timeline monoton (tanpa flashback marker)                  MAJOR
 *  6. Struktur bab (500–800 kata, 2–4 scene, ada choice/gate)    MAJOR
 *  7. Nama/alias cocok registry (G5)                             MAJOR
 *  8. Karakter baru bernama setelah Bab 30 ada di blueprint      CRITICAL
 */

import type {
  CanonSnapshot,
  ChapterDraft,
  Finding,
  ChapterBlueprint,
} from './types'
import { buildAliasResolver, resolveMentions } from './alias'

export interface LayerAResult {
  ok: boolean
  findings: Finding[]
  blocking: boolean // ada CRITICAL?
}

const WORD_MIN = 800
const WORD_MAX = 1000
const SCENE_MIN = 2
const SCENE_MAX = 4
const NEW_CHARACTER_GATE = 30

function latestBlueprint(
  snapshot: CanonSnapshot,
  chapter: number,
): ChapterBlueprint | null {
  return (
    snapshot.blueprints
      .filter((b) => b.chapterNumber === chapter)
      .sort((a, b) => b.version - a.version)[0] ?? null
  )
}

/** Flatten nested key jadi dot-path untuk perbandingan subset state delta. */
function flattenKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = []
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...flattenKeys(v as Record<string, unknown>, path))
    } else {
      keys.push(path)
    }
  }
  return keys
}

export function validateLayerA(
  snapshot: CanonSnapshot,
  draft: ChapterDraft,
): LayerAResult {
  const findings: Finding[] = []
  const resolver = buildAliasResolver(snapshot)
  const target = draft.chapterNumber

  const charById = new Map(snapshot.characters.map((c) => [c.id, c]))

  // --- Cek 7 (dulu, karena cek lain butuh hasil resolusi): alias registry.
  const allMentions = [
    ...draft.events.map((e) => e.characterMention),
    ...draft.knowledgeAssertions.map((k) => k.characterMention),
  ]
  const { resolved, findings: aliasFindings } = resolveMentions(
    resolver,
    allMentions,
  )
  findings.push(...aliasFindings)

  // --- Cek 1: karakter muncul terdaftar & hidup/aktif.
  for (const [mention, id] of resolved) {
    const c = charById.get(id)
    if (!c) {
      findings.push({
        code: 'CHARACTER_NOT_REGISTERED',
        severity: 'CRITICAL',
        message: `Karakter "${mention}" tidak terdaftar di canon.`,
        detail: { mention, id },
      })
      continue
    }
    if (c.status === 'DEAD') {
      findings.push({
        code: 'CHARACTER_DEAD_ACTING',
        severity: 'CRITICAL',
        message: `Karakter "${c.canonicalName}" sudah mati tetapi tampil beraksi.`,
        detail: { characterId: id },
      })
    }
    if (c.introducedChapter > target) {
      findings.push({
        code: 'CHARACTER_NOT_YET_INTRODUCED',
        severity: 'CRITICAL',
        message: `Karakter "${c.canonicalName}" muncul di Bab ${target} sebelum diperkenalkan (Bab ${c.introducedChapter}).`,
        detail: { characterId: id },
      })
    }
  }

  // --- Cek 2: tidak ada reveal sebelum gate.
  const secretById = new Map(snapshot.secrets.map((s) => [s.id, s]))
  for (const r of draft.reveals) {
    const secret = secretById.get(r.secretId)
    if (!secret) {
      findings.push({
        code: 'SECRET_UNKNOWN',
        severity: 'CRITICAL',
        message: `Reveal merujuk rahasia tak dikenal "${r.secretId}".`,
        detail: { secretId: r.secretId },
      })
      continue
    }
    if (target < secret.revealGateChapter) {
      findings.push({
        code: 'REVEAL_BEFORE_GATE',
        severity: 'CRITICAL',
        message: `Rahasia "${secret.id}" dibuka di Bab ${target}, sebelum gate Bab ${secret.revealGateChapter}.`,
        detail: { secretId: secret.id, gate: secret.revealGateChapter },
      })
    }
  }

  // --- Cek 3: karakter tak tahu info di luar knowledge scope-nya.
  const knownSet = new Set(
    snapshot.knowledge
      .filter((k) => k.knownFromChapter <= target)
      .map((k) => `${k.characterId}::${k.factId}`),
  )
  for (const ka of draft.knowledgeAssertions) {
    const id = resolved.get(ka.characterMention)
    if (!id) continue // sudah dilaporkan sebagai ALIAS_UNRESOLVED
    if (!knownSet.has(`${id}::${ka.factId}`)) {
      findings.push({
        code: 'KNOWLEDGE_OUT_OF_SCOPE',
        severity: 'CRITICAL',
        message: `Karakter "${charById.get(id)?.canonicalName ?? id}" menggunakan fakta "${ka.factId}" di luar knowledge scope-nya.`,
        detail: { characterId: id, factId: ka.factId },
      })
    }
  }

  // --- Cek 4: state delta ⊆ allowed_state_delta.
  const blueprint = latestBlueprint(snapshot, target)
  if (blueprint) {
    const allowed = new Set(flattenKeys(blueprint.allowedStateDelta))
    const proposed = flattenKeys(draft.proposedStateDelta)
    for (const key of proposed) {
      if (!allowed.has(key)) {
        findings.push({
          code: 'STATE_DELTA_NOT_ALLOWED',
          severity: 'CRITICAL',
          message: `Perubahan state "${key}" tidak ada di allowed_state_delta blueprint Bab ${target}.`,
          detail: { key },
        })
      }
    }
  } else if (flattenKeys(draft.proposedStateDelta).length > 0) {
    findings.push({
      code: 'BLUEPRINT_MISSING',
      severity: 'CRITICAL',
      message: `Draft mengusulkan state delta tetapi tidak ada blueprint untuk Bab ${target}.`,
      detail: { chapter: target },
    })
  }

  // --- Cek 5: timeline monoton (occursAt naik kecuali flashback).
  const nonFlashback = draft.events
    .filter((e) => !e.isFlashback && e.occursAt != null)
    .sort((a, b) => a.ordinal - b.ordinal)
  for (let i = 1; i < nonFlashback.length; i++) {
    const prev = nonFlashback[i - 1]
    const cur = nonFlashback[i]
    if ((cur.occursAt as number) < (prev.occursAt as number)) {
      findings.push({
        code: 'TIMELINE_NON_MONOTONIC',
        severity: 'MAJOR',
        message: `Event "${cur.description}" mundur di timeline tanpa penanda flashback.`,
        detail: { ordinal: cur.ordinal, occursAt: cur.occursAt },
      })
    }
  }

  // --- Cek 6: struktur bab.
  if (draft.wordCount < WORD_MIN || draft.wordCount > WORD_MAX) {
    findings.push({
      code: 'CHAPTER_LENGTH_OUT_OF_RANGE',
      severity: 'MAJOR',
      message: `Panjang bab ${draft.wordCount} kata di luar rentang ${WORD_MIN}–${WORD_MAX}.`,
      detail: { wordCount: draft.wordCount },
    })
  }
  if (draft.sceneCount < SCENE_MIN || draft.sceneCount > SCENE_MAX) {
    findings.push({
      code: 'SCENE_COUNT_OUT_OF_RANGE',
      severity: 'MAJOR',
      message: `Jumlah scene ${draft.sceneCount} di luar rentang ${SCENE_MIN}–${SCENE_MAX}.`,
      detail: { sceneCount: draft.sceneCount },
    })
  }
  if (!draft.hasChoiceOrGate) {
    findings.push({
      code: 'MISSING_CHOICE_OR_GATE',
      severity: 'MAJOR',
      message: `Bab tidak memiliki choice atau gate.`,
    })
  }

  // --- Cek 8: karakter baru bernama setelah Bab 30 harus ada di blueprint.
  if (target > NEW_CHARACTER_GATE) {
    const planned = new Set(blueprint?.introducesCharacters ?? [])
    for (const newChar of draft.newNamedCharacters) {
      const id = resolver.resolve(newChar) ?? newChar
      const existing = charById.get(id)
      const isPreexisting = existing && existing.introducedChapter <= target
      if (!isPreexisting && !planned.has(id) && !planned.has(newChar)) {
        findings.push({
          code: 'UNPLANNED_NEW_CHARACTER',
          severity: 'CRITICAL',
          message: `Karakter baru "${newChar}" muncul setelah Bab ${NEW_CHARACTER_GATE} tanpa ada di blueprint.`,
          detail: { character: newChar, chapter: target },
        })
      }
    }
  }

  const blocking = findings.some((f) => f.severity === 'CRITICAL')
  return { ok: findings.length === 0, findings, blocking }
}
