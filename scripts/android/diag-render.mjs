#!/usr/bin/env node
/** Diagnostik: berapa banyak teks yang benar-benar ter-render pasca-login. */
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const BASE = 'http://localhost:3000'
const cred = Object.fromEntries(
  readFileSync(`${process.env.TEMP}/lakoku-reviewer-password.txt`, 'utf8')
    .split('\n').filter(Boolean).map((l) => l.split(':').map((s) => s.trim())),
)

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } })
const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.split('\n')[0]}`))
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 120)}`) })

await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle', timeout: 45000 })
await page.fill('input[type="email"]', cred.email)
await page.fill('input[type="password"]', cred.password)
await Promise.all([
  page.waitForURL((url) => !url.pathname.startsWith('/auth/login'), { timeout: 30000 }).catch(() => {}),
  page.click('button[type="submit"]'),
])
console.log(`after login: ${new URL(page.url()).pathname}`)
for (const url of ['/beranda', '/koleksiku', '/onboarding/selera']) {
  await page.goto(BASE + url, { waitUntil: 'networkidle', timeout: 45000 })
  await page.waitForTimeout(5000)
  const text = (await page.innerText('body')).trim()
  console.log(`${url} -> ${new URL(page.url()).pathname} | chars=${text.length} | head=${text.slice(0, 90).replace(/\n/g, ' / ')}`)
}
console.log(`errors: ${errors.length}`, errors.slice(0, 5))
await browser.close()
