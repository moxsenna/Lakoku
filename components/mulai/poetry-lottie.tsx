'use client'

import Lottie from 'lottie-react'
import poetryAnimation from '@/public/lottie/poetry.json'

interface PoetryLottieProps {
  className?: string
}

/** Animasi quill/parchment untuk layar "sedang disiapkan". */
export function PoetryLottie({ className }: PoetryLottieProps) {
  return (
    <div className={className} aria-hidden="true" role="presentation">
      <Lottie
        animationData={poetryAnimation}
        loop
        autoplay
        className="h-full w-full"
      />
    </div>
  )
}
