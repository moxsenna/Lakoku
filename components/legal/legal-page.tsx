import Link from 'next/link'
import type { ReactNode } from 'react'

export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string
  updated: string
  children: ReactNode
}) {
  return (
    <main className="mx-auto min-h-svh w-full max-w-2xl bg-background px-6 py-10">
      <Link
        href="/"
        className="text-sm font-semibold text-primary transition-opacity hover:opacity-90"
      >
        ← Lakoku
      </Link>

      <h1 className="mt-8 font-serif text-3xl font-bold text-foreground text-balance">
        {title}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">Terakhir diperbarui: {updated}</p>

      <div className="mt-8 space-y-6 text-sm leading-relaxed text-muted-foreground [&_h2]:mt-8 [&_h2]:font-serif [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-foreground [&_p]:text-pretty [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5 [&_a]:font-semibold [&_a]:text-primary">
        {children}
      </div>

      <p className="mt-12 border-t border-border pt-6 text-xs text-muted-foreground">
        <Link href="/privacy" className="font-semibold text-primary">
          Kebijakan Privasi
        </Link>
        {' · '}
        <Link href="/terms" className="font-semibold text-primary">
          Syarat Layanan
        </Link>
        {' · '}
        <Link href="/auth/login" className="font-semibold text-primary">
          Masuk
        </Link>
      </p>
    </main>
  )
}
