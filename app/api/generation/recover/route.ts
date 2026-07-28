/**
 * Generation job recovery tick (operational durability for the worker path).
 *
 * External cron (VPS systemd timer / cron) POSTs here on an interval, e.g.
 * every 2 minutes:
 *   curl -fsS -X POST \
 *     -H "Authorization: Bearer $LAKOKU_RECOVERY_SECRET" \
 *     https://<host>/api/generation/recover
 *
 * Behavior:
 *  1. Verify bearer secret; FAIL CLOSED when LAKOKU_RECOVERY_SECRET is unset.
 *  2. recover_stale_generation_jobs_v1 (requeue leases from dead workers).
 *  3. Bounded processing via after(): global-pop claim + run up to N jobs.
 *  4. Return 202 immediately; never leak job detail to caller.
 *  5. Safe under overlapping ticks (claim uses FOR UPDATE SKIP LOCKED).
 */
import { after } from 'next/server'
import { NextResponse, type NextRequest } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import {
  recoverStaleGenerationJobs,
  claimAndRunAvailableJobs,
  isGenerationWorkerEnabled,
} from '@lakoku/runtime'
import { safeErrorInfo } from '@/lib/observability/safe-error'

export const dynamic = 'force-dynamic'

const DEFAULT_MAX_JOBS_PER_TICK = 5
const DEFAULT_RECOVERY_BATCH = 20

function bearerFrom(req: NextRequest): string | null {
  const header = req.headers.get('authorization') ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match ? match[1].trim() : null
}

function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ab.length !== bb.length) return false
  try {
    return timingSafeEqual(ab, bb)
  } catch {
    return false
  }
}

function maxJobsPerTick(): number {
  const raw = process.env.LAKOKU_RECOVERY_MAX_JOBS?.trim()
  if (!raw) return DEFAULT_MAX_JOBS_PER_TICK
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n)) return DEFAULT_MAX_JOBS_PER_TICK
  return Math.min(20, Math.max(1, n))
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.LAKOKU_RECOVERY_SECRET?.trim()
  // Fail closed: no secret configured = endpoint disabled.
  if (!secret) {
    console.log('GENERATION_RECOVER_DISABLED', { reason: 'NO_SECRET' })
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const provided = bearerFrom(req)
  if (!provided || !constantTimeEquals(provided, secret)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  if (!isGenerationWorkerEnabled()) {
    // Worker path disabled: nothing durable to recover. Accept but no-op.
    console.log('GENERATION_RECOVER_SKIPPED', { reason: 'WORKER_DISABLED' })
    return NextResponse.json({ accepted: true }, { status: 202 })
  }

  // Schedule bounded processing; return immediately.
  // Only the synchronous registration is guarded here — async callback failure
  // stays logged-only and never changes the already-returned 202.
  try {
    after(async () => {
      const startedAt = Date.now()
      try {
        const recovered = await recoverStaleGenerationJobs({ batchSize: DEFAULT_RECOVERY_BATCH })
        const run = await claimAndRunAvailableJobs({ maxJobs: maxJobsPerTick() })
        console.log('GENERATION_RECOVER_TICK', {
          recoveredCount: recovered.recoveredCount,
          ran: run.ran,
          elapsedMs: Date.now() - startedAt,
        })
      } catch (err) {
        const info = safeErrorInfo(err)
        console.error('GENERATION_RECOVER_EXCEPTION', {
          errorName: info.errorName,
          errorMessage: info.errorMessage,
          elapsedMs: Date.now() - startedAt,
        })
      }
    })
  } catch {
    // Fixed generic body: never echo scheduling error text to the caller.
    console.error('GENERATION_RECOVER_SCHEDULE_FAILED')
    return NextResponse.json({ error: 'recovery_unavailable' }, { status: 500 })
  }

  return NextResponse.json({ accepted: true }, { status: 202 })
}
