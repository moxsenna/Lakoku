#!/usr/bin/env node
/**
 * Screenshot dalam-app memakai akun pemilik (env SHOT_EMAIL/SHOT_PASS).
 * Kredensial tidak pernah dicetak atau disimpan.
 */
import { chromium } from 'playwright'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const BASE = 'http://localhost:3000'
const { SHOT_EMAIL, SHOT_PASS } = process.env
if (!SHOT_EMAIL || !SHOT_PASS) {
  console.error('need SHOT_EMAIL/SHOT_PASS env')
  process.exit(1)
}

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })
const ctx = await browser.newContext({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 })
const page = await ctx.newPage()

await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle', timeout: 45000 })
await page.fill('input[type="email"]', SHOT_EMAIL)
await page.fill('input[type="password"]', SHOT_PASS)
await Promise.all([
  page.waitForURL((url) => !url.pathname.startsWith('/auth/login'), { timeout: 30000 }).catch(() => {}),
  page.click('button[type="submit"]'),
])
await page.waitForTimeout(3000)
console.log(`after login: ${new URL(page.url()).pathname}`)

async function shoot(name, url) {
  await page.goto(BASE + url, { waitUntil: 'networkidle', timeout: 45000 })
  await page.waitForTimeout(4000)
  const text = (await page.innerText('body')).trim()
  await page.screenshot({ path: `store-assets/screenshots/${name}.png` })
  console.log(`${name} url=${new URL(page.url()).pathname} chars=${text.length}`)
}

// Cari tautan cerita pertama di beranda untuk screenshot detail
await page.goto(`${BASE}/beranda`, { waitUntil: 'networkidle', timeout: 45000 })
await page.waitForTimeout(4000)
await shoot('phone-2-beranda', '/beranda')
await shoot('phone-4-koleksiku', '/koleksiku')

const storyLink = await page.$('a[href*="/cerita/"], a[href*="/baca/"]')
if (storyLink) {
  const href = await storyLink.getAttribute('href')
  await shoot('phone-5-cerita', href)
} else {
  console.log('no story link found on beranda')
}
await browser.close()
console.log('owner screenshots done')
