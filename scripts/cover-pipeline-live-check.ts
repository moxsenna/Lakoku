/**
 * Uji hidup satu kali untuk pipeline sampul TANPA DB dan TANPA storage:
 * prompt -> provider -> sharp -> WebP tersimpan ke tmp/.
 *
 * Biaya: satu panggilan gambar ke penyedia. Jalankan eksplisit:
 *   node scripts/run-smoke.cjs scripts/cover-pipeline-live-check.ts
 */
import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { generateCoverImage, buildCoverPrompt } from '../lib/cover/provider'
import { normalizeCoverImage, sniffImageFormat } from '../lib/cover/image'

async function main(): Promise<void> {
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (m) process.env[m[1]] ??= m[2].trim().replace(/^["']|["']$/g, '')
  }

  const input = {
    title: 'Pesan Malam di Kota Tua',
    tagline: 'Rahasia yang tertidur di gang kota tua',
    role: 'Aruna, jurnalis muda yang kehilangan ingatan',
    tropes: ['misteri keluarga', 'romansa kota tua'],
  }

  console.log('--- PROMPT ---')
  console.log(buildCoverPrompt(input))

  const t0 = Date.now()
  const result = await generateCoverImage(input)
  console.log(`provider: ${result.ok ? 'OK' : 'FAIL'} dalam ${Date.now() - t0}ms`)

  if (!result.ok) {
    console.error(result)
    process.exit(1)
  }
  console.log(`byte mentah: ${result.image.byteLength}, sniff: ${sniffImageFormat(result.image)}`)

  const normalized = await normalizeCoverImage(result.image)
  console.log(`webp: ${normalized.bytes} byte, ${normalized.width}x${normalized.height}`)

  const out = 'tmp/cover-live-check.webp'
  await writeFile(out, normalized.data)
  console.log(`tersimpan: ${out} (hapus manual bila sudah diperiksa)`)
}

void main()
