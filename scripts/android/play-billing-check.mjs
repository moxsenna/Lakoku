#!/usr/bin/env node
/**
 * G4 — Verifikasi jalur verifikasi server-side Play Billing.
 * Memastikan: modul verifikasi Google server-side, route verify dengan
 * auth+fail-closed, grant idempoten (RPC returns already_granted), dan
 * kill switch env.
 */
import { readFileSync, existsSync } from 'node:fs'

let failed = false
function check(name, cond, detail = '') {
  if (cond) console.log(`  ok   ${name}`)
  else { failed = true; console.error(`  FAIL ${name} ${detail}`) }
}

const verify = 'app/api/play-billing/verify/route.ts'
const server = 'lib/paycore/play-billing.server.ts'
const grant = 'lib/paycore/play-billing-grant.server.ts'
const migration = 'supabase/migrations/20260917120000_play_billing_channel_model.sql'

check('route verify ada', existsSync(verify))
check('modul verifikasi ada', existsSync(server))
check('modul grant ada', existsSync(grant))

const verifySrc = readFileSync(verify, 'utf8')
const serverSrc = readFileSync(server, 'utf8')
const grantSrc = readFileSync(grant, 'utf8')
const sql = readFileSync(migration, 'utf8')

check('route: auth cookie wajib (401 tanpa sesi)', verifySrc.includes('supabase.auth.getUser()'))
check('route: fail-closed saat not_configured (503)', verifySrc.includes('not_configured') && verifySrc.includes('503'))
check('route: validasi body zod', verifySrc.includes('BodySchema.safeParse'))
check('route: katalog dari DB (bukan klien)', verifySrc.includes('getCreditProductByPlaySku'))
check('route: verifikasi ke Google sebelum grant', verifySrc.indexOf('fetchPurchaseState') < verifySrc.indexOf('playBillingGrantV1'))
check('route: tidak ada hardcoded SKU', !verifySrc.includes("productId === '"))

check('server: kill switch env', serverSrc.includes("GOOGLE_PLAY_BILLING_ENABLED !== '1'"))
check('server: androidpublisher endpoint', serverSrc.includes('androidpublisher.googleapis.com'))
check('server: validasi purchaseState=0', serverSrc.includes('purchaseState === 0'))
check('server: validasi kind=1 (one-time)', serverSrc.includes('kind === 1'))
check('server: tidak dikonsumsi', serverSrc.includes('consumptionState === 0'))

check('grant: memanggil RPC play_billing_grant_v1', grantSrc.includes("rpc('play_billing_grant_v1'"))
check('migration: RPC returns table order_id+already_granted', sql.includes('returns table (order_id uuid, already_granted boolean)'))
check('grant: base+bonus dipisah', grantSrc.includes('p_credits_base') && grantSrc.includes('p_credits_bonus'))
check('ledger ref playbilling:', grantSrc.includes('playbilling:'))

if (failed) {
  console.error('play billing verification FAILED')
  process.exit(1)
}
console.log('play billing verification passed')
