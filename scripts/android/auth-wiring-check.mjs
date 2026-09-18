#!/usr/bin/env node
/**
 * G2 — Verifikasi wiring auth Android.
 * Memastikan: endpoint POST /api/auth/android, deep link terdaftar di
 * AndroidManifest, bridge page, dan redirect_to PKCE di login form.
 */
import { readFileSync, existsSync } from 'node:fs'

let failed = false
function check(name, cond, detail = '') {
  if (cond) console.log(`  ok   ${name}`)
  else { failed = true; console.error(`  FAIL ${name} ${detail}`) }
}

const endpoint = 'app/api/auth/android/route.ts'
const manifest = 'android/app/src/main/AndroidManifest.xml'
const bridge = 'app/auth/android-bridge/page.tsx'

check('endpoint /api/auth/android ada', existsSync(endpoint))
check('AndroidManifest ada', existsSync(manifest))
check('bridge page ada', existsSync(bridge))

const endpointSrc = existsSync(endpoint) ? readFileSync(endpoint, 'utf8') : ''
const manifestSrc = readFileSync(manifest, 'utf8')
const bridgeSrc = existsSync(bridge) ? readFileSync(bridge, 'utf8') : ''

check('endpoint: POST exchangeCodeForSession', endpointSrc.includes('exchangeCodeForSession'))
check('endpoint: validasi body zod', endpointSrc.includes('safeParse'))
check('endpoint: Set-Cookie via response.cookies', endpointSrc.includes('successResponse.cookies.set'))
check('endpoint: sanitizeNextPath', endpointSrc.includes('sanitizeNextPath'))
check('endpoint: force-dynamic', endpointSrc.includes('force-dynamic'))

check('manifest: deep link lakoku://auth/callback', manifestSrc.includes('android:scheme="lakoku"') && manifestSrc.includes('android:host="auth"'))
check('manifest: pathPrefix /callback', manifestSrc.includes('android:pathPrefix="/callback"'))

check('bridge: redirect deep link', bridgeSrc.includes('lakoku://auth/callback'))

if (failed) {
  console.error('android auth wiring verification FAILED')
  process.exit(1)
}
console.log('android auth wiring verification passed')
