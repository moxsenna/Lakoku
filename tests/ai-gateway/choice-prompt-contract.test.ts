import { describe, expect, it } from 'vitest'
import {
  AI_CHOICE_DRAFT_V2_EXAMPLE,
  AiChoiceDraftSchema,
  buildChoiceSystemPromptV2,
  choiceId,
  finalizeAiChoiceDraft,
  parseAiChoiceDraft,
  rankChoiceRelevantCharacters,
  rankChoiceRelevantThreads,
} from '@/lib/ai-gateway/choice-draft-v2'

describe('choice protocol V2 prompt contract', () => {
  it('example JSON is valid JSON.parse and matches schema', () => {
    const parsed = JSON.parse(JSON.stringify(AI_CHOICE_DRAFT_V2_EXAMPLE))
    expect(AiChoiceDraftSchema.safeParse(parsed).success).toBe(true)
  })

  it('system prompt embeds parseable example without pseudo-schema tokens', () => {
    const prompt = buildChoiceSystemPromptV2()
    expect(prompt).toContain('Balas hanya satu objek JSON valid')
    expect(prompt).not.toMatch(/<integer\|null>/)
    expect(prompt).not.toMatch(/"nextChapterNumber":\s*</)
    // Extract the example object from prompt
    const start = prompt.indexOf('{')
    const end = prompt.lastIndexOf('}')
    expect(start).toBeGreaterThan(-1)
    const slice = prompt.slice(start, end + 1)
    // First JSON object in prompt should parse
    const firstBrace = prompt.indexOf('{\n  "question"')
    expect(firstBrace).toBeGreaterThan(-1)
    const exampleEnd = prompt.indexOf('\n}\n', firstBrace)
    const exampleJson = prompt.slice(firstBrace, exampleEnd + 2)
    expect(() => JSON.parse(exampleJson)).not.toThrow()
    void slice
  })

  it('schema requires exactly two actions and no mechanical fields', () => {
    const base = structuredClone(AI_CHOICE_DRAFT_V2_EXAMPLE) as Record<string, unknown>
    expect(AiChoiceDraftSchema.safeParse(base).success).toBe(true)

    const one = {
      question: AI_CHOICE_DRAFT_V2_EXAMPLE.question,
      actions: [AI_CHOICE_DRAFT_V2_EXAMPLE.actions[0]],
    }
    expect(AiChoiceDraftSchema.safeParse(one).success).toBe(false)

    const withMech = {
      question: AI_CHOICE_DRAFT_V2_EXAMPLE.question,
      actions: AI_CHOICE_DRAFT_V2_EXAMPLE.actions,
      choices: [{ id: 'x', label: 'too short' }],
    }
    // Extra top-level keys rejected by .strict() on draft root
    expect(AiChoiceDraftSchema.safeParse(withMech).success).toBe(false)

    const actionWithId = {
      question: AI_CHOICE_DRAFT_V2_EXAMPLE.question,
      actions: [
        { ...AI_CHOICE_DRAFT_V2_EXAMPLE.actions[0], id: 'chapter-1-choice-1' },
        AI_CHOICE_DRAFT_V2_EXAMPLE.actions[1],
      ],
    }
    // Extra keys on action rejected by .strict()
    expect(AiChoiceDraftSchema.safeParse(actionWithId).success).toBe(false)
  })

  it('finalizer produces stable choice IDs that match outcomes', () => {
    const draft = AiChoiceDraftSchema.parse(structuredClone(AI_CHOICE_DRAFT_V2_EXAMPLE))
    const branch = finalizeAiChoiceDraft({
      aiDraft: draft,
      chapterNumber: 3,
      activeCharacters: [],
      activeThreads: [
        { id: 'thread-penguntit', title: 'Penguntit' },
        { id: 'thread-surat', title: 'Surat' },
      ],
    })
    expect(branch.choices).toHaveLength(2)
    expect(branch.outcomes).toHaveLength(2)
    expect(branch.choices[0].id).toBe(choiceId(3, 0))
    expect(branch.choices[1].id).toBe(choiceId(3, 1))
    expect(branch.outcomes.map((o) => o.choiceId)).toEqual(
      branch.choices.map((c) => c.id),
    )
    expect(branch.outcomes.every((o) => o.nextChapterNumber === 4)).toBe(true)
    expect(branch.outcomes.every((o) => o.isEnding === false)).toBe(true)
    expect(branch.choicePrompt).toBe(draft.question)
  })

  it('chapter 49 normal goes to 50; special ending is deterministic', () => {
    const draft = AiChoiceDraftSchema.parse(structuredClone(AI_CHOICE_DRAFT_V2_EXAMPLE))
    const normal = finalizeAiChoiceDraft({
      aiDraft: draft,
      chapterNumber: 49,
    })
    expect(normal.outcomes.every((o) => o.nextChapterNumber === 50 && !o.isEnding)).toBe(true)

    const special = finalizeAiChoiceDraft({
      aiDraft: draft,
      chapterNumber: 49,
      specialEndingChapter49: true,
    })
    expect(special.outcomes.every((o) => o.nextChapterNumber === null && o.isEnding)).toBe(true)
  })

  it('chapter 50 throws CHOICES_NOT_ALLOWED', () => {
    const draft = AiChoiceDraftSchema.parse(structuredClone(AI_CHOICE_DRAFT_V2_EXAMPLE))
    expect(() =>
      finalizeAiChoiceDraft({ aiDraft: draft, chapterNumber: 50 }),
    ).toThrow(/tidak memiliki pilihan/i)
  })

  it('unknown targets are normalized to null when allowlist present', () => {
    const draft = AiChoiceDraftSchema.parse(structuredClone(AI_CHOICE_DRAFT_V2_EXAMPLE))
    const branch = finalizeAiChoiceDraft({
      aiDraft: draft,
      chapterNumber: 2,
      activeCharacters: [{ id: 'char-nara', name: 'Nara' }],
      activeThreads: [{ id: 'thread-other', title: 'Other' }],
    })
    // thread-penguntit / thread-surat not in allowlist → no threadTouches from unknown
    for (const outcome of branch.outcomes) {
      expect(outcome.effect.threadTouches.every((t) => t === 'thread-other')).toBe(true)
      // both unknown → empty thread touches
      expect(outcome.effect.threadTouches).toEqual([])
    }
  })

  it('rank helpers bound context size', () => {
    const chars = rankChoiceRelevantCharacters({
      endingParagraphs: ['Nara membuka surat di meja.'],
      characters: [
        { id: 'a', name: 'Nara' },
        { id: 'b', name: 'Budi' },
        { id: 'c', name: 'Citra' },
        { id: 'd', name: 'Dina' },
        { id: 'e', name: 'Eko' },
        { id: 'f', name: 'Fajar' },
        { id: 'g', name: 'Gita' },
        { id: 'h', name: 'Hana' },
      ],
      limit: 6,
    })
    expect(chars).toHaveLength(6)
    expect(chars[0].name).toBe('Nara')

    const threads = rankChoiceRelevantThreads({
      endingParagraphs: ['Jejak penguntit di koridor.'],
      threads: [
        { id: 't1', title: 'Penguntit' },
        { id: 't2', title: 'Surat' },
      ],
      limit: 6,
    })
    expect(threads[0].title).toBe('Penguntit')
  })

  it('parseAiChoiceDraft rejects invalid shapes with paths', () => {
    const bad = parseAiChoiceDraft({ question: 'short', actions: [] })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.errors.length).toBeGreaterThan(0)
  })
})
