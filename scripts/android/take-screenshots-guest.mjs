#!/usr/bin/env node
/** Screenshot tamu (tanpa login): signup + landing/login tablet. */
import { chromium } from 'playwright'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const BASE = 'http://localhost:3000'
const shots = [
  { name: 'phone-4-signup', url: '/auth/sign-up', w: 1080, h: 1920 },
  { name: 'tablet7-1-landing', url: '/', w: 1200, h: 1920 },
  { name: 'tablet7-2-login', url: '/auth/login', w: 1200, h: 1920 },
  { name: 'tablet10-1-landing', url: '/', w: 1600, h: 2560 },
  { name: 'tablet10-2-signup', url: '/auth/sign-up', w: 1600, h: 2560 },
]

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })
for (const s of shots) {
  const page = await browser.newPage({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 2 })
  try {
    await page.goto(BASE + s.url, { waitUntil: 'networkidle', timeout: 45000 })
    await page.waitForTimeout(2500)
    await page.screenshot({ path: `store-assets/screenshots/${s.name}.png` })
    console.log(`  ok   ${s.name}`)
  } catch (err) {
    console.error(`  FAIL ${s.name}: ${err.message.split('\n')[0]}`)
  }
  await page.close()
}
await browser.close()
console.log('guest shots done')
