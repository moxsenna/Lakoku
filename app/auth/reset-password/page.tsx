import { Suspense } from 'react'
import { ResetPasswordForm } from './reset-password-form'

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>
}) {
  const { token, error } = await searchParams
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm initialToken={token} initialError={error} />
    </Suspense>
  )
}

export const dynamic = 'force-dynamic'
