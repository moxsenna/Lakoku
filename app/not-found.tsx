import Link from 'next/link'
import { Compass, Home } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Compass className="h-7 w-7" />
      </div>
      <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">
        Halaman Ini Tidak Ditemukan
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Tautan yang kamu buka sudah tidak ada atau salah alamat. Ceritamu tidak ke mana-mana —
        kembali dan lanjutkan dari sana.
      </p>
      <div className="mt-6 flex w-full flex-col gap-3">
        <Link href="/beranda" className={cn(buttonVariants(), 'w-full gap-2')}>
          <Home className="h-4 w-4" />
          Kembali ke Beranda
        </Link>
        <Link href="/" className={cn(buttonVariants({ variant: 'outline' }), 'w-full gap-2')}>
          <Compass className="h-4 w-4" />
          Jelajahi Cerita
        </Link>
      </div>
    </main>
  )
}
