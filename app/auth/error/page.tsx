import Link from 'next/link'

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  await searchParams
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col items-center justify-center bg-background px-6 text-center">
      <h1 className="font-serif text-2xl font-bold text-foreground text-balance">
        Ada yang tidak beres
      </h1>
      <p className="mt-3 max-w-xs text-sm leading-relaxed text-muted-foreground text-pretty">
        Tautan masuk tidak valid atau sudah kedaluwarsa. Coba masuk kembali.
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


export const runtime = 'edge';
