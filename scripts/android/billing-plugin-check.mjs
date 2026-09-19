#!/usr/bin/env node
/**
 * W5 — Verifikasi plugin billing: dep terinstal, tersinkron ke proyek Android
 * (capacitor.plugins.json), dan komponen memakai store yang benar.
 */
import { readFileSync, existsSync } from 'node:fs'

let failed = false
function check(name, cond, detail = '') {
  if (cond) console.log(`  ok   ${name}`)
  else { failed = true; console.error(`  FAIL ${name} ${detail}`) }
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
check('cordova-plugin-purchase terinstal', typeof deps['cordova-plugin-purchase'] === 'string')

const pluginsJson = 'android/app/src/main/assets/capacitor.plugins.json'
check('capacitor.plugins.json ada (hasil cap sync)', existsSync(pluginsJson))

// Plugin Cordova didaftarkan di modul generated (git-ignored), bukan plugins.json.
const purchaseJava = 'android/capacitor-cordova-android-plugins/src/main/java/cc/fovea/PurchasePlugin.java'
check('plugin purchase tersinkron ke Android (PurchasePlugin.java)', existsSync(purchaseJava))

const comp = readFileSync('components/kredit/android-buy-section.tsx', 'utf8')
check('komponen memakai CdvPurchase store', comp.includes('CdvPurchase'))
check('komponen verify ke route server', comp.includes('/api/play-billing/verify'))
check('komponen finish setelah grant', comp.includes('tx.finish()'))
check('tanpa hardcoded SKU', !comp.includes("lakoku_credits_"))

if (failed) {
  console.error('billing plugin verification FAILED')
  process.exit(1)
}
console.log('billing plugin verification passed')
