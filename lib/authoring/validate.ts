/**
 * Validasi SEMANTIK story bible (T7.4) — pagar canon sebelum dikunci.
 *
 * Melengkapi validasi bentuk (Zod di schema.ts). Di sini kita pastikan konten
 * AI konsisten dengan aturan template/canon:
 *   - reveal gate hanya di 12/20/32/45 (dikunci template),
 *   - misteri utama terbayar sebelum bab 48 (ENDING_RULES),
 *   - referensi subjek fakta menunjuk karakter yang ada,
 *   - protagonis muncul di bab 1,
 *   - tidak ada kebocoran istilah internal di teks apa pun.
 * Mengembalikan Finding[] (CRITICAL menggagalkan lock).
 */
import { ENDING_RULES, REVEAL_GATE_CHAPTERS, type Finding } from '@lakoku/narrative-core'
import { scanForLeaks } from '@lakoku/ai-gateway'
import type { StoryBibleDraft } from './schema'

const GATES = new Set<number>(REVEAL_GATE_CHAPTERS as readonly number[])

export function validateStoryBible(draft: StoryBibleDraft): Finding[] {
  const findings: Finding[] = []
  const crit = (code: string, message: string, detail?: Record<string, unknown>) =>
    findings.push({ code, severity: 'CRITICAL', message, detail })
  const minor = (code: string, message: string, detail?: Record<string, unknown>) =>
    findings.push({ code, severity: 'MINOR', message, detail })

  const { premise, cast, mystery, world } = draft
  const names = new Set(cast.characters.map((c) => c.canonicalName))

  // 1) Cast dasar.
  if (cast.characters.length === 0) crit('AUTH_NO_CAST', 'Cast kosong.')
  const protagonist = cast.characters[0]
  if (protagonist && protagonist.introducedChapter !== 1) {
    minor('AUTH_PROTAG_INTRO', 'Protagonis sebaiknya diperkenalkan di bab 1.', {
      introducedChapter: protagonist.introducedChapter,
    })
  }

  // 2) Reveal gate rahasia harus salah satu gate template.
  for (const s of mystery.secrets) {
    if (!GATES.has(s.revealGateChapter)) {
      crit('AUTH_BAD_GATE', `Rahasia dijadwalkan di bab ${s.revealGateChapter}, di luar reveal gate ${[...GATES].join('/')}.`, {
        description: s.description,
        revealGateChapter: s.revealGateChapter,
      })
    }
  }

  // 3) Misteri utama wajib terbayar sebelum bab 48 (bila payoffWindow diisi).
  const pw = mystery.mainMystery.payoffWindow
  if (pw !== null && pw >= ENDING_RULES.mainMysteryMustResolveBeforeChapter) {
    crit('AUTH_MYSTERY_LATE', `Misteri utama harus terbayar sebelum bab ${ENDING_RULES.mainMysteryMustResolveBeforeChapter}.`, {
      payoffWindow: pw,
    })
  }

  // 4) Referensi subjek fakta.
  for (const f of world.facts) {
    if (f.subjectName !== null && !names.has(f.subjectName)) {
      crit('AUTH_FACT_SUBJECT', `Fakta merujuk karakter tak dikenal: "${f.subjectName}".`, { statement: f.statement })
    }
  }

  // 5) Kebocoran istilah internal di seluruh teks bebas.
  const blob = [
    premise.title, premise.tagline, premise.role, premise.synopsis, ...premise.tropes,
    ...cast.characters.flatMap((c) => [c.canonicalName, c.role, c.motivation, c.voice.register, ...c.voice.sampleLines]),
    mystery.mainMystery.title, ...mystery.secrets.map((s) => s.description),
    ...world.threads.map((t) => t.title), ...world.facts.map((f) => f.statement),
  ].join('\n')
  const leaks = scanForLeaks(blob)
  if (leaks.length) {
    crit('AUTH_LEAK', 'Story bible memuat istilah internal terlarang.', { leaks })
  }

  return findings
}

export function hasCritical(findings: Finding[]): boolean {
  return findings.some((f) => f.severity === 'CRITICAL')
}
