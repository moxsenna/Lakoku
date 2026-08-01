import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseAiChoiceDraft, finalizeAiChoiceDraft, isAiChoiceDraftShape } from '@/lib/ai-gateway/choice-draft-v2'
import { validateChoiceBranch, parseChoiceBranch } from '@/lib/ai-gateway/schemas'
import { normalizeChoiceReaderText } from '@/lib/ai-gateway/gateway'

function load() {
  const text = readFileSync('.zcode/tmp/stream1-text.txt', 'utf8')
  const req = JSON.parse(readFileSync('.zcode/tmp/real-request.json', 'utf8'))
  const userJson = JSON.parse(req.messages[1].content.replace(/^Konteks pilihan \(currentChapter=\d+\):\s*/, ''))
  return { text, canon: userJson.canon }
}

describe('pcap reproduction', () => {
  it('shows ChoiceBranchSchema errors for the finalized branch', () => {
    const { text, canon } = load()
    const raw = JSON.parse(text.trim())
    expect(isAiChoiceDraftShape(raw)).toBe(true)
    const parsed = parseAiChoiceDraft(raw)
    expect(parsed.ok).toBe(true)
    const branch = finalizeAiChoiceDraft({
      aiDraft: parsed.ok ? parsed.data : (raw as never),
      chapterNumber: 1,
      activeCharacters: canon.activeCharacters,
      activeThreads: canon.activeThreads,
      lockedEndingKey: null,
    })
    const r = parseChoiceBranch(normalizeChoiceReaderText(branch))
    console.log('ChoiceBranchSchema ok:', r.ok)
    if (!r.ok) for (const e of r.errors) console.log('ISSUE:', e)
    console.log('branch keys:', Object.keys(branch).join(','))
    console.log('choice0:', JSON.stringify(branch.choices[0]))
    console.log('outcome0:', JSON.stringify(branch.outcomes[0]))
    console.log('outcome1:', JSON.stringify(branch.outcomes[1]))
  })
})
