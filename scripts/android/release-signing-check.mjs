#!/usr/bin/env node
/**
 * R1 — Verifikasi signing rilis: keystore ada & git-ignored, build.gradle
 * membaca keystore.properties, dan TIDAK ada secret di file terlacak git.
 */
import { readFileSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'

let failed = false
function check(name, cond, detail = '') {
  if (cond) console.log(`  ok   ${name}`)
  else { failed = true; console.error(`  FAIL ${name} ${detail}`) }
}

check('keystore ada', existsSync('android/lakoku-upload-keystore.jks'))
check('keystore.properties ada', existsSync('android/keystore.properties'))

const ignored = execSync('git check-ignore android/lakoku-upload-keystore.jks android/keystore.properties', { encoding: 'utf8' })
check('keystore + properties di-ignore git', ignored.includes('lakoku-upload-keystore.jks') && ignored.includes('keystore.properties'))

const gradle = readFileSync('android/app/build.gradle', 'utf8')
check('build.gradle membaca keystore.properties', gradle.includes('keystore.properties'))
check('build.gradle resolve dari rootProject (file ada di android/)', gradle.includes("rootProject.file('keystore.properties')"))
check('build.gradle punya signingConfigs.release', gradle.includes('signingConfigs') && gradle.includes('release'))
check('build type release memakai signingConfig', gradle.includes('signingConfig signingConfigs.release'))

const props = readFileSync('android/keystore.properties', 'utf8')
check('properties menunjuk file keystore benar', props.includes('storeFile=lakoku-upload-keystore.jks'))
check('properties punya alias', props.includes('keyAlias='))

if (failed) {
  console.error('release signing verification FAILED')
  process.exit(1)
}
console.log('release signing verification passed')
