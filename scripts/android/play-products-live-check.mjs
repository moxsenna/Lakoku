#!/usr/bin/env node
/**
 * W2 — Bukti runtime: jalankan dev server, GET /api/play-billing/products,
 * pastikan 6 SKU android + shape benar, matikan server. Gagal jujur bila
 * route error / katalog kosong (mis. produk IAP belum aktif — tetap 200
 * dengan array kosong? tidak: route hanya filter channel+active; sebelum
 * aktivasi hasilnya [] dan gate GAGAL sesuai desain — aktivasi = W8).
 */
import { spawn } from 'node:child_process'

const proc = spawn('cmd.exe', ['/c', 'pnpm dev --port 3100'], { stdio: 'ignore' })

async function waitReady(tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch('http://localhost:3100/api/play-billing/products')
      if (res.ok || res.status === 500) return res
    } catch { /* belum siap */ }
    await new Promise((r) => setTimeout(r, 3000))
  }
  throw new Error('dev server tidak siap')
}

let failed = false
try {
  const res = await waitReady()
  const json = await res.json().catch(() => null)
  const products = json?.products ?? []
  if (!res.ok) {
    failed = true
    console.error(`  FAIL status ${res.status}: ${JSON.stringify(json)?.slice(0, 120)}`)
  }
  if (products.length !== 6) {
    failed = true
    console.error(`  FAIL jumlah produk != 6 (aktual ${products.length})`)
  }
  for (const p of products) {
    if (!p.playSku || !p.productKey || typeof p.displayTotalCredits !== 'number') {
      failed = true
      console.error(`  FAIL shape produk rusak: ${JSON.stringify(p).slice(0, 120)}`)
      break
    }
  }
  if (products.some((p) => !String(p.playSku).startsWith('lakoku_credits_'))) {
    failed = true
    console.error('  FAIL playSku tidak berkonvensi lakoku_credits_*')
  }
  if (!failed) console.log(`  ok   6 produk android live: ${products.map((p) => p.playSku).join(',')}`)
} catch (err) {
  failed = true
  console.error(`  FAIL ${err.message}`)
} finally {
  proc.kill()
}

if (failed) {
  console.error('play products live verification FAILED')
  process.exit(1)
}
console.log('play products live verification passed')
