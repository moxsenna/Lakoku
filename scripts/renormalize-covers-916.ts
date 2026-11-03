/**
 * Re-normalisasi deterministik sampul katalog ke kanvas 9:16 (720x1280).
 *
 * Latar belakang: 5 sampul katalog lama dibuat saat kanvas normalisasi masih
 * 2:3 (832x1248, era 822c00d) sehingga di kontainer UI 9:16 (deff4ef) terpotong
 * sisinya. Skrip ini TANPA panggilan AI: byte sampul saat ini diambil dari R2,
 * dilewatkan ke normalizeCoverImage (contain + latar blur dari gambar yang
 * sama), lalu diunggah sebagai key baru; key lama TIDAK dihapus (rollback).
 *
 * Pemakaian:
 *   NODE_OPTIONS='--conditions=react-server' npx tsx scripts/renormalize-covers-916.ts           # dry-run
 *   NODE_OPTIONS='--conditions=react-server' npx tsx scripts/renormalize-covers-916.ts --apply   # tulis R2+DB
 */
import { readFileSync } from 'node:fs'

for (const name of ['.env.local', '.env']) {
  try {
    const raw = readFileSync(name, 'utf8')
    for (const line of raw.split('\n')) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*['"]?(.*?)['"]?\s*$/)
      if (match?.[1] && match[2] !== undefined && !process.env[match[1]]) {
        process.env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '')
      }
    }
  } catch {}
}

import sharp from 'sharp'
import { Pool } from 'pg'
import { normalizeCoverImage } from '@/lib/cover/image'
import { putCover } from '@/lib/cover/storage'

const APPLY = process.argv.includes('--apply')
const TARGET_WIDTH = 720
const TARGET_HEIGHT = 1280

async function main(): Promise<void> {
  if (APPLY) {
    console.log('MODE: APPLY — sampul yang belum 9:16 akan ditulis ulang ke R2 + DB.\n')
  } else {
    console.log('MODE: DRY-RUN — tidak ada penulisan. Tambahkan --apply untuk menulis.\n')
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const rows = await pool.query<{ id: string; title: string; cover: string }>(
    `select id, title, cover from stories where id like 'catalog:%' and cover <> '' order by id`,
  )
  console.log(`Sampul katalog ditemukan: ${rows.rows.length}\n`)

  const coverBase = (process.env.NEXT_PUBLIC_COVER_BASE ?? '').replace(/\/+$/, '')
  let already = 0
  let normalized = 0
  let failed = 0

  for (const row of rows.rows) {
    if (row.cover.startsWith('/')) {
      console.log(`[LEWATI] ${row.id} — cover lokal/legacy (${row.cover}), bukan key R2`)
      failed++
      continue
    }
    const url = row.cover.startsWith('http')
      ? row.cover
      : `${coverBase}/${row.cover.replace(/^\/+/, '')}`

    try {
      const res = await fetch(url)
      if (!res.ok) {
        console.log(`[GAGAL] ${row.id} — fetch ${res.status}: ${url}`)
        failed++
        continue
      }
      const bytes = Buffer.from(await res.arrayBuffer())
      const meta = await sharp(bytes).metadata()
      const width = meta.width ?? 0
      const height = meta.height ?? 0
      if (width === TARGET_WIDTH && height === TARGET_HEIGHT) {
        console.log(`[SUDAH 9:16] ${row.id} — ${width}x${height}, lewati`)
        already++
        continue
      }

      if (!APPLY) {
        console.log(`[PERLU] ${row.id} — ${width}x${height} → akan dinormalisasi ke 720x1280`)
        normalized++
        continue
      }

      const norm = await normalizeCoverImage(bytes)
      const stored = await putCover(row.id, norm.data)
      if (!stored.ok) {
        console.log(`[GAGAL] ${row.id} — putCover: ${stored.detail}`)
        failed++
        continue
      }
      await pool.query(`update stories set cover = $1 where id = $2`, [stored.key, row.id])
      console.log(
        `[NORMALISASI] ${row.id} — ${width}x${height} → 720x1280; key lama ${row.cover} (disimpan di R2, tak dihapus); key baru ${stored.key}`,
      )
      normalized++
    } catch (err) {
      console.log(`[GAGAL] ${row.id} — ${err instanceof Error ? err.message : err}`)
      failed++
    }
  }

  console.log(
    `\nRingkasan: ${already} sudah 9:16, ${normalized} ${APPLY ? 'dinormalisasi' : 'perlu normalisasi'}, ${failed} gagal/lewati`,
  )
  await pool.end()
  if (failed > 0) process.exitCode = 1
}

main().catch((err) => {
  console.error('Fatal renormalize-covers-916:', err instanceof Error ? err.message : err)
  process.exit(1)
})
