/**
 * Authenticated local E2E for personalized create/choice/status/clone.
 *
 * Safety:
 * - loopback Supabase only
 * - loopback Next app only
 * - requires lakoku.test_target=local-cli
 * - service role used only for seed/cleanup/createUser, never as request auth
 * - no secrets logged
 */
import { execFileSync, spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import {
  assertLoopbackSupabaseUrl,
  readLocalStatus,
  type LocalSupabaseStatus,
} from './personalized-db-safety'
import { verifyLocalRaceTarget } from './authoring-race-session'

const INTERNAL_KEYS = new Set([
  'effect',
  'effectJson',
  'effect_json',
  'routeState',
  'route_state',
  'choiceHistory',
  'choice_history',
  'storyContract',
  'story_contract',
  'storyContractJson',
  'story_contract_json',
  'plotDebts',
  'plot_debts',
  'plotDebtsJson',
  'plot_debts_json',
  'endingCandidates',
  'ending_candidates',
  'endingCandidatesJson',
  'ending_candidates_json',
  'endingLock',
  'ending_lock',
  'endingLockJson',
  'ending_lock_json',
  'lockedEndingKey',
  'locked_ending_key',
  'ownerUserId',
  'owner_user_id',
  'sourceStoryId',
  'source_story_id',
  'storyMode',
  'story_mode',
  'generationStatus',
  'generation_status',
  'choiceKind',
  'choice_kind',
  'requestHash',
  'request_hash',
  'requestKey',
  'request_key',
  'idempotencyKey',
  'idempotency_key',
  'requestError',
  'request_error',
  'errorCode',
  'error_code',
  'leaseId',
  'lease_id',
  'attempt',
  'attempts',
  'sqlstate',
])

type Cookie = { name: string; value: string }

interface LocalUser {
  id: string
  email: string
  password: string
}

interface SessionJar {
  cookies: Cookie[]
  userId: string
  email: string
}

let pass = 0
let fail = 0

function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    pass += 1
    console.log(`  PASS ${name}`)
    return
  }
  fail += 1
  console.error(`  FAIL ${name}${detail === undefined ? '' : `: ${String(detail)}`}`)
}

function localStatus(): LocalSupabaseStatus {
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
    throw new Error('authenticated e2e requires lakoku.test_target=local-cli on local DB')
  }
}

function assertLoopbackAppUrl(value: string): string {
  const url = new URL(assertLoopbackSupabaseUrl(value))
  return url.origin
}

function cookieHeader(cookies: Cookie[]): string {
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')
}

function internalPaths(value: unknown, path = ''): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => internalPaths(item, `${path}[${index}]`))
  }
  if (!value || typeof value !== 'object') return []
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
    const next = path ? `${path}.${key}` : key
    if (INTERNAL_KEYS.has(key)) return [next]
    return internalPaths(child, next)
  })
}

async function createLocalUser(admin: SupabaseClient, label: string): Promise<LocalUser> {
  const password = `Local-only-${crypto.randomUUID()}-9a!`
  const email = `personalized-e2e-${label}-${crypto.randomUUID()}@example.invalid`
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (error || !data.user) throw new Error(`cannot create local Auth user ${label}`)
  return { id: data.user.id, email, password }
}

async function createSessionJar(
  status: LocalSupabaseStatus,
  user: LocalUser,
): Promise<SessionJar> {
  const cookies: Cookie[] = []
  const supabase = createServerClient(status.apiUrl, status.anonKey, {
    cookies: {
      getAll() {
        return cookies.map(({ name, value }) => ({ name, value }))
      },
      setAll(next) {
        for (const cookie of next) {
          const index = cookies.findIndex((row) => row.name === cookie.name)
          if (index >= 0) cookies[index] = { name: cookie.name, value: cookie.value }
          else cookies.push({ name: cookie.name, value: cookie.value })
        }
      },
    },
  })
  const { data, error } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  })
  if (error || !data.user) throw new Error('local Auth sign-in failed')
  if (cookies.length === 0) throw new Error('local Auth sign-in produced no cookies')
  return { cookies, userId: data.user.id, email: user.email }
}

