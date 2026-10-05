import { createAuthClient } from 'better-auth/react'

const rawAuthClient = createAuthClient({
  baseURL: typeof window !== 'undefined' ? window.location.origin : (process.env.NEXT_PUBLIC_SITE_URL || 'https://lakoku.biz.id'),
})

export const authClient = Object.assign(rawAuthClient, {
  forgetPassword: (args: { email: string; redirectTo?: string }) =>
    rawAuthClient.requestPasswordReset(args),
})
