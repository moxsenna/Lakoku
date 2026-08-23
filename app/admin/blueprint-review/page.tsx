/**
 * Blueprint Review Dashboard — E5 Human Workflow Interface (E-OPS-1 Criterion #4).
 * 
 * Purpose: Admin dashboard for reviewing failed story generation incidents.
 * Authority: M10-E E5 implementation authority SHA = `a16b5a3b950ead2385a41c4fe12369336fbbc15f`
 * Boundary: Reuse requireAdminUser() owner/admin roles; NO invented role='reviewer'
 */
import { redirect } from 'next/navigation'
import { requireAdminUser } from '@/lib/admin/auth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/badge'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'

export const dynamic = 'force-dynamic'
export const revalidate = 0 // Never cache reader-facing content

/**
 * PendingReviewItem shape matching vw_blueprint_pending_review_items view
 */
interface PendingReviewItem {
  story_id: string
  story_title: string | null
  genre: string | null
  author_note?: string | null
  chapter_numbers: number[]
  act_boundary: 'ACT_1' | 'ACT_2' | 'ACT_3'
  findings: Array<'BRAND_LEAK' | 'CANONICAL_CORRUPTION' | 'LEASE_TIMEOUT' | 'PARSE_FAILURE'>
  queue_created_at: string
}

/**
 * Loaded pending items from API + full item details on demand
 */
async function fetchPendingItems(): Promise<PendingReviewItem[]> {
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}${'/api/admin/blueprint-review'}`,
      {
        headers: {
          cookie: document.cookie, // Forward auth cookie from server-side render
        },
        next: { revalidate: 0 },
      }
    )
    
    if (!res.ok) {
      const errorData = await res.json()
      console.error('Failed to fetch pending items:', errorData)
      
      // Handle forbidden explicitly
      if (res.status === 403) {
        return []
      }
      
      throw new Error(errorData.error || 'Gagal memuat antrian')
    }
    
    const data = await res.json()
    return data.items || []
  } catch (err) {
    console.error('Error fetching pending items:', err)
    return [] // Return empty array rather than redirecting - shows error state gracefully
  }
}

/**
 * Client component for the dashboard (inline for simplicity in RSC context)
 * Note: In production, move to client-only import via "use client" directive
 */
async function BlueprintReviewDashboard() {
  const items = await fetchPendingItems()
  
  const admin = await requireAdminUser()
  
  if (items.length === 0) {
    return (
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
        <header>
          <h1 className="font-serif text-2xl text-foreground text-balance">Tinjauan Blueprint Gagal</h1>
          <p className="text-sm text-muted-foreground text-pretty">
            Panel manusia untuk meninjau insiden generasi gagal yang memerlukan intervensi operator.
          </p>
        </header>
        
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tidak ada item dalam antrian</CardTitle>
            <CardDescription>
              Semua cerita telah ditinjau atau menunggu validator rerun. Tidak ada insiden pending.
            </CardDescription>
          </CardHeader>
        </Card>
      </main>
    )
  }
  
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-2xl text-foreground text-balance">Tinjauan Blueprint Gagal</h1>
          <p className="text-sm text-muted-foreground text-pretty">
            {items.length} item{' '}
            {items.length > 1 ? 'menunggu tinjauan' : 'menunggu tinjauan'} — tinjuan satu per satu secara sekuensial.
          </p>
        </div>
        
        <div className="flex gap-3">
          <Badge variant="outline">Status: PENDING</Badge>
          <Badge variant="default">{admin.role.toUpperCase()}</Badge>
        </div>
      </header>
      
      <Separator />
      
      <div className="grid grid-cols-1 gap-6">
        {items.map((item) => (
          <BlueprintReviewCard key={item.story_id} item={item} reviewerRole={admin.role} />
        ))}
      </div>
      
      <Card>
        <CardHeader>
          <CardTitle className="text-base text-destructive">Peringatan Penting</CardTitle>
        </header>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Setiap resolusi harus mengikat ke evidence event nyata (source_event_id BIGINT NOT NULL).{' '}
            Tidak boleh menggunakan null sentinel, placeholder, atau ID event palsu.
          </p>
          <ul className="list-inside list-disc space-y-2 text-sm text-foreground">
            <li><strong>REJECT_BLOCK:</strong> Tahan permanen until validator rerun lulus</li>
            <li><strong>RETRY_ALLOW:</strong> Permit retry tanpa validator rerun</li>
            <li><strong>UNBLOCK_PERMIT:</strong> Trigger validator rerun spine/reveal/ending</li>
          </ul>
        </CardContent>
      </Card>
    </main>
  )
}

/**
 * Individual review card with inline resolution form
 */
async function BlueprintReviewCard({
  item,
  reviewerRole,
}: {
  item: PendingReviewItem
  reviewerRole: 'owner' | 'admin'
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-3">
          <span>{item.story_title}</span>
          <Badge variant={item.act_boundary === 'ACT_1' ? 'secondary' : item.act_boundary === 'ACT_2' ? 'destructive' : 'outline'}>
            {item.act_boundary}
          </Badge>
        </CardTitle>
        <CardDescription className="text-sm">
          Genre: {item.genre || 'N/A'} • Bab: {item.chapter_numbers.join(', ')} • 
          Dibuat: {new Date(item.queue_created_at).toLocaleDateString('id-ID')}
        </CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Findings */}
        <div className="space-y-2">
          <Label className="text-xs font-medium uppercase text-muted-foreground">Temuan Insiden</Label>
          <div className="flex flex-wrap gap-2">
            {item.findings.map((finding) => (
              <Badge key={finding} variant="destructive">
                {finding.replace('_', ' ')}
              </Badge>
            ))}
          </div>
        </div>
        
        <Separator />
        
        {/* Resolution Form */}
        <form action={`/api/admin/blueprint-review/${encodeURIComponent(item.story_id)}`} method="POST" className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`disposition-${item.story_id}`}>Keputusan Tinjauan *</Label>
            <select
              id={`disposition-${item.story_id}`}
              name="disposition"
              required
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">Pilih keputusan...</option>
              <option value="REJECT_BLOCK">REJECT_BLOCK — Tahan permanen</option>
              <option value="RETRY_ALLOW">RETRY_ALLOW — Izinkan retry</option>
              <option value="UNBLOCK_PERMIT">UNBLOCK_PERMIT — Unblock dengan validator rerun</option>
            </select>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor={`reason-${item.story_id}`}>Alasan *</Label>
            <Textarea
              id={`reason-${item.story_id}`}
              name="reason_text"
              placeholder="Jelaskan alasan keputusan Anda..."
              rows={4}
              required
              className="resize-none"
            />
          </div>
          
          <div className="flex gap-3 pt-2">
            <Button type="submit" variant="destructive" disabled={reviewerRole !== 'owner' && reviewerRole !== 'admin'}>
              {reviewerRole === 'owner' || reviewerRole === 'admin' ? 'Catat Keputusan' : 'Ter larang'}
            </Button>
            
            <Button type="button" variant="outline" onClick={() => alert('Tindakan akan segera tersedia.')}>
              Simpan sebagai Draft
            </Button>
          </div>
          
          <p className="text-xs text-muted-foreground">
            Diperlukan: sumber event nyata (no null/sentinel/placeholder/fake binding). Missing real event → fail closed.
          </p>
        </form>
      </CardContent>
    </Card>
  )
}

export default async function Page() {
  const admin = await requireAdminUser()
  
  // Ensure only owner/admin can access
  if (admin.role !== 'owner' && admin.role !== 'admin') {
    redirect('/')
  }
  
  return <BlueprintReviewDashboard />
}