async function apiFetch(
  baseUrl: string,
  path: string,
  init: RequestInit & { cookies?: Cookie[] } = {},
) {
  const headers = new Headers(init.headers)
  if (init.cookies?.length) headers.set('cookie', cookieHeader(init.cookies))
  if (init.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json')
  }
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
  })
  const text = await response.text()
  let json: unknown = null
  if (text) {
    try {
      json = JSON.parse(text)
    } catch {
      json = text
    }
  }
  return { response, json, text }
}

async function waitForApp(baseUrl: string, attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(baseUrl, { method: 'GET' })
      if (response.status > 0) return
    } catch {
      // retry
    }
    await delay(1000)
  }
  throw new Error(`Next app not reachable at ${baseUrl}`)
}

async function startApp(status: LocalSupabaseStatus, baseUrl: string) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: status.apiUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: status.anonKey,
    SUPABASE_URL: status.apiUrl,
    SUPABASE_ANON_KEY: status.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: status.serviceRoleKey,
    PORT: new URL(baseUrl).port || '3000',
    NEXT_TELEMETRY_DISABLED: '1',
  }
  // Force deterministic generation for offline matrix.
  delete env.NARRATIVE_PROVIDER

  const child = spawn(
    process.platform === 'win32' ? 'cmd.exe' : 'pnpm',
    process.platform === 'win32'
      ? ['/d', '/s', '/c', 'pnpm start']
      : ['start'],
    {
      cwd: process.cwd(),
      env,
      stdio: ['ignore', 'ignore', 'ignore'],
    },
  )

  try {
    await waitForApp(baseUrl, 90)
  } catch (error) {
    child.kill('SIGTERM')
    throw error
  }

  return {
    child,
    async stop() {
      if (child.killed) return
      child.kill('SIGTERM')
      await delay(500)
      if (!child.killed) child.kill('SIGKILL')
    },
  }
}

