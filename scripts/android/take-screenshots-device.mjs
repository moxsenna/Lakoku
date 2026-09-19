#!/usr/bin/env node
/**
 * Screenshot device sungguhan (isMobile + DPR asli) → full-bleed seperti HP.
 * Phone 390x844@3x, Tab7 600x960@2x, Tab10 800x1280@2x.
 */
import { chromium } from 'playwright'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const BASE = 'http://localhost:3000'
const { SHOT_EMAIL, SHOT_PASS } = process.env

const DEVICES = {
  phone: { w: 390, h: 844, dsf: 3 },
  t7: { w: 600, h: 960, dsf: 2 },
  t10: { w: 800, h: 1280, dsf: 2 },
}

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })

async function newPage(dev) {
  const d = DEVICES[dev]
  const ctx = await browser.newContext({
    viewport: { width: d.w, height: d.h },
    deviceScaleFactor: d.dsf,
    isMobile: true,
    hasTouch: true,
  })
  return { ctx, page: await ctx.newPage() }
}

async function login(page) {
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle', timeout: 45000 })
  await page.fill('input[type="email"]', SHOT_EMAIL)
  await page.fill('input[type="password"]', SHOT_PASS)
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/auth/login'), { timeout: 30000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ])
  await page.waitForTimeout(2000)
}

// Tamu
for (const [name, url, dev] of [
  ['phone-1-landing', '/', 'phone'],
  ['phone-2-login', '/auth/login', 'phone'],
  ['phone-3-signup', '/auth/sign-up', 'phone'],
  ['tablet7-1-landing', '/', 't7'],
  ['tablet10-1-landing', '/', 't10'],
]) {
  const { ctx, page } = await newPage(dev)
  await page.goto(BASE + url, { waitUntil: 'networkidle', timeout: 45000 })
  await page.waitForTimeout(2500)
  await page.screenshot({ path: `store-assets/screenshots/${name}.png` })
  console.log(`  ok   ${name}`)
  await ctx.close()
}

// Owner
if (SHOT_EMAIL && SHOT_PASS) {
  for (const [name, url, dev] of [
    ['phone-2-beranda', '/beranda', 'phone'],
    ['phone-4-koleksiku', '/koleksiku', 'phone'],
    ['phone-5-cerita', '/cerita/janji-di-balik-kontrak-qn76kl', 'phone'],
    ['tablet7-2-koleksiku', '/koleksiku', 't7'],
    ['tablet10-2-koleksiku', '/koleksiku', 't10'],
  ]) {
    const { ctx, page } = await newPage(dev)
    try {
      await login(page)
      await page.goto(BASE + url, { waitUntil: 'networkidle', timeout: 45000 })
      await page.waitForTimeout(4000)
      await page.screenshot({ path: `store-assets/screenshots/${name}.png` })
      console.log(`  ok   ${name} url=${new URL(page.url()).pathname}`)
    } catch (err) {
      console.error(`  FAIL ${name}: ${err.message.split('\n')[0]}`)
    }
    await ctx.close()
  }
}
await browser.close()
console.log('device shots done')
