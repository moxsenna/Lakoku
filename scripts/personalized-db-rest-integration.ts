import { execFileSync } from 'node:child_process'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  assertLoopbackSupabaseUrl,
  readLocalStatus,
} from './personalized-db-safety'

const STORY_COLUMNS =
  'id,title,cover,tagline,role,tropes,total_chapters,synopsis,status,current_chapter,jejak,ending_name'
const CHAPTER_COLUMNS =
  'story_id,number,title,paragraphs,choice_prompt,choices'
const OUTCOME_COLUMNS =
  'story_id,chapter_number,choice_id,consequence,next_chapter_number,is_ending'
const STATE_COLUMNS =
  'user_id,story_id,status,current_chapter,jejak,ending_name,updated_at'

function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(`personalized REST integration: ${message}`)
}

function localStatus() {
  const output = process.platform === 'win32'
    ? execFileSync(
        'cmd.exe',
        ['/d', '/s', '/c', 'pnpm exec supabase status -o json'],
        { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      )
    : execFileSync(
        'pnpm',
        ['exec', 'supabase', 'status', '-o', 'json'],
        { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      )
  return readLocalStatus(JSON.parse(output) as Record<string, unknown>)
}

function verifyLocalMarker() {
  try {
    if (process.platform === 'win32') {
      execFileSync(
        'cmd.exe',
        ['/d', '/s', '/c', 'pnpm exec supabase test db --local supabase/tests/personalized_local_marker_test.sql'],
        { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      )
    } else {
      execFileSync(
        'pnpm',
        ['exec', 'supabase', 'test', 'db', '--local', 'supabase/tests/personalized_local_marker_test.sql'],
        { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      )
    }
  } catch {
    throw new Error('personalized REST integration requires lakoku.test_target=local-cli on local DB')
  }
}

async function createLocalUser(admin: SupabaseClient, label: string) {
  const password = `Local-only-${crypto.randomUUID()}-9a!`
  const email = `personalized-rest-${label}-${crypto.randomUUID()}@example.invalid`
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  check(!error && data.user, `cannot create local Auth user ${label}`)
  return { id: data.user.id, email, password }
}

async function signedInClient(
  apiUrl: string,
  anonKey: string,
  email: string,
  password: string,
) {
  const client = createClient(apiUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await client.auth.signInWithPassword({ email, password })
  check(!error, 'local Auth sign-in failed')
  return client
}

async function main() {
  const { apiUrl, anonKey, serviceRoleKey } = localStatus()
  assertLoopbackSupabaseUrl(apiUrl)

  const anon = createClient(apiUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const admin = createClient(apiUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  verifyLocalMarker()

  const run = crypto.randomUUID()
  const publicId = `demo:rest-${run}`
  const premiumId = `premium:rest-${run}`
  const privateId = `personalized:rest ${run}`
  const users: string[] = []
  const stories = [publicId, premiumId, privateId]

  try {
    const owner = await createLocalUser(admin, 'owner')
    const other = await createLocalUser(admin, 'other')
    users.push(owner.id, other.id)
    const ownerClient = await signedInClient(
      apiUrl,
      anonKey,
      owner.email,
      owner.password,
    )
    const otherClient = await signedInClient(
      apiUrl,
      anonKey,
      other.email,
      other.password,
    )

    const { error: storyError } = await admin.from('stories').insert([
      { id: publicId, title: 'Demo REST', visibility: 'public' },
      { id: premiumId, title: 'Premium REST', visibility: 'public' },
      {
        id: privateId,
        title: 'Private REST',
        visibility: 'private',
        owner_user_id: owner.id,
      },
    ])
    check(!storyError, 'cannot seed story fixtures')

    const { error: chapterError } = await admin.from('chapters').insert(
      stories.map((storyId) => ({
        story_id: storyId,
        number: 1,
        title: `${storyId} chapter`,
        paragraphs: ['paragraph'],
        choice_prompt: 'Choose',
        choices: [{ id: 'choice-a', text: 'A' }],
      })),
    )
    check(!chapterError, 'cannot seed chapter fixtures')

    const { error: outcomeError } = await admin.from('choice_outcomes').insert(
      stories.map((storyId) => ({
        story_id: storyId,
        chapter_number: 1,
        choice_id: 'choice-a',
        consequence: ['result'],
        next_chapter_number: 2,
        is_ending: false,
      })),
    )
    check(!outcomeError, 'cannot seed outcome fixtures')

    const explore = await admin
      .from('stories')
      .select(STORY_COLUMNS)
      .eq('visibility', 'public')
      .or('id.like.demo:%,id.like.premium:%')
      .order('id', { ascending: true })
    check(!explore.error, 'Explore query failed')
    check(
      JSON.stringify(explore.data?.map((row) => row.id)) ===
        JSON.stringify([publicId, premiumId].sort()),
      'Explore filter or order differs from reader contract',
    )

    const anonPublic = await anon
      .from('stories')
      .select(STORY_COLUMNS)
      .eq('id', publicId)
      .maybeSingle()
    check(!anonPublic.error && anonPublic.data?.id === publicId, 'anon public detail denied')
    const anonChapter = await anon
      .from('chapters')
      .select(CHAPTER_COLUMNS)
      .eq('story_id', publicId)
      .eq('number', 1)
      .maybeSingle()
    check(!anonChapter.error && anonChapter.data, 'anon public chapter denied')
    const anonOutcome = await anon
      .from('choice_outcomes')
      .select(OUTCOME_COLUMNS)
      .eq('story_id', publicId)
      .eq('chapter_number', 1)
      .eq('choice_id', 'choice-a')
      .maybeSingle()
    check(!anonOutcome.error && anonOutcome.data, 'anon public outcome denied')

    const ownerPrivate = await ownerClient
      .from('stories')
      .select(STORY_COLUMNS)
      .eq('id', privateId)
      .maybeSingle()
    check(!ownerPrivate.error && ownerPrivate.data?.id === privateId, 'owner private detail denied')
    const ownerChapter = await ownerClient
      .from('chapters')
      .select(CHAPTER_COLUMNS)
      .eq('story_id', privateId)
      .eq('number', 1)
      .maybeSingle()
    check(!ownerChapter.error && ownerChapter.data, 'owner private chapter denied')
    const ownerOutcome = await ownerClient
      .from('choice_outcomes')
      .select(OUTCOME_COLUMNS)
      .eq('story_id', privateId)
      .eq('chapter_number', 1)
      .eq('choice_id', 'choice-a')
      .maybeSingle()
    check(!ownerOutcome.error && ownerOutcome.data, 'owner private outcome denied')

    for (const [table, columns] of [
      ['stories', STORY_COLUMNS],
      ['chapters', CHAPTER_COLUMNS],
      ['choice_outcomes', OUTCOME_COLUMNS],
    ] as const) {
      const idColumn = table === 'stories' ? 'id' : 'story_id'
      const denied = await otherClient.from(table).select(columns).eq(idColumn, privateId)
      check(!denied.error && denied.data?.length === 0, `other-user ${table} was visible`)
    }

    const { error: stateSeedError } = await ownerClient.from('reader_states').upsert({
      user_id: owner.id,
      story_id: privateId,
      status: 'BERJALAN',
      current_chapter: 1,
      jejak: [],
      ending_name: null,
      updated_at: new Date().toISOString(),
    })
    check(!stateSeedError, 'reader-state upsert failed')
    const stateRead = await ownerClient
      .from('reader_states')
      .select(STATE_COLUMNS)
      .eq('story_id', privateId)
      .maybeSingle()
    check(!stateRead.error && stateRead.data?.user_id === owner.id, 'reader-state select failed')

    const mixedLibrary = await ownerClient
      .from('stories')
      .select(STORY_COLUMNS)
      .in('id', [publicId, privateId])
      .order('id', { ascending: true })
    check(!mixedLibrary.error && mixedLibrary.data?.length === 2, 'mixed library IDs failed')
    const mixedOther = await otherClient
      .from('stories')
      .select(STORY_COLUMNS)
      .in('id', [publicId, privateId])
    check(!mixedOther.error && mixedOther.data?.length === 1, 'mixed library leaked private story')

    const hidden = await ownerClient
      .from('stories')
      .select('id,owner_user_id,story_mode')
      .eq('id', privateId)
    check(Boolean(hidden.error), 'hidden internal story columns were readable')
    const malformed = await anon
      .from('stories')
      .select(STORY_COLUMNS)
      .or('visibility.eq.public,broken')
    check(Boolean(malformed.error) && !malformed.data, 'malformed REST query did not fail closed')

    const encodedResponse = await fetch(
      `${apiUrl}/rest/v1/stories?id=eq.${encodeURIComponent(privateId)}&select=${encodeURIComponent(STORY_COLUMNS)}`,
      {
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
        },
      },
    )
    check(encodedResponse.ok, 'encoded story ID REST request failed')
    const encodedRows = (await encodedResponse.json()) as unknown[]
    check(encodedRows.length === 0, 'encoded private story ID leaked to anon')

    const stateDelete = await ownerClient
      .from('reader_states')
      .delete()
      .eq('story_id', privateId)
    check(!stateDelete.error, 'reader-state delete failed')
    const afterDelete = await ownerClient
      .from('reader_states')
      .select(STATE_COLUMNS)
      .eq('story_id', privateId)
    check(!afterDelete.error && afterDelete.data?.length === 0, 'reader-state delete not applied')

    console.log('personalized REST/Auth integration: PASS')
  } finally {
    await admin.from('choice_outcomes').delete().in('story_id', stories)
    await admin.from('chapters').delete().in('story_id', stories)
    await admin.from('reader_states').delete().in('story_id', stories)
    await admin.from('stories').delete().in('id', stories)
    for (const userId of users) await admin.auth.admin.deleteUser(userId)
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(1)
})
