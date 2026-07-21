import Link from 'next/link'

function publicErrorMessage(raw: string | undefined): string {
  if (!raw) {
    return 'Tautan masuk tidak valid atau sudah kedaluwarsa. Coba masuk kembali.'
  }
  const lower = raw.toLowerCase()
  if (lower.includes('access_denied') || lower.includes('denied')) {
    return 'Login Google dibatalkan. Kamu bisa coba lagi kapan saja.'
  }
  if (lower.includes('missing_code')) {
    return 'Kode login tidak diterima. Coba masuk dengan Google sekali lagi.'
  }
  if (
    lower.includes('code verifier') ||
    lower.includes('pkce') ||
    lower.includes('both auth code and code verifier')
  ) {
    return 'Sesi login Google tidak lengkap (cookie). Coba lagi dari halaman masuk, atau nonaktifkan pemblokir cookie untuk situs ini.'
  }
  if (lower.includes('expired') || lower.includes('invalid')) {
    return 'Tautan masuk tidak valid atau sudah kedaluwarsa. Coba masuk kembali.'
  }
  // Generic fallback — still show a short technical hint for support.
  return `Login gagal. Coba masuk kembali. (${raw.slice(0, 80)})`
}

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const params = await searchParams
  const message = publicErrorMessage(params.error)

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col items-center justify-center bg-background px-6 text-center">
      <h1 className="font-serif text-2xl font-bold text-foreground text-balance">
        Ada yang tidak beres
      </h1>
      <p className="mt-3 max-w-xs text-sm leading-relaxed text-muted-foreground text-pretty">
        {message}
      </p>
      <Link
        href="/auth/login"
        className="mt-8 flex min-h-13 w-full items-center justify-center rounded-2xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
      >
        Ke Halaman Masuk
      </Link>
    </main>
  )
}

export const dynamic = 'force-dynamic'
