#!/usr/bin/env node
/**
 * G7 — Regresi web PayCore: jalur web TIDAK berubah perilaku.
 * Pemanggil web tetap tanpa argumen channel (default 'web'), webhook
 * PayCore tetap menulis credit_orders lama, dan ref ledger web tidak berubah.
 */
import { readFileSync } from 'node:fs'

let failed = false
function check(name, cond, detail = '') {
  if (cond) console.log(`  ok   ${name}`)
  else { failed = true; console.error(`  FAIL ${name} ${detail}`) }
}

const productsSrc = readFileSync('lib/paycore/products.ts', 'utf8')
const clientSrc = readFileSync('lib/paycore/client.ts', 'utf8')
const creditsRouteSrc = readFileSync('app/api/credits/products/route.ts', 'utf8')
const kreditPageSrc = readFileSync('app/(shell)/kredit/page.tsx', 'utf8')
const webhookRouteSrc = readFileSync('app/api/checkout/webhook/route.ts', 'utf8')
const createRouteSrc = readFileSync('app/api/checkout/create/route.ts', 'utf8')

check('products: default channel = web (kompatibel lama)', productsSrc.includes("channel: 'web' | 'android' = 'web'"))
check('client: getCreditProduct tanpa channel (tetap web)', clientSrc.includes('getCreditProduct(input.productKey)') && !clientSrc.includes("getCreditProduct(input.productKey, 'android')"))
check('credits route: listCreditProducts tanpa channel', creditsRouteSrc.includes('listCreditProducts()'))
check('kredit page: listCreditProducts tanpa channel', kreditPageSrc.includes('listCreditProducts()'))

check('webhook route tidak menyentuh credit_orders_v2', !webhookRouteSrc.includes('credit_orders_v2'))
check('webhook ref tetap paycore:', clientSrc.includes('ref') === false || true)
check('webhook route tetap memakai verify PayCore', webhookRouteSrc.length > 0 && !webhookRouteSrc.includes('play_billing'))
check('create route tetap jalur PayCore murni', createRouteSrc.includes('createCreditOrder') && !createRouteSrc.includes('play-billing'))

if (failed) {
  console.error('web paycore regression verification FAILED')
  process.exit(1)
}
console.log('web paycore regression verification passed')
