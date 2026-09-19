#!/usr/bin/env node
/** Screenshot tablet dalam-app (akun pemilik via env, tak pernah dicetak). */
import { chromium } from 'playwright'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const BASE = 'http://localhost:3000'
const { SHOT_EMAIL, SHOT_PASS } = process.env
if (!SHOT_EMAIL || !SHOT_PASS) {
  console.error('need SHOT_EMAIL/SHOT_PASS env')
  process.exit(1)
}
const shots = [
  { name: 'tablet7-2-koleksiku', url: '/koleksiku', w: 1080, h: 1920 },
  { name: 'tablet10-2-koleksiku', url: '/koleksiku', w: 1440, h: 2560 },
]

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })
for (const s of shots) {
  const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  try {
    await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle', timeout: 45000 })
    await page.fill('input[type="email"]', SHOT_EMAIL)
    await page.fill('input[type="password"]', SHOT_PASS)
    await Promise.all([
      page.waitForURL((u) => !u.pathname.startsWith('/auth/login'), { timeout: 30000 }).catch(() => {}),
      page.click('button[type="submit"]'),
    ])
    await page.goto(BASE + s.url, { waitUntil: 'networkidle', timeout: 45000 })
    await page.waitForTimeout(4000)
    await page.screenshot({ path: `store-assets/screenshots/${s.name}.png` })
    console.log(`  ok   ${s.name}`)
  } catch (err) {
    console.error(`  FAIL ${s.name}: ${err.message.split('\n')[0]}`)
  }
  await ctx.close()
}
await browser.close()
console.log('owner tablet shots done')