async function seedPremiumTemplate(admin: SupabaseClient, templateId: string) {
  const now = new Date().toISOString()
  const heroId = `${templateId}:char:hero`
  const factId = `${templateId}:fact:clue`
  const secretId = `${templateId}:secret:key`
  const threadId = `${templateId}:thread:main`

  const storyInsert = await admin.from('stories').upsert({
    id: templateId,
    title: 'E2E Premium Template',
    cover: '/cover.webp',
    tagline: 'Local premium template',
    role: 'Hero',
    tropes: ['mystery'],
    total_chapters: 50,
    synopsis: 'Template used only for local authenticated e2e.',
    status: 'SELESAI',
    current_chapter: 50,
    jejak: [],
    ending_name: null,
    owner_user_id: null,
    visibility: 'public',
    source_story_id: null,
    story_mode: 'premium_template',
    generation_status: 'ready',
    story_contract_version: 1,
    created_at: now,
  })
  if (storyInsert.error) throw new Error(`seed template story failed: ${storyInsert.error.message}`)

  const contractInsert = await admin.from('story_generation_contracts').upsert({
    story_id: templateId,
    mode: 'premium_template',
    total_chapters: 50,
    contract_source: 'llm_repaired',
    onboarding_json: { hero: heroId },
    story_contract_json: {
      storyId: templateId,
      nested: [factId, { secret: secretId, thread: threadId }],
    },
    route_schema_json: { focus: heroId },
    plot_debts_json: [{ fact: factId }],
    ending_candidates_json: [{ thread: threadId, secret: secretId }],
    ending_lock_json: { character: heroId },
    quality_profile: 'lakoku_mobile_drama_v1',
    created_at: now,
    updated_at: now,
  })
  if (contractInsert.error) throw new Error(`seed template contract failed: ${contractInsert.error.message}`)

  const blueprints = Array.from({ length: 50 }, (_, index) => {
    const chapterNumber = index + 1
    return {
      story_id: templateId,
      chapter_number: chapterNumber,
      version: 1,
      phase: chapterNumber <= 15 ? 'ACT_1' : chapterNumber <= 35 ? 'ACT_2' : 'ACT_3',
      chapter_goal: `Goal ${chapterNumber}`,
      mandatory_beats: [`beat-${chapterNumber}`, heroId],
      forbidden_reveals: [secretId],
      allowed_state_delta: { thread: threadId, fact: factId },
      introduces_characters: [heroId],
      reconciled_from_version: null,
      reconciliation_reason: null,
      created_at: now,
    }
  })
  const blueprintInsert = await admin.from('chapter_blueprints').upsert(blueprints)
  if (blueprintInsert.error) throw new Error(`seed template blueprints failed: ${blueprintInsert.error.message}`)

  const characterInsert = await admin.from('characters').upsert([
    {
      id: heroId,
      story_id: templateId,
      canonical_name: 'Raka',
      role: 'Hero',
      motivation: 'Find truth',
      introduced_chapter: 1,
      created_at: now,
    },
  ])
  if (characterInsert.error) throw new Error(`seed template character failed: ${characterInsert.error.message}`)

  const chapterInsert = await admin.from('chapters').upsert({
    story_id: templateId,
    number: 1,
    title: 'Opening Archive',
    paragraphs: ['Raka opens the archive door and finds a sealed letter.'],
    choice_prompt: 'What should Raka do next?',
    choices: [
      { id: 'open-door', label: 'Open the archive door' },
      { id: 'wait', label: 'Guard the hallway quietly' },
    ],
    created_at: now,
  })
  if (chapterInsert.error) throw new Error(`seed template chapter failed: ${chapterInsert.error.message}`)

  const outcomeInsert = await admin.from('choice_outcomes').upsert([
    {
      story_id: templateId,
      chapter_number: 1,
      choice_id: 'open-door',
      consequence: ['The archive opens and a name appears.'],
      next_chapter_number: 2,
      is_ending: false,
      created_at: now,
      effect_json: {
        routeDeltas: { truth: 1 },
        trustDeltas: { [heroId]: 1 },
        flagsSet: { archiveOpened: true },
        evidenceAdded: [factId],
        endingBiasDeltas: { truthEnding: 5 },
        threadTouches: [threadId],
      },
      choice_kind: 'normal',
    },
    {
      story_id: templateId,
      chapter_number: 1,
      choice_id: 'wait',
      consequence: ['The hallway stays quiet.'],
      next_chapter_number: 2,
      is_ending: false,
      created_at: now,
      effect_json: {
        routeDeltas: { risk: 1 },
        trustDeltas: {},
        flagsSet: {},
        evidenceAdded: [],
        endingBiasDeltas: {},
        threadTouches: [threadId],
      },
      choice_kind: 'normal',
    },
  ])
  if (outcomeInsert.error) throw new Error(`seed template outcomes failed: ${outcomeInsert.error.message}`)
}

async function pollChapterReady(
  baseUrl: string,
  jar: SessionJar,
  storyId: string,
  chapterNumber: number,
) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const status = await apiFetch(
      baseUrl,
      `/api/stories/${encodeURIComponent(storyId)}/chapters/${chapterNumber}/status`,
      { method: 'GET', cookies: jar.cookies },
    )
    const body = status.json as { status?: string; chapterNumber?: number } | null
    if (
      status.response.ok
      && body?.status === 'ready'
      && body.chapterNumber === chapterNumber
    ) {
      return status
    }
    if (body?.status === 'failed') {
      return status
    }
    await delay(1500)
  }
  throw new Error(`chapter ${chapterNumber} never became ready`)
}

