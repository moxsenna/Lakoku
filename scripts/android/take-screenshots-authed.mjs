#!/usr/bin/env node
/**
 * Screenshot Play Store sebagai user login (akun reviewer).
 * Kredensial dibaca dari file lokal, tidak pernah dicetak.
 */
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const BASE = 'http://localhost:3000'
const cred = Object.fromEntries(
  readFileSync(`${process.env.TEMP}/lakoku-reviewer-password.txt`, 'utf8')
    .split('\n').filter(Boolean).map((l) => l.split(':').map((s) => s.trim())),
)

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })

async function authedContext(w, h) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle', timeout: 45000 })
  await page.fill('input[type="email"]', cred.email)
  await page.fill('input[type="password"]', cred.password)
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith('/auth/login'), { timeout: 30000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ])
  await page.waitForTimeout(3000)
  return { ctx, page }
}

const shots = [
  { name: 'phone-1-beranda', url: '/beranda', w: 1080, h: 1920 },
  { name: 'phone-3-koleksiku', url: '/koleksiku', w: 1080, h: 1920 },
  { name: 'tablet7-1-beranda', url: '/beranda', w: 1200, h: 1920 },
  { name: 'tablet10-1-beranda', url: '/beranda', w: 1600, h: 2560 },
]

for (const s of shots) {
  const { ctx, page } = await authedContext(s.w, s.h)
  try {
    await page.goto(BASE + s.url, { waitUntil: 'networkidle', timeout: 45000 })
    await page.waitForTimeout(4000)
    await page.screenshot({ path: `store-assets/screenshots/${s.name}.png` })
    console.log(`  ok   ${s.name} url=${new URL(page.url()).pathname}`)
  } catch (err) {
    console.error(`  FAIL ${s.name}: ${err.message.split('\n')[0]}`)
  }
  await ctx.close()
}
await browser.close()
console.log('authed screenshots done')
