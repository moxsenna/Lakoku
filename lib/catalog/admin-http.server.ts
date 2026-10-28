import 'server-only'
import { NextResponse } from 'next/server'
import { requireAdminUser } from '@/lib/admin/auth'
import { CatalogAdminError } from '@/lib/catalog/admin.server'

export async function guardCatalogAdmin(): Promise<
  { admin: { id: string; email: string | undefined; role: 'owner' | 'admin' } } | { response: Response }
> {
  try {
    const admin = await requireAdminUser()
    return { admin }
  } catch (err) {
    const message = (err as Error)?.message
    if (message === 'Unauthenticated') {
      return { response: NextResponse.json({ error: 'Tidak diizinkan.' }, { status: 401 }) }
    }
    return { response: NextResponse.json({ error: 'Tidak diizinkan.' }, { status: 403 }) }
  }
}

export function catalogErrorResponse(err: unknown): Response {
  if (err instanceof CatalogAdminError) {
    if (err.code === 'NOT_FOUND' || err.code === 'CHAPTER_NOT_FOUND') {
      return NextResponse.json({ error: 'Tidak ditemukan.' }, { status: 404 })
    }
    if (err.code === 'NOT_CATALOG') {
      return NextResponse.json({ error: 'Bukan novel katalog.' }, { status: 400 })
    }
    if (err.code === 'NOT_READY') {
      return NextResponse.json({ error: 'Novel belum siap diterbitkan.' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Data tidak valid.' }, { status: 400 })
  }
  console.log('[admin/catalog] gagal:', (err as Error)?.message)
  return NextResponse.json({ error: 'Gagal memproses permintaan.' }, { status: 500 })
}