async function cleanup(
  admin: SupabaseClient,
  users: string[],
  storyIds: string[],
  templateId: string,
) {
  for (const storyId of storyIds) {
    await admin.from('choice_outcomes').delete().eq('story_id', storyId)
    await admin.from('chapters').delete().eq('story_id', storyId)
    await admin.from('reader_states').delete().eq('story_id', storyId)
    await admin.from('chapter_blueprints').delete().eq('story_id', storyId)
    await admin.from('story_generation_contracts').delete().eq('story_id', storyId)
    await admin.from('characters').delete().eq('story_id', storyId)
    await admin.from('story_creation_requests').delete().eq('story_id', storyId)
    await admin.from('stories').delete().eq('id', storyId)
  }

  await admin.from('choice_outcomes').delete().eq('story_id', templateId)
  await admin.from('chapters').delete().eq('story_id', templateId)
  await admin.from('chapter_blueprints').delete().eq('story_id', templateId)
  await admin.from('story_generation_contracts').delete().eq('story_id', templateId)
  await admin.from('characters').delete().eq('story_id', templateId)
  await admin.from('stories').delete().eq('id', templateId)

  for (const userId of users) {
    await admin.from('reader_states').delete().eq('user_id', userId)
    await admin.from('story_creation_requests').delete().eq('owner_user_id', userId)
    await admin.auth.admin.deleteUser(userId)
  }
}

