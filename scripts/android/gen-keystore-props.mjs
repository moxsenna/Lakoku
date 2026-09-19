#!/usr/bin/env node
/** Generate keystore.properties with random password (never printed). */
import { randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'

const p = randomBytes(24).toString('base64url')
writeFileSync(
  'android/keystore.properties',
  `storeFile=lakoku-upload-keystore.jks\nstorePassword=${p}\nkeyAlias=lakoku-upload\nkeyPassword=${p}\n`,
)
console.log(`keystore properties written (password length ${p.length}, not shown)`)
