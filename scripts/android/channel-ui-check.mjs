#!/usr/bin/env node
/**
 * W1 — Verifikasi UI sadar-kanal: halaman kredit bercabang via UA marker,
 * katalog per kanal, PayCore + AdSense disembunyikan khusus di app,
 * jalur web tidak berubah.
 */
import { readFileSync } from 'node:fs'

let failed = false
function check(name, cond, detail = '') {
  if (cond) console.log(`  ok   ${name}`)
  else { failed = true; console.error(`  FAIL ${name} ${detail}`) }
}

const page = readFileSync('app/(shell)/kredit/page.tsx', 'utf8')
const channel = readFileSync('lib/android/channel.ts', 'utf8')
const capCfg = readFileSync('capacitor.config.ts', 'utf8')

check('UA marker terdaftar di capacitor config', capCfg.includes("appendUserAgent: 'LakokuAndroid'"))
check('helper kanal ada (marker + web default)', channel.includes('LakokuAndroid') && channel.includes("return 'web'"))
check('halaman kredit membaca kanal request', page.includes('getRequestChannel()'))
check('halaman kredit memakai katalog per kanal', page.includes("listCreditProducts(isAndroid ? 'android' : 'web')"))
check('cabang android memakai AndroidBuySection', page.includes('<AndroidBuySection'))
check('footer PayCore disembunyikan di app', page.includes('{!isAndroid && ('))
check('AdSense dimatikan di app (tanpa resolveAdSlot)', page.includes('isAndroid ? Promise.resolve(androidNoAds)'))
check('jalur web tetap: BuyCreditButton dipakai', page.includes('<BuyCreditButton'))
check('jalur web tetap: footer PayCore ada untuk web', page.includes('diproses aman oleh PayCore'))

if (failed) {
  console.error('channel ui verification FAILED')
  process.exit(1)
}
console.log('channel ui verification passed')