async function main() {
  console.log('Personalized authenticated e2e:')

  const status = localStatus()
  assertLoopbackSupabaseUrl(status.apiUrl)
  verifyLocalRaceTarget('personalized authenticated e2e')
  verifyLocalMarker()

  const baseUrl = assertLoopbackAppUrl(
    process.env.LAKOKU_E2E_BASE_URL?.trim() || 'http://127.0.0.1:3000',
  )

  const admin = createClient(status.apiUrl, status.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const runId = crypto.randomUUID()
  const templateId = `premium:e2e-${runId}`
  const users: string[] = []
  const storyIds: string[] = []
  let app: { stop: () => Promise<void> } | null = null

  try {
    // Ensure production-like route handlers exist.
    try {
      await waitForApp(baseUrl, 2)
    } catch {
      console.log('  INFO starting local Next production server')
      app = await startApp(status, baseUrl)
    }

    const userA = await createLocalUser(admin, 'a')
    const userB = await createLocalUser(admin, 'b')
    users.push(userA.id, userB.id)
    const jarA = await createSessionJar(status, userA)
    const jarB = await createSessionJar(status, userB)
    check('user A session cookies established', jarA.cookies.length > 0)
    check('user B session cookies established', jarB.cookies.length > 0)

    await seedPremiumTemplate(admin, templateId)
    check('premium template seeded as public premium_template', true)

    const createKey = `e2e-create-${runId}`
    const create1 = await apiFetch(baseUrl, '/api/stories/personalized', {
      method: 'POST',
      cookies: jarA.cookies,
      headers: { 'Idempotency-Key': createKey },
      body: JSON.stringify({}),
    })
    const create1Body = create1.json as { storyId?: string; redirectUrl?: string; error?: string }
    check('personalized create returns 201', create1.response.status === 201, create1.response.status)
    check(
      'personalized create body is reader-safe',
      Boolean(create1Body.storyId)
        && Boolean(create1Body.redirectUrl)
        && internalPaths(create1Body).length === 0,
      JSON.stringify(create1Body),
    )
    if (create1Body.storyId) storyIds.push(create1Body.storyId)
    const storyA = create1Body.storyId ?? ''

    const create2 = await apiFetch(baseUrl, '/api/stories/personalized', {
      method: 'POST',
      cookies: jarA.cookies,
      headers: { 'Idempotency-Key': createKey },
      body: JSON.stringify({}),
    })
    const create2Body = create2.json as { storyId?: string }
    check('personalized create replay returns 200', create2.response.status === 200, create2.response.status)
    check('personalized create replay keeps storyId', create2Body.storyId === storyA, create2Body.storyId)

    const anonCreate = await apiFetch(baseUrl, '/api/stories/personalized', {
      method: 'POST',
      headers: { 'Idempotency-Key': `e2e-anon-${runId}` },
      body: JSON.stringify({}),
    })
    check('anonymous personalized create denied', anonCreate.response.status === 401, anonCreate.response.status)

    const chapter1 = await apiFetch(
      baseUrl,
      `/api/stories/${encodeURIComponent(storyA)}/chapters/1`,
      { method: 'GET', cookies: jarA.cookies },
    )
    const chapter1Body = chapter1.json as {
      chapter?: { choices?: Array<{ id: string; label: string }> }
    }
    check('owner can read chapter 1', chapter1.response.status === 200, chapter1.response.status)
    check(
      'chapter 1 response has no internal fields',
      internalPaths(chapter1Body).length === 0,
      internalPaths(chapter1Body).join(','),
    )
    const choiceId = chapter1Body.chapter?.choices?.[0]?.id ?? ''
    check('chapter 1 exposes at least one choice', Boolean(choiceId), choiceId)

    const deniedB = await apiFetch(
      baseUrl,
      `/api/stories/${encodeURIComponent(storyA)}/chapters/1`,
      { method: 'GET', cookies: jarB.cookies },
    )
    check(
      'user B cannot read private personalized chapter 1',
      deniedB.response.status === 403 || deniedB.response.status === 404,
      deniedB.response.status,
    )

    const choiceKey = `e2e-choice-${runId}`
    const choice1 = await apiFetch(
      baseUrl,
      `/api/stories/${encodeURIComponent(storyA)}/choices`,
      {
        method: 'POST',
        cookies: jarA.cookies,
        headers: { 'Idempotency-Key': choiceKey },
        body: JSON.stringify({ chapterNumber: 1, choiceId }),
      },
    )
    const choiceBody = choice1.json as {
      outcome?: { nextChapterNumber?: number | null; isEnding?: boolean }
      nextChapterReady?: boolean
    }
    check('personalized choice returns 200', choice1.response.status === 200, choice1.response.status)
    check(
      'choice response is reader-safe',
      Boolean(choiceBody.outcome) && internalPaths(choiceBody).length === 0,
      JSON.stringify(choiceBody),
    )
    const nextChapter = choiceBody.outcome?.nextChapterNumber ?? 2

    if (choiceBody.nextChapterReady === false) {
      const ready = await pollChapterReady(baseUrl, jarA, storyA, nextChapter)
      const readyBody = ready.json as { status?: string; chapterNumber?: number }
      check(
        'status poll reaches ready',
        ready.response.ok && readyBody.status === 'ready' && readyBody.chapterNumber === nextChapter,
        JSON.stringify(readyBody),
      )
      check(
        'status response is reader-safe',
        internalPaths(readyBody).length === 0,
        internalPaths(readyBody).join(','),
      )
    } else {
      check('next chapter already ready or ending path', true)
    }

    if (!choiceBody.outcome?.isEnding) {
      const chapter2 = await apiFetch(
        baseUrl,
        `/api/stories/${encodeURIComponent(storyA)}/chapters/${nextChapter}`,
        { method: 'GET', cookies: jarA.cookies },
      )
      check('owner can read next chapter', chapter2.response.status === 200, chapter2.response.status)
      check(
        'next chapter response has no internal fields',
        internalPaths(chapter2.json).length === 0,
        internalPaths(chapter2.json).join(','),
      )
    }

    const bChoice = await apiFetch(
      baseUrl,
      `/api/stories/${encodeURIComponent(storyA)}/choices`,
      {
        method: 'POST',
        cookies: jarB.cookies,
        headers: { 'Idempotency-Key': `e2e-b-choice-${runId}` },
        body: JSON.stringify({ chapterNumber: 1, choiceId }),
      },
    )
    check(
      'user B cannot apply choice on story A',
      bChoice.response.status === 403
        || bChoice.response.status === 404
        || bChoice.response.status === 409,
      bChoice.response.status,
    )

    const cloneKey = `e2e-clone-${runId}`
    const clone1 = await apiFetch(
      baseUrl,
      `/api/stories/premium/${encodeURIComponent(templateId)}/clone`,
      {
        method: 'POST',
        cookies: jarA.cookies,
        headers: { 'Idempotency-Key': cloneKey },
        body: JSON.stringify({}),
      },
    )
    const clone1Body = clone1.json as {
      storyId?: string
      redirectUrl?: string
      replayed?: boolean
    }
    check(
      'premium clone returns success status',
      [200, 201, 202].includes(clone1.response.status),
      clone1.response.status,
    )
    check(
      'premium clone body is reader-safe',
      Boolean(clone1Body.storyId)
        && Boolean(clone1Body.redirectUrl)
        && internalPaths(clone1Body).length === 0,
      JSON.stringify(clone1Body),
    )
    if (clone1Body.storyId) storyIds.push(clone1Body.storyId)
    check(
      'premium clone storyId is distinct premium instance',
      Boolean(clone1Body.storyId?.startsWith('ai:premium:')),
      clone1Body.storyId,
    )

    const clone2 = await apiFetch(
      baseUrl,
      `/api/stories/premium/${encodeURIComponent(templateId)}/clone`,
      {
        method: 'POST',
        cookies: jarA.cookies,
        headers: { 'Idempotency-Key': cloneKey },
        body: JSON.stringify({}),
      },
    )
    const clone2Body = clone2.json as { storyId?: string }
    check(
      'premium clone replay keeps storyId',
      clone2.response.status === 200 || clone2.response.status === 202
        ? clone2Body.storyId === clone1Body.storyId
        : false,
      `${clone2.response.status}:${clone2Body.storyId}`,
    )

    const templateAfter = await admin
      .from('stories')
      .select('id,story_mode,visibility,source_story_id')
      .eq('id', templateId)
      .maybeSingle()
    check(
      'premium template remains public premium_template',
      !templateAfter.error
        && templateAfter.data?.story_mode === 'premium_template'
        && templateAfter.data.visibility === 'public'
        && templateAfter.data.source_story_id == null,
      JSON.stringify(templateAfter.data),
    )

    if (clone1Body.storyId) {
      const instance = await admin
        .from('stories')
        .select('id,story_mode,visibility,source_story_id,owner_user_id')
        .eq('id', clone1Body.storyId)
        .maybeSingle()
      check(
        'premium instance is private owned clone of template',
        !instance.error
          && instance.data?.story_mode === 'premium_instance'
          && instance.data.visibility === 'private'
          && instance.data.source_story_id === templateId
          && instance.data.owner_user_id === jarA.userId,
        JSON.stringify(instance.data),
      )

      // Chapter 50 no-choice surface for final chapter UI contract.
      const finalInsert = await admin.from('chapters').upsert({
        story_id: clone1Body.storyId,
        number: 50,
        title: 'Ending Quiet',
        paragraphs: ['The final page closes without another fork.'],
        choice_prompt: null,
        choices: null,
        created_at: new Date().toISOString(),
      })
      check('final chapter fixture inserted', !finalInsert.error, finalInsert.error?.message)
      const finalChapter = await apiFetch(
        baseUrl,
        `/api/stories/${encodeURIComponent(clone1Body.storyId)}/chapters/50`,
        { method: 'GET', cookies: jarA.cookies },
      )
      const finalBody = finalChapter.json as {
        chapter?: { number?: number; choices?: unknown; choicePrompt?: unknown }
      }
      check('owner can read final chapter', finalChapter.response.status === 200, finalChapter.response.status)
      check(
        'final chapter has no choices',
        finalBody.chapter?.number === 50
          && (finalBody.chapter.choices == null
            || (Array.isArray(finalBody.chapter.choices) && finalBody.chapter.choices.length === 0)),
        JSON.stringify(finalBody.chapter),
      )
      check(
        'final chapter response is reader-safe',
        internalPaths(finalBody).length === 0,
        internalPaths(finalBody).join(','),
      )
    }
  } finally {
    try {
      await cleanup(admin, users, storyIds, templateId)
    } catch (error) {
      console.error('  WARN cleanup failed', error instanceof Error ? error.message : error)
    }
    if (app) await app.stop()
  }

  console.log(`\npersonalized-authenticated-e2e: ${pass}/${pass + fail} PASS`)
  if (fail > 0) process.exit(1)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
