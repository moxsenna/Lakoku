#!/usr/bin/env node
/**
 * Shoot ulang SEMUA screenshot sebagai layout mobile:
 * viewport CSS sempit (<768px) + deviceScaleFactor 2 → PNG tetap 9:16 tepat.
 * Guest: landing/login/signup. Owner (env): beranda/koleksiku/cerita.
 */
import { chromium } from 'playwright'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const BASE = 'http://localhost:3000'
const DSF = 2
// [nama, cssW, cssH] → PNG 2x = 9:16 tepat
const SIZES = {
  phone: [540, 960],
  t7: [675, 1200],
  t10: [720, 1280],
}
const { SHOT_EMAIL, SHOT_PASS } = process.env

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })

async function guestShot(name, url, size) {
  const [w, h] = SIZES[size]
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: DSF })
  await page.goto(BASE + url, { waitUntil: 'networkidle', timeout: 45000 })
  await page.waitForTimeout(2500)
  await page.screenshot({ path: `store-assets/screenshots/${name}.png` })
  console.log(`  ok   ${name}`)
  await page.close()
}

await guestShot('phone-1-landing', '/', 'phone')
await guestShot('phone-2-login', '/auth/login', 'phone')
await guestShot('phone-3-signup', '/auth/sign-up', 'phone')
await guestShot('tablet7-1-landing', '/', 't7')
await guestShot('tablet10-1-landing', '/', 't10')

if (SHOT_EMAIL && SHOT_PASS) {
  for (const [size, pages] of [
    ['phone', [['phone-2-beranda', '/beranda'], ['phone-4-koleksiku', '/koleksiku'], ['phone-5-cerita', '/cerita/janji-di-balik-kontrak-qn76kl']]],
    ['t7', [['tablet7-2-koleksiku', '/koleksiku']]],
    ['t10', [['tablet10-2-koleksiku', '/koleksiku']]],
  ]) {
    const [w, h] = SIZES[size]
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: DSF })
    const page = await ctx.newPage()
    await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle', timeout: 45000 })
    await page.fill('input[type="email"]', SHOT_EMAIL)
    await page.fill('input[type="password"]', SHOT_PASS)
    await Promise.all([
      page.waitForURL((u) => !u.pathname.startsWith('/auth/login'), { timeout: 30000 }).catch(() => {}),
      page.click('button[type="submit"]'),
    ])
    for (const [name, url] of pages) {
      try {
        await page.goto(BASE + url, { waitUntil: 'networkidle', timeout: 45000 })
        await page.waitForTimeout(4000)
        await page.screenshot({ path: `store-assets/screenshots/${name}.png` })
        console.log(`  ok   ${name} url=${new URL(page.url()).pathname}`)
      } catch (err) {
        console.error(`  FAIL ${name}: ${err.message.split('\n')[0]}`)
      }
    }
    await ctx.close()
  }
}
await browser.close()
console.log('mobile-layout shots done')
