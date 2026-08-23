/**
 * Blueprint Review Item API (E-OPS-1 Criterion #4 authorization).
 * 
 * Purpose: GET item details, POST for claim, DELETE for resolution.
 * Authority: M10-E E5 implementation authority SHA = `a16b5a3b950ead2385a41c4fe12369336fbbc15f`
 * Boundary: Reuse requireAdminUser() auth seam; owner/admin roles only
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/api/server'
import { getSessionUser } from '@/lib/api/user-state'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = await params
    const user = await getSessionUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 })
    }

    // Check admin role (reuse existing pattern)
    const db = createAdminClient()
    const { data: adminRole } = await db
      .from('admin_users')
      .select('role')
      .eq('user_id', user.id)
      .in('role', ['owner', 'admin'])
      .maybeSingle()

    if (!adminRole) {
      return NextResponse.json(
        { error: 'Forbidden - requires owner/admin role' },
        { status: 403 }
      )
    }

    // Fetch full item detail including source event metadata
    const { data: item, error } = await db
      .from('blueprint_queue')
      .select(`
        *,
        story_title:stories(title),
        genre: stories(metadata->>'genre'),
        author_note: stories(metadata->>'author_note'),
        recent_resolutions: blueprint_resolutions(id, disposition, reason_text, created_at),
        audit_entries: blueprint_audit_log(id, disposition, reason_text, created_at)
      `)
      .eq('story_id', id)
      .single()

    if (error || !item) {
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
    const { id } = await params
    const user = await getSessionUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 })
    }

    // Check admin role and get UID
    const db = createAdminClient()
    const { data: adminRole } = await db
      .from('admin_users')
      .select('role')
      .eq('user_id', user.id)
      .in('role', ['owner', 'admin'])
      .maybeSingle()

    if (!adminRole) {
      return NextResponse.json(
        { error: 'Forbidden - requires owner/admin role' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { disposition, reason_text } = body

    if (!['REJECT_BLOCK', 'RETRY_ALLOW', 'UNBLOCK_PERMIT'].includes(disposition)) {
      return NextResponse.json(
        { error: 'Disposition must be one of REJECT_BLOCK, RETRY_ALLOW, UNBLOCK_PERMIT' },
        { status: 400 }
      )
    }

    if (!reason_text || reason_text.trim().length === 0) {
      return NextResponse.json(
        { error: 'Reason text is required' },
        { status: 400 }
      )
    }

    // Create idempotency key (prevent duplicate on network retry)
    const idempotencyKey = `${id}-${disposition}-${user.id}`

    // Record disposition in resolutions table
    const { error: resolveError } = await db
      .from('blueprint_resolutions')
      .insert({
        story_id: id,
        disposition,
        reviewer_uid: user.id,
        reason_text,
        idempotency_key: idempotencyKey,
      })

    if (resolveError && resolveError.code !== '23505') { // 23505 = unique violation (idempotent)
      console.error('Error recording resolution:', resolveError)
      return NextResponse.json(
        { error: 'Gagal mencatat keputusan tinjauan.' },
        { status: 500 }
      )
    }

    // Update queue status
    let updateError
    if (disposition === 'REJECT_BLOCK') {
      updateError = await db
        .update({ status: 'BLOCKED' })
        .from('blueprint_queue')
        .eq('story_id', id)
        .throwOnError(false)
    } else if (disposition === 'RETRY_ALLOW') {
      updateError = await db
        .update({ status: 'RESOLVED' })
        .from('blueprint_queue')
        .eq('story_id', id)
        .throwOnError(false)
    } else if (disposition === 'UNBLOCK_PERMIT') {
      // Trigger validator rerun here via server/DB seams
      // For now, mark as PENDING for manual re-enqueue
      updateError = await db
        .update({ status: 'PENDING', claimed_by: null, claimed_at: null })
        .from('blueprint_queue')
        .eq('story_id', id)
        .throwOnError(false)
    }

    if (updateError) {
      console.error('Error updating queue status:', updateError)
      return NextResponse.json(
        { error: 'Gagal memperbarui status antrian.' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Unexpected error recording resolution:', err)
    return NextResponse.json(
      { error: 'Terjadi kesalahan sistem.' },
      { status: 500 }
    )
  }
}
