import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ adminFactory: vi.fn() }))

vi.mock('server-only', () => ({}))
vi.mock('@lakoku/db', () => ({ createAdminClient: mocks.adminFactory }))

function compiled() {
  return {
    storyId: 'story-a',
    meta: {
      title: 'Owner A Story',
      tagline: 'Tagline valid panjang',
      role: 'Main Role',
      tropes: ['Found family', 'Hidden truth'],
      synopsis: 'Synopsis valid yang cukup panjang untuk melewati semua batas metadata authoring yang ketat.',
    },
    snapshot: {
      storyId: 'story-a',
      characters: [{
        id: 'story-a:char:arya', storyId: 'story-a', canonicalName: 'Arya', role: 'Lead',
        motivation: 'Find truth', introducedChapter: 1, status: 'ALIVE',
      }],
      aliases: [{ characterId: 'story-a:char:arya', alias: 'Ya', aliasType: 'NICKNAME' }],
      voiceSheets: [{
        characterId: 'story-a:char:arya', register: 'formal', speechHabits: ['short'],
        forbiddenWords: ['never'], sampleLines: ['I know.'],
      }],
      facts: [{
        id: 'story-a:fact-1', storyId: 'story-a', statement: 'Arya knows the map.',
        subjectCharacterId: 'story-a:char:arya', establishedChapter: 1, salience: 0.8,
        loadBearing: true, paidOff: false,
      }],
      knowledge: [{ characterId: 'story-a:char:arya', factId: 'story-a:fact-1', knownFromChapter: 1 }],
      secrets: [{ id: 'story-a:secret-1', description: 'Map is false.', revealGateChapter: 10, revealed: false }],
      timeline: [{ chapterNumber: 1, ordinal: 0, description: 'Map found.', isFlashback: false, occursAt: 1 }],
      threads: [{
        id: 'story-a:thread-main', title: 'False map', status: 'OPEN', openedChapter: 1,
        lastTouchedChapter: 1, payoffWindow: 20, isMainMystery: true, stale: false,
        staleSinceChapter: null,
      }],
      actRollups: [{
        actNumber: 1, summary: 'Opening act', stateDelta: { trust: 1 },
        coversFromChapter: 1, coversToChapter: 10,
      }],
      blueprints: [{
        chapterNumber: 1, version: 1, phase: 'setup', chapterGoal: 'Find map',
        mandatoryBeats: ['map'], forbiddenReveals: ['story-a:secret-1'],
        allowedStateDelta: { trust: 1 }, introducesCharacters: ['story-a:char:arya'],
        reconciledFromVersion: null, reconciliationReason: null,
      }],
    },
  } as never
}

beforeEach(() => vi.clearAllMocks())

describe('persistStoryBible transactional replacement', () => {
  it('maps complete validated canon into one replacement RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true, status: 'REPLACED' }, error: null })
    const from = vi.fn(() => { throw new Error('direct table writes forbidden') })
    mocks.adminFactory.mockReturnValue({ rpc, from })
    const { persistStoryBible } = await import('@/lib/authoring/persist')

    await expect(persistStoryBible(compiled(), 'a1000000-0000-4000-8000-000000000001'))
      .resolves.toEqual({ storyId: 'story-a' })

    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('replace_authoring_story_bible_v1', {
      p_story_id: 'story-a',
      p_owner_user_id: 'a1000000-0000-4000-8000-000000000001',
      p_title: 'Owner A Story',
      p_cover: '/placeholder.svg?height=400&width=300',
      p_tagline: 'Tagline valid panjang',
      p_role: 'Main Role',
      p_tropes: ['Found family', 'Hidden truth'],
      p_total_chapters: 50,
      p_synopsis: 'Synopsis valid yang cukup panjang untuk melewati semua batas metadata authoring yang ketat.',
      p_canon: {
        characters: [{ id: 'story-a:char:arya', canonical_name: 'Arya', role: 'Lead', motivation: 'Find truth', introduced_chapter: 1, status: 'ALIVE' }],
        character_aliases: [{ character_id: 'story-a:char:arya', alias: 'Ya', alias_type: 'NICKNAME' }],
        character_voice_sheets: [{ character_id: 'story-a:char:arya', register: 'formal', speech_habits: ['short'], forbidden_words: ['never'], sample_lines: ['I know.'] }],
        facts_ledger: [{ id: 'story-a:fact-1', statement: 'Arya knows the map.', subject_character_id: 'story-a:char:arya', established_chapter: 1, salience: 0.8, load_bearing: true, paid_off: false }],
        knowledge_scopes: [{ character_id: 'story-a:char:arya', fact_id: 'story-a:fact-1', known_from_chapter: 1 }],
        secrets_reveals: [{ id: 'story-a:secret-1', description: 'Map is false.', reveal_gate_chapter: 10, revealed: false }],
        timeline_events: [{ chapter_number: 1, ordinal: 0, description: 'Map found.', is_flashback: false, occurs_at: 1 }],
        story_threads: [{ id: 'story-a:thread-main', title: 'False map', status: 'OPEN', opened_chapter: 1, last_touched_chapter: 1, payoff_window: 20, is_main_mystery: true, stale: false, stale_since_chapter: null }],
        act_rollups: [{ act_number: 1, summary: 'Opening act', state_delta: { trust: 1 }, covers_from_chapter: 1, covers_to_chapter: 10 }],
        chapter_blueprints: [{ chapter_number: 1, version: 1, phase: 'setup', chapter_goal: 'Find map', mandatory_beats: ['map'], forbidden_reveals: ['story-a:secret-1'], allowed_state_delta: { trust: 1 }, introduces_characters: ['story-a:char:arya'], reconciled_from_version: null, reconciliation_reason: null }],
      },
    })
    expect(from).not.toHaveBeenCalled()
  })

  it('maps OWNER_MISMATCH to stable authoring error without direct writes', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: false, status: 'OWNER_MISMATCH' }, error: null })
    const from = vi.fn()
    mocks.adminFactory.mockReturnValue({ rpc, from })
    const { persistStoryBible } = await import('@/lib/authoring/persist')

    await expect(persistStoryBible(compiled(), 'b2000000-0000-4000-8000-000000000002'))
      .rejects.toThrow('persistStoryBible: story owner mismatch')
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(from).not.toHaveBeenCalled()
  })

  it('throws generic RPC failures without direct writes', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'database unavailable' } })
    const from = vi.fn()
    mocks.adminFactory.mockReturnValue({ rpc, from })
    const { persistStoryBible } = await import('@/lib/authoring/persist')

    await expect(persistStoryBible(compiled(), 'a1000000-0000-4000-8000-000000000001'))
      .rejects.toThrow('replace authoring story bible: database unavailable')
    expect(from).not.toHaveBeenCalled()
  })
})
