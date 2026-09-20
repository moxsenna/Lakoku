import { NextResponse } from 'next/server'

/**
 * Konfigurasi publik Firebase untuk web push (bukan secret — sama seperti
 * NEXT_PUBLIC_* lain). Service worker + prompt mengambil dari sini agar
 * tidak ada config yang di-hardcode. 503 bila belum dikonfigurasi: client
 * tetap diam (fitur nonaktif dengan jujur).
 */
export async function GET(): Promise<Response> {
  const config = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  }
  const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY
  if (!config.apiKey || !config.projectId || !config.messagingSenderId || !config.appId || !vapidKey) {
    return NextResponse.json({ ok: false }, { status: 503 })
  }
  return NextResponse.json({ ok: true, config, vapidKey })
}

export const dynamic = 'force-dynamic'
