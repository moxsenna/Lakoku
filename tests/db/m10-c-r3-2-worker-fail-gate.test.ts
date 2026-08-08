/**
 * M10-C R3.2 — Worker Fail-Gate DB-backed proof.
 */
import { test, expect, describe, beforeAll } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildHarnessContract } from '../../lib/narrative-qa/harness/fixture'
import { parseStoryContractWithNormalization } from '../../lib/story-engine/story-contract'
import { assertIsolatedTarget } from '../../lib/narrative-qa/harness/seed'
import type { ClaimedGenerationJob } from '../../lib/runtime/generation-jobs'

assertIsolatedTarget()

const STORY_ID = 'm10c-r3-2-worker-fail-gate-test'
const CHAPTER_NUMBER = 7

describe('M10-C R3.2 — Worker Fail-Gate proof', () => {
  let jobInsertResult: Record<string, unknown>
  
  beforeAll(async () => {
    const admin = createAdminClient()
    const contract = buildHarnessContract(STORY_ID)
    
    const blockedEndingId = contract.endingCandidates.find(e => e.kind === 'main')?.key
    if (!blockedEndingId) throw new Error('No main ending found')
    
    const failedContract = {
      ...contract,
      endingCandidates: contract.endingCandidates.map((candidate) => {
        if (candidate.key === blockedEndingId && candidate.kind === 'main') {
          return {
            ...candidate,
            blockingConditions: ['impossible-block-condition'],
          }
        }
        return candidate
      }),
    }
    
    await admin.from('stories').insert({
      id: STORY_ID,
      title: contract.title,
      genre: contract.genre,
      tone: contract.tone,
      total_chapters: contract.totalChapters,
      generation_status: 'pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })

    const parsedContract = parseStoryContractWithNormalization(failedContract)
    await admin.from('story_generation_contracts').insert({
      story_id: STORY_ID,
      story_contract_json: parsedContract,
      plot_debts_json: parsedContract.plotDebts,
      ending_candidates_json: parsedContract.endingCandidates,
      ending_lock_json: null,
      mode: 'personalized' as const,
      total_chapters: parsedContract.totalChapters,
    })

    await admin.from('act_rollups').insert([
      {
        story_id: STORY_ID,
        act_number: 2,
        from_chapter: 6,
        to_chapter: 12,
        checkpoint_chapter: 12,
      },
    ])

    await admin.from('canonical_snapshots').insert({
      story_id: STORY_ID,
      chapter_number: CHAPTER_NUMBER - 1,
      threads_json: [],
      story_flags_json: ['impossible-block-condition'],
      story_state_json: {},
      generated_at: new Date().toISOString(),
      checksum: 'test-checksum',
    })

    const now = new Date().toISOString()
    const jobId = `fail-gate-job-${Math.random().toString(36).substring(2, 8)}-${Date.now()}`
    const correlationId = `correlation-${Math.random().toString(36).substring(2, 8)}-${Date.now()}`
    
    const jobData = {
      story_id: STORY_ID,
      chapter_number: CHAPTER_NUMBER,
      attempt_id: jobId,
      correlation_id: correlationId,
      job_status: 'active',
      schema_version: 3,
      fenced_v2: true,
      sync_v1: false,
      base_revision: 0,
      target_revision: 1,
      provider_calls: 0,
      checkpoints: [],
      public_state: null,
      error_message: null,
      created_at: now,
      updated_at: now,
    }
    
    const { data, error } = await admin
      .from('generation_jobs_fenced_v2')
      .insert(jobData)
      .select()
      .single()
    
    if (error) throw new Error(`Failed to insert job: ${error.message}`)
    jobInsertResult = data
  }, 10000)

  test('outer worker execution via executeClaimedJob fails correctly', async () => {
    const admin = createAdminClient()
    expect(jobInsertResult.id).toBeDefined()
    expect(jobInsertResult.job_status).toBe('active')
    
    const { executeClaimedJob } = await import('../../lib/runtime/generation-worker')
    
    const userId = '12345678-1234-1234-1234-123456789012'
    const claimToken = 'abcdefab-cdef-abcd-efab-cdefabcdefab'
    const workerId = 'test-worker-123'
    
    const claimedJob: ClaimedGenerationJob = {
      id: jobInsertResult.attempt_id,
      storyId: STORY_ID,
      chapterNumber: CHAPTER_NUMBER,
      userId,
      generationKind: 'personalized',
      triggerChoiceId: null,
      attemptCount: 1,
      maxAttempts: 3,
      deadlineAt: new Date(Date.now() + 3600000).toISOString(),
      correlationId: jobInsertResult.correlation_id,
      workerId: workerId,
      claimToken: claimToken,
    }
    
    const result = await executeClaimedJob(claimedJob)
    
    expect(result.ok).toBe(false)
    expect(result.outcome).toBe('FAILED')
    
    const { data: finalJob, error: jobError } = await admin
      .from('generation_jobs_fenced_v2')
      .select('*')
      .eq('id', jobInsertResult.attempt_id)
      .single()

    if (jobError) throw new Error(`Failed to query final job state: ${jobError.message}`)

    expect(finalJob.job_status).toBe('failed')
    expect(finalJob.provider_calls).toBe(0)
    expect(finalJob.checkpoints.length).toBe(0)
    expect(finalJob.public_state).toBeNull()
    expect(finalJob.fenced_v2).toBe(true)

    const { data: leaseCheck, error: leaseError } = await admin
      .from('generation_jobs_fenced_v2')
      .select('lease_expires_at')
      .eq('id', jobInsertResult.attempt_id)
      .single()

    if (leaseError || !leaseCheck) throw new Error(`Failed to query lease: ${leaseError?.message}`)
    expect(new Date(leaseCheck.lease_expires_at) < new Date()).toBe(true)

    const { data: storyState } = await admin
      .from('stories')
      .select('generation_status, latest_chapter_number')
      .eq('id', STORY_ID)
      .single()

    if (!storyState) throw new Error('Story not found')
    expect(storyState.generation_status).toBe('needs_review')
  }, 30000)
})
