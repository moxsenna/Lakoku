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
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import ClientComponent from './client-component'

export const dynamic = 'force-dynamic'
export const revalidate = 0 // Never cache reader-facing content

interface PendingReviewItem {
  story_id: string
  story_title: string | null
  tagline?: string | null
  chapter_numbers: number[]
  act_boundary: 'ACT_1' | 'ACT_2' | 'ACT_3'
  findings: Array<'BRAND_LEAK' | 'CANONICAL_CORRUPTION' | 'LEASE_TIMEOUT' | 'PARSE_FAILURE'>
  queue_created_at: string
}

// Server component that checks auth and fetches initial data
async function getInitialPendingItems(): Promise<PendingReviewItem[]> {
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}${'/api/blueprint-review'}`,
      {
        headers: {
          cookie: '', // Will be passed by Next.js in client-side context
        },
        next: { revalidate: 0 },
      }
    )
    
    if (!res.ok) {
      console.error('Failed to fetch pending items:', res.status)
      return []
    }
    
    const data = await res.json()
    return data.items || []
  } catch (err) {
    console.error('Error fetching pending items:', err)
    return []
  }
}

export default async function Page() {
  const admin = await requireAdminUser()
  
  // Ensure only owner/admin can access
  if (admin.role !== 'owner' && admin.role !== 'admin') {
    redirect('/')
  }
  
  const items = await getInitialPendingItems()
  
  // Pass server-fetched data as props to client component
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-2xl text-foreground text-balance">Tinjauan Blueprint Gagal</h1>
          <p className="text-sm text-muted-foreground text-pretty">
            Panel manusia untuk meninjau insiden generasi gagal yang memerlukan intervensi operator.
            {items.length > 0 ? ` ${items.length} item menunggu tinjauan.` : ''}
          </p>
        </div>
        
        {items.length > 0 && (
          <div className="flex gap-3">
            <Badge variant="outline">Status: PENDING</Badge>
            <Badge variant="default">{admin.role.toUpperCase()}</Badge>
          </div>
        )}
      </header>
      
      {items.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tidak ada item dalam antrian</CardTitle>
            <CardDescription>
              Semua cerita telah ditinjau atau menunggu validator rerun. Tidak ada insiden pending.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          <Separator />
          
          {/* Client component handles real-time updates and interactions */}
          <ClientComponent 
            initialItems={items}
            reviewerRole={admin.role}
          />
          
          <Card>
            <CardHeader>
              <CardTitle className="text-base text-destructive">Peringatan Penting</CardTitle>
            </CardHeader>
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
        </>
      )}
    </main>
  )
}
