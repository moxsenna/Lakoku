#!/usr/bin/env node
/** Screenshot tablet 7" 1350x2400 (9:16 tepat): landing tamu + koleksiku owner. */
import { chromium } from 'playwright'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const BASE = 'http://localhost:3000'
const W = 1350
const H = 2400
const { SHOT_EMAIL, SHOT_PASS } = process.env

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })

{
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 45000 })
  await page.waitForTimeout(2500)
  await page.screenshot({ path: 'store-assets/screenshots/tablet7-1-landing.png' })
  console.log('  ok   tablet7-1-landing')
  await page.close()
}

if (SHOT_EMAIL && SHOT_PASS) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle', timeout: 45000 })
  await page.fill('input[type="email"]', SHOT_EMAIL)
  await page.fill('input[type="password"]', SHOT_PASS)
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/auth/login'), { timeout: 30000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ])
  await page.goto(`${BASE}/koleksiku`, { waitUntil: 'networkidle', timeout: 45000 })
  await page.waitForTimeout(4000)
  await page.screenshot({ path: 'store-assets/screenshots/tablet7-2-koleksiku.png' })
  console.log('  ok   tablet7-2-koleksiku')
  await ctx.close()
}
await browser.close()
console.log('tablet7 shots done')
