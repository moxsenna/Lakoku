/**
 * Blueprint Review Item API (E-OPS-1 Criterion #4 authorization).
 * 
 * Purpose: GET item details, POST for disposition recording.
 * Authority: M10-E E5 implementation authority SHA = `a16b5a3b950ead2385a41c4fe12369336fbbc15f`
 * Boundary: Reuse requireAdminUser() owner/admin roles; NO invented role='reviewer'; single approved path per allowlist
 */
import { NextRequest, NextResponse } from 'next/server'
import { getQueueItemDetail, recordDisposition as workflowRecordDisposition } from '@lakoku/runtime'
import { requireAdminUser } from '@/lib/admin/auth'
import type { Disposition, ResolutionContext } from '@/lib/types/blueprint.contract'

export const dynamic = 'force-dynamic'
export const revalidate = false

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireAdminUser() // Require authorized admin user
    
    const storyId = (await params).id
    
    // Get full item detail with recent resolutions and audit entries
    const item = await getQueueItemDetail(storyId)
    
    if (!item) {
      return NextResponse.json(
        { error: 'Item tidak ditemukan.' },
        { status: 404 }
      )
    }

    return NextResponse.json({ item })
  } catch (err) {
    console.error('Error fetching blueprint review item:', err)
    return NextResponse.json(
      { error: 'Terjadi kesalahan sistem.' },
      { status: 500 }
    )
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Capture authorized admin user identity (will be used for reviewer_uid derivation)
    const adminRole = await requireAdminUser() // owner/admin roles only
    
    const storyId = (await params).id
    const body = await request.json()
    const { disposition, reason_text } = body
    
    // Validate disposition value
    if (!['REJECT_BLOCK', 'RETRY_ALLOW', 'UNBLOCK_PERMIT'].includes(disposition)) {
      return NextResponse.json(
        { error: 'Disposition must be one of REJECT_BLOCK, RETRY_ALLOW, UNBLOCK_PERMIT' },
        { status: 400 }
      )
    }
    
    // Validate reason text
    if (!reason_text || typeof reason_text !== 'string' || reason_text.trim().length === 0) {
      return NextResponse.json(
        { error: 'Reason text is required' },
        { status: 400 }
      )
    }
    
    // Fetch source_event_id from queue item (required per E-OPS-1 evidence binding)
    const { createClient } = await import('@/lib/supabase/server')
    const db = await createClient()
    const { data: queueItem, error: fetchError } = await db
      .from('vw_blueprint_review_authority')
      .select('source_event_id, chapter_numbers')
      .eq('story_id', storyId)
      .single()
    
    if (fetchError || !queueItem) {
      return NextResponse.json(
        { error: 'Queue item not found.' },
        { status: 404 }
      )
    }
    
    if (
      typeof queueItem.source_event_id !== 'string' ||
      !/^[1-9]\d*$/.test(queueItem.source_event_id)
    ) {
      console.error(`[E5] Invalid source event identifier for ${storyId}`)
      return NextResponse.json(
        { error: 'Bukti tinjauan tidak dapat diverifikasi.' },
        { status: 400 }
      )
    }
    
    // Build resolution context WITHOUT reviewer_uid (workflow will derive it from requireAdminUser)
    const resolutionContext: Omit<ResolutionContext, 'reviewer_uid'> & { reviewer_uid?: string } = {
      story_id: storyId,
      disposition: disposition as Disposition,
      reviewer_uid: adminRole.id, // Derive ONLY from auth layer, never trust payload
      reason_text: reason_text,
      source_event_id: queueItem.source_event_id,
      chapter_numbers: queueItem.chapter_numbers || []
    }
    
    // Record disposition via core workflow orchestration (atomic operations)
    const result = await workflowRecordDisposition(resolutionContext)
    
    if (!result.success) {
      console.error(`[E5] Resolution rejected for ${storyId}:`, result.error)
      return NextResponse.json(
        { error: 'Gagal mencatat keputusan tinjauan.' },
        { status: 500 }
      )
    }

    return NextResponse.json({ 
      success: true,
      unblockProof: result.unblockProof,
      validationResult: result.validationResult
    })
  } catch (err) {
    console.error('Unexpected error recording resolution:', err)
    return NextResponse.json(
      { error: 'Terjadi kesalahan sistem.' },
      { status: 500 }
    )
  }
}
