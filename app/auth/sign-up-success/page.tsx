import Link from 'next/link'
import { MailCheck } from 'lucide-react'

export default function SignUpSuccessPage() {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col items-center justify-center bg-background px-6 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-primary/15">
        <MailCheck className="size-7 text-primary" />
      </div>
      <h1 className="mt-6 font-serif text-2xl font-bold text-foreground text-balance">
        Satu langkah lagi
      </h1>
      <p className="mt-3 max-w-xs text-sm leading-relaxed text-muted-foreground text-pretty">
        Kami sudah mengirim tautan konfirmasi ke emailmu. Buka tautannya, lalu ceritamu siap
        dimulai.
      </p>
      <Link
        href="/beranda"
        className="mt-8 flex min-h-13 w-full items-center justify-center rounded-2xl border border-border px-6 text-sm font-semibold text-foreground transition-colors hover:bg-card"
      >
        Kembali ke Beranda
      </Link>
    </main>
  )
}

export const dynamic = 'force-dynamic';
