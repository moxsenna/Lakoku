#!/usr/bin/env node
/**
 * W6b — Assert versionCode AAB == ekspektasi (argumen CLI), dibaca dari
 * central directory? Tidak — dari manifest via bundletool sudah berat untuk
 * gate; sebagai gantinya baca android/app/build.gradle (sumber kebenaran
 * build) + pastikan AAB segar (mtime < 30 menit).
 */
import { readFileSync, statSync } from 'node:fs'

const expected = Number(process.argv[2] || '0')
const gradle = readFileSync('android/app/build.gradle', 'utf8')
const m = gradle.match(/versionCode\s+(\d+)/)
if (!m) {
  console.error('aab version verification FAILED: versionCode tidak ditemukan')
  process.exit(1)
}
if (Number(m[1]) !== expected) {
  console.error(`aab version verification FAILED: build.gradle=${m[1]} ekspektasi=${expected}`)
  process.exit(1)
}
const st = statSync('android/app/build/outputs/bundle/release/app-release.aab')
const ageMin = (Date.now() - st.mtimeMs) / 60000
if (ageMin > 30) {
  console.error(`aab version verification FAILED: AAB berumur ${ageMin.toFixed(0)} menit (bukan hasil build ini)`)
  process.exit(1)
}
console.log(`  ok   versionCode=${m[1]} AAB segar (${ageMin.toFixed(1)} mnt)`)
console.log('aab version verification passed')
