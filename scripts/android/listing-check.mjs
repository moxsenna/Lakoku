#!/usr/bin/env node
/**
 * R4 — Verifikasi dokumen listing: section wajib ada, deskripsi pendek
 * <=80 karakter (batas Play), paket benar, URL privasi, 6 SKU.
 */
import { readFileSync, existsSync } from 'node:fs'

let failed = false
function check(name, cond, detail = '') {
  if (cond) console.log(`  ok   ${name}`)
  else { failed = true; console.error(`  FAIL ${name} ${detail}`) }
}

const doc = 'docs/android/PLAY_STORE_RELEASE.md'
check('dokumen listing ada', existsSync(doc))
if (!existsSync(doc)) { console.error('store listing verification FAILED'); process.exit(1) }
const src = readFileSync(doc, 'utf8')

for (const section of ['## Deskripsi singkat', '## Deskripsi lengkap', '## Produk dalam aplikasi', '## Keamanan Data', '## Langkah upload']) {
  check(`section ${section}`, src.includes(section))
}
check('paket biz.lakoku.app', src.includes('biz.lakoku.app'))
check('URL privasi lakoku.biz.id/privacy', src.includes('https://lakoku.biz.id/privacy'))
check('kategori Buku & Referensi', src.includes('Buku & Referensi'))

const shortMatch = src.match(/Deskripsi singkat \(maks 80 karakter\):\n\n(.+)\n/)
if (!shortMatch) check('deskripsi singkat terukur', false, 'format tidak ditemukan')
else {
  const len = [...shortMatch[1].trim()].length
  check(`deskripsi singkat ${len}<=80 char`, len <= 80 && len > 0, `aktual ${len}`)
}

const skus = src.match(/lakoku_credits_[a-z]+/g) ?? []
check('6 SKU unik di dokumen', new Set(skus).size === 6, `aktual ${new Set(skus).size}`)

if (failed) {
  console.error('store listing verification FAILED')
  process.exit(1)
}
console.log('store listing verification passed')
