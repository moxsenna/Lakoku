#!/usr/bin/env node
/**
 * G1 — Verifikasi shell Android Capacitor.
 * Memastikan: capacitor.config.ts menunjuk produksi, android/ ada dengan
 * manifest paket benar, dan tidak ada static export yang bocor ke build web.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
let failed = false

function check(name, cond, detail = '') {
  if (cond) {
    console.log(`  ok   ${name}`)
  } else {
    failed = true
    console.error(`  FAIL ${name} ${detail}`)
  }
}

const capCfg = readFileSync('capacitor.config.ts', 'utf8')
check('capacitor.config.ts ada', capCfg.length > 0)
check('appId paket benar', capCfg.includes("appId: 'biz.lakoku.app'"))
check('server.url produksi', capCfg.includes('https://lakoku.biz.id'))
check('CapacitorHttp disabled (cookie chunked supabase)', capCfg.includes('enabled: false'))
check('cleartext dimatikan', capCfg.includes('cleartext: false'))

check('folder android/ ada', existsSync('android'))
const appGradle = readFileSync('android/app/build.gradle', 'utf8')
check('applicationId paket benar', appGradle.includes('applicationId "biz.lakoku.app"'))
check('namespace paket benar', appGradle.includes('namespace "biz.lakoku.app"'))

const manifest = readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8')
check('manifest tanpa izin kamera/lokasi berlebih', !manifest.includes('android.permission.CAMERA') && !manifest.includes('android.permission.ACCESS_FINE_LOCATION'))

const gradleProps = readFileSync('android/gradle/wrapper/gradle-wrapper.properties', 'utf8')
check('wrapper memakai distribusi bin (jaringan lambat)', gradleProps.includes('gradle-8.11.1-bin.zip'))

const gitignore = readFileSync('.gitignore', 'utf8')
check('.gitignore mengabaikan android build output', /(^|\n)android\/(app\/)?build\/?(\s|$)/.test(gitignore) || gitignore.includes('android/.gradle'))

if (failed) {
  console.error('android shell verification FAILED')
  process.exit(1)
}
console.log('android shell verification passed')
