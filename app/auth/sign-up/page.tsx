import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/api/user-state'
import { sanitizeNextPath } from '@/lib/auth/safe-next'
import { isGoogleAuthEnabled } from '@/lib/auth/google-availability'
import { mapOAuthErrorMessage } from '@/lib/auth/oauth-error'
import { SignUpForm } from './sign-up-form'

export default async function SignUpPage({
  searchParams,
}: {
  searchParams?: Promise<{ next?: string; error?: string }>
}) {
  const { next, error } = (await searchParams) ?? {}
  const user = await getSessionUser()
  if (user) {
    redirect(sanitizeNextPath(next))
  }

  return (
    <SignUpForm
      nextPath={sanitizeNextPath(next)}
      googleEnabled={isGoogleAuthEnabled()}
      oauthError={mapOAuthErrorMessage(error)}
    />
  )
}

export const dynamic = 'force-dynamic'
