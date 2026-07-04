/**
 * Reader API (interim di Next.js route handlers — AMENDMENTS v0.4).
 * Kontrak ini yang nanti dipindahkan ke Cloudflare Workers tanpa berubah.
 */
import { NextResponse } from 'next/server'
import { queryStories } from '@/lib/api/queries'

export async function GET() {
  try {
    const stories = await queryStories()
    return NextResponse.json({ stories })
  } catch {
    return NextResponse.json(
      { error: 'Gagal memuat daftar cerita.' },
      { status: 500 },
    )
  }
}
