'use client'

import * as React from 'react'
import { Share, PlusSquare, X } from 'lucide-react'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        'fixed inset-0 isolate z-50 bg-black/60 backdrop-blur-sm duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  ...props
}: DialogPrimitive.Popup.Props) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          'fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-3xl border border-border bg-card p-6 text-foreground shadow-2xl duration-100 outline-none sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
          className
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          data-slot="dialog-close"
          aria-label="Tutup"
          className="absolute top-4 right-4 flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
        >
          <X className="size-4" aria-hidden="true" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-header"
      className={cn('flex flex-col gap-1.5', className)}
      {...props}
    />
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('font-serif text-lg text-foreground', className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-xs text-muted-foreground', className)}
      {...props}
    />
  )
}

interface IosInstallDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function IosInstallDialog({ open, onOpenChange }: IosInstallDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-3xl border-border bg-card p-6 text-foreground">
        <DialogHeader className="text-left">
          <DialogTitle className="font-serif text-lg text-foreground">
            Pasang di Layar Utama iPhone/iPad
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Buka Lakoku langsung dari layar utama tanpa bilah navigasi Safari.
          </DialogDescription>
        </DialogHeader>

        <div className="my-3 space-y-4 text-xs text-foreground">
          <div className="flex items-start gap-3 rounded-2xl bg-secondary/60 p-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-background text-primary">
              <Share className="size-4" aria-hidden="true" />
            </span>
            <div>
              <p className="font-semibold text-foreground">1. Ketuk tombol Bagikan</p>
              <p className="mt-0.5 text-muted-foreground">
                Tombol panah ke atas di bilah menu bawah Safari.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-2xl bg-secondary/60 p-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-background text-primary">
              <PlusSquare className="size-4" aria-hidden="true" />
            </span>
            <div>
              <p className="font-semibold text-foreground">2. Tambah ke Layar Utama</p>
              <p className="mt-0.5 text-muted-foreground">
                Gulir ke bawah menu dan ketuk <strong>Tambah ke Layar Utama</strong> (Add to Home Screen).
              </p>
            </div>
          </div>
        </div>

        <Button
          type="button"
          onClick={() => onOpenChange(false)}
          className="w-full rounded-2xl bg-primary text-xs font-semibold text-primary-foreground hover:bg-primary/90"
        >
          Mengerti
        </Button>
      </DialogContent>
    </Dialog>
  )
}
