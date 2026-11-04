import { NextResponse } from 'next/server'
import { after } from 'next/server'
import { z } from 'zod'
import {
  AUTHORING_AUTH_REQUIRED_ERROR,
  requireAuthoringSessionUser,
} from '@/lib/authoring/action-auth'
import { runStorySetupJob, startStorySetupJob } from '@/lib/authoring/setup-job.server'

/**
 * POST /api/stories/setup-jobs
 *
 * Mulai perakitan story bible sebagai job latar belakang (202 seketika).
 * Body: { premise, creativeDirection?, resumeJobId? } — resumeJobId menyemai
 * hasil tahap job gagal sebelumnya milik user yang sama (retry tanpa ulang).
 * Client memantau status via GET /api/stories/setup-jobs/[id].
 */

const StartBodySchema = z.object({
  premise: z.unknown(),
  creativeDirection: z.unknown().optional(),
  resumeJobId: z.string().uuid().optional(),
})

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const parsed = StartBodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Permintaan tidak valid.' }, { status: 400 })
  }

  let userId: string
  try {
    const user = await requireAuthoringSessionUser()
    userId = user.id
  } catch {
    return NextResponse.json({ ok: false, error: AUTHORING_AUTH_REQUIRED_ERROR }, { status: 401 })
  }

  const result = await startStorySetupJob({
    userId,
    premise: parsed.data.premise,
    creativeDirection: parsed.data.creativeDirection,
    resumeJobId: parsed.data.resumeJobId,
  })
  if (!result.ok) {
    return NextResponse.json(result, { status: 400 })
  }

  // Eksekusi setelah response terkirim — request client tidak menunggu AI.
  after(async () => {
    try {
      await runStorySetupJob(result.jobId)
    } catch (err) {
      // Runner menandai job failed per tahap; catch ini pengaman crash proses.
      console.log(`[setup-job] after-crash id=${result.jobId} err=${String(err)}`)
    }
  })

  return NextResponse.json(
    { ok: true, jobId: result.jobId, status: 'queued', stage: result.stage },
    { status: 202 },
  )
}

export const dynamic = 'force-dynamic'
