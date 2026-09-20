import { headers } from 'next/headers'

import { channelFromUserAgent, type AppChannel } from './channel'

/** Baca kanal dari request headers (server components / route handlers). */
export async function getRequestChannel(): Promise<AppChannel> {
  const h = await headers()
  return channelFromUserAgent(h.get('user-agent'))
}
