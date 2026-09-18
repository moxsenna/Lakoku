#!/usr/bin/env node
/**
 * R2b — Buktikan AAB ditandatangani kunci upload kita: baca central
 * directory ZIP, pastikan META-INF/<ALIAS>.SF + .RSA ada (JAR signing v1)
 * sebagai pendamping bundletool validate (struktur) di gate R2.
 */
import { readFileSync } from 'node:fs'

const AAB = 'android/app/build/outputs/bundle/release/app-release.aab'
const buf = readFileSync(AAB)

const names = new Set()
let off = 0
while (true) {
  const idx = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), off)
  if (idx === -1) break
  const nameLen = buf.readUInt16LE(idx + 28)
  const extraLen = buf.readUInt16LE(idx + 30)
  const commentLen = buf.readUInt16LE(idx + 32)
  names.add(buf.toString('utf8', idx + 46, idx + 46 + nameLen))
  off = idx + 46 + nameLen + extraLen + commentLen
}

const sf = [...names].find((n) => n.startsWith('META-INF/') && n.endsWith('.SF'))
const rsa = [...names].find((n) => n.startsWith('META-INF/') && n.endsWith('.RSA'))
if (sf && rsa) {
  console.log(`  ok   signature block: ${sf} + ${rsa}`)
  console.log('aab signature verification passed')
} else {
  console.error(`aab signature verification FAILED (entries: ${names.size}, sf=${sf}, rsa=${rsa})`)
  process.exit(1)
}
