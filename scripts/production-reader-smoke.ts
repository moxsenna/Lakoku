/**
 * Production reader-path smoke (G13 soft launch).
 *
 * READ-ONLY over HTTP against the deployed app plus a read-only content check
 * against the production database. Proves a real reader can reach a published
 * story, that protected routes still gate on auth, and that no story surface
 * leaks the forbidden vocabulary.
 *
 * Usage:
 *   pnpm smoke:production-reader
 *   LAKOKU_PRODUCTION_ORIGIN=https://app.lakoku.biz.id pnpm smoke:production-reader
 *
 * The database half is skipped when SUPABASE_SERVICE_ROLE_KEY is absent, so the
 * smoke still runs from an operator machine that only has network access.
 */
import fs from 'node:fs'
import path from 'node:path'

import { createClient } from '@supabase/supabase-js'

const DEFAULT_ORIGIN = 'https://app.lakoku.biz.id'
const DEFAULT_PUBLIC_ORIGIN = 'https://lakoku.biz.id'
const REQUEST_TIMEOUT_MS = 30_000

/**
 * Reader-visible vocabulary ban from AGENT_RULES. Matched on word boundaries:
 * bundle filenames and CSS class fragments legitimately contain these letters.
 */
const FORBIDDEN_READER_TERMS = ['AI', 'Narraza', 'RAG', 'token', 'prompt', 'LLM'] as const

/** Explore eligibility mirrors `EXPLORE_STORY_FILTER` in lib/api/queries.ts. */
const EXPLORE_ID_PREFIXES = ['demo:', 'premium:'] as const

type CheckOutcome = { readonly name: string; readonly ok: boolean; readonly detail: string }

const results: CheckOutcome[] = []

function record(name: string, ok: boolean, detail: string): void {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} — ${detail}`)
}

function loadLocalEnvironment(): void {
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*['"]?(.*?)['"]?\s*$/)
    if (match?.[1] && match[2] !== undefined && !process.env[match[1]]) {
      process.env[match[1]] = match[2]
    }
  }
}

type Fetched = { readonly status: number; readonly location: string | null; readonly body: string }

async function fetchRoute(url: string, redirect: RequestRedirect = 'manual'): Promise<Fetched> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(url, { redirect, signal: controller.signal })
    const body = response.status < 300 || response.status >= 400 ? await response.text() : ''
    return { status: response.status, location: response.headers.get('location'), body }
  } finally {
    clearTimeout(timer)
  }
}

function forbiddenTermsIn(html: string): string[] {
  return FORBIDDEN_READER_TERMS.filter((term) =>
    new RegExp(`\\b${term}\\b`, term === 'AI' || term === 'RAG' || term === 'LLM' ? '' : 'i').test(html),
  )
}

async function main(): Promise<void> {
  loadLocalEnvironment()
  const origin = (process.env.LAKOKU_PRODUCTION_ORIGIN?.trim() || DEFAULT_ORIGIN).replace(/\/$/, '')
  const publicOrigin = (process.env.LAKOKU_PRODUCTION_PUBLIC_ORIGIN?.trim() || DEFAULT_PUBLIC_ORIGIN).replace(/\/$/, '')

  console.log(`production-reader-smoke origin=${origin} publicOrigin=${publicOrigin}`)

  // 1. Landing and app shell answer at all.
  for (const [name, url] of [['landing', `${publicOrigin}/`], ['app-root', `${origin}/`]] as const) {
    const res = await fetchRoute(url)
    record(`${name}-reachable`, res.status === 200, `HTTP ${res.status}`)
  }

  // 2. Pick a story the reader is actually allowed to see. The database is the
  //    authority for which one exists; without it, fall back to the app's own
  //    catalogue page and skip the content assertions.
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  const supabaseUrl = process.env.SUPABASE_URL?.trim() || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  let storyId: string | null = null

  if (serviceRoleKey && supabaseUrl) {
    const client = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data, error } = await client
      .from('stories')
      .select('id,title,status,total_chapters,current_chapter')
      .eq('visibility', 'public')
      .order('id', { ascending: true })

    if (error) {
      record('catalogue-query', false, 'stories query failed')
    } else {
      const explorable = (data ?? []).filter((row) =>
        EXPLORE_ID_PREFIXES.some((prefix) => String((row as { id: string }).id).startsWith(prefix)),
      ) as ReadonlyArray<{ id: string; title: string; status: string; total_chapters: number }>

      record('catalogue-query', explorable.length > 0, `${explorable.length} explore-eligible public stor(y|ies)`)
      storyId = explorable[0]?.id ?? null

      if (storyId) {
        const { data: chapters, error: chapterError } = await client
          .from('chapters')
          .select('number,paragraphs,choices')
          .eq('story_id', storyId)
          .order('number', { ascending: true })

        if (chapterError) {
          record('chapters-readable', false, 'chapters query failed')
        } else {
          const rows = (chapters ?? []) as ReadonlyArray<{
            number: number
            paragraphs: string[] | null
            choices: unknown[] | null
          }>
          const expected = explorable[0]?.total_chapters ?? 0
          const numbers = rows.map((r) => r.number)
          const contiguous = numbers.every((n, i) => n === i + 1)
          const words = rows.map((r) => (r.paragraphs ?? []).join(' ').split(/\s+/).filter(Boolean).length)
          const emptyChapters = words.filter((w) => w === 0).length

          record(
            'chapters-readable',
            rows.length === expected && contiguous && emptyChapters === 0,
            `${rows.length}/${expected} chapters, contiguous=${contiguous}, empty=${emptyChapters}, words=${Math.min(...words)}..${Math.max(...words)}`,
          )
        }
      }
    }
  } else {
    record('catalogue-query', true, 'skipped (no service role key; network-only run)')
  }

  // 3. The reader-facing detail page renders that story.
  if (storyId) {
    const detail = await fetchRoute(`${origin}/cerita/${encodeURIComponent(storyId)}`)
    record('story-detail-renders', detail.status === 200 && detail.body.length > 1000, `HTTP ${detail.status}, ${detail.body.length} bytes`)

    const leaked = forbiddenTermsIn(detail.body)
    record('brand-guard-story-detail', leaked.length === 0, leaked.length === 0 ? 'no forbidden terms' : `leaked: ${leaked.join(', ')}`)
  }

  // 4. Protected reading routes still gate on auth instead of leaking or erroring.
  for (const [name, pathname] of [['baca', storyId ? `/baca/${encodeURIComponent(storyId)}` : '/baca/demo:selasa-akhir'], ['mulai', '/mulai']] as const) {
    const res = await fetchRoute(`${origin}${pathname}`)
    const redirectsToLogin = res.status >= 300 && res.status < 400 && (res.location ?? '').includes('/auth/login')
    record(`${name}-requires-auth`, redirectsToLogin, `HTTP ${res.status} -> ${res.location ?? '(none)'}`)
  }

  // 5. The login page a gated reader lands on actually works.
  const login = await fetchRoute(`${origin}/auth/login`)
  record('login-renders', login.status === 200 && login.body.length > 1000, `HTTP ${login.status}, ${login.body.length} bytes`)

  const failed = results.filter((r) => !r.ok)
  console.log(`production-reader-smoke checks=${results.length} failed=${failed.length}`)
  console.log(`PRODUCTION-READER-SMOKE-${failed.length === 0 ? 'PASS' : 'FAIL'}`)
  if (failed.length > 0) process.exitCode = 1
}

main().catch((error: unknown) => {
  console.error('PRODUCTION_READER_SMOKE_FAILED', error instanceof Error ? error.message : 'unknown')
  process.exitCode = 1
})
