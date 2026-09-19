#!/usr/bin/env node
/**
 * R3 — Verifikasi dimensi aset ikon dengan membaca header PNG (IHDR),
 * tanpa dependensi. Sumber: public/logo-full.png (1254x1254 resmi).
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

let failed = false
function check(name, cond, detail = '') {
  if (cond) console.log(`  ok   ${name}`)
  else { failed = true; console.error(`  FAIL ${name} ${detail}`) }
}

function pngSize(path) {
  const buf = readFileSync(path)
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not png')
  const w = buf.readUInt32BE(16)
  const h = buf.readUInt32BE(20)
  return { w, h }
}

const legacy = { 'mipmap-mdpi': 48, 'mipmap-hdpi': 72, 'mipmap-xhdpi': 96, 'mipmap-xxhdpi': 144, 'mipmap-xxxhdpi': 192 }
const fore = { 'mipmap-mdpi': 108, 'mipmap-hdpi': 162, 'mipmap-xhdpi': 216, 'mipmap-xxhdpi': 324, 'mipmap-xxxhdpi': 432 }

for (const [dir, size] of Object.entries(legacy)) {
  for (const name of ['ic_launcher.png', 'ic_launcher_round.png']) {
    const p = join('android/app/src/main/res', dir, name)
    if (!existsSync(p)) { check(`${dir}/${name}`, false, 'hilang'); continue }
    const { w, h } = pngSize(p)
    check(`${dir}/${name} ${size}x${size}`, w === size && h === size, `aktual ${w}x${h}`)
  }
}
for (const [dir, size] of Object.entries(fore)) {
  const p = join('android/app/src/main/res', dir, 'ic_launcher_foreground.png')
  if (!existsSync(p)) { check(`${dir}/foreground`, false, 'hilang'); continue }
  const { w, h } = pngSize(p)
  check(`${dir}/foreground ${size}x${size}`, w === size && h === size, `aktual ${w}x${h}`)
}

const storeIcon = 'store-assets/icon-512.png'
if (!existsSync(storeIcon)) check('store icon 512', false, 'hilang')
else {
  const { w, h } = pngSize(storeIcon)
  check('store icon 512x512', w === 512 && h === 512, `aktual ${w}x${h}`)
}

const feature = 'store-assets/feature-graphic-1024x500.png'
if (!existsSync(feature)) check('feature graphic', false, 'hilang')
else {
  const { w, h } = pngSize(feature)
  check('feature graphic 1024x500', w === 1024 && h === 500, `aktual ${w}x${h}`)
}

if (failed) {
  console.error('icon assets verification FAILED')
  process.exit(1)
}
console.log('icon assets verification passed')
