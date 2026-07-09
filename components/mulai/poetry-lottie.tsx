'use client'

import { useMemo } from 'react'
import Lottie from 'lottie-react'
import { useTheme } from 'next-themes'
import poetryAnimation from '@/public/lottie/poetry.json'

interface PoetryLottieProps {
  className?: string
}

/** Warna asli di Poetry.json (r,g,b 0–1). */
const ORIG = {
  purple: '0.3059,0.2275,0.5098',
  slate: '0.2392,0.2824,0.3255',
  scrabble: '0.7164,0.7116,0.7284',
  paper1: '0.8473,0.8306,0.8894',
  paper2: '0.9536,0.9452,0.9748',
  paper3: '0.8909,0.8790,0.9210',
} as const

function hexToLottie(hex: string): [number, number, number] {
  const n = hex.replace('#', '')
  return [
    parseInt(n.slice(0, 2), 16) / 255,
    parseInt(n.slice(2, 4), 16) / 255,
    parseInt(n.slice(4, 6), 16) / 255,
  ]
}

function colorKey(rgb: number[]): string {
  return rgb
    .slice(0, 3)
    .map((n) => Number(n).toFixed(4))
    .join(',')
}

/**
 * Light: tinta gelap + primary di atas cream.
 * Dark: tinta cream + primary di atas midnight, kertas tetap parchment.
 */
const THEME_MAP = {
  light: {
    [ORIG.purple]: hexToLottie('#c94967'),
    [ORIG.slate]: hexToLottie('#2b2130'),
    [ORIG.scrabble]: hexToLottie('#7d6f80'),
    [ORIG.paper1]: hexToLottie('#e6d5c0'),
    [ORIG.paper2]: hexToLottie('#f4e8d8'),
    [ORIG.paper3]: hexToLottie('#ecdcc8'),
  },
  dark: {
    [ORIG.purple]: hexToLottie('#e06b85'),
    [ORIG.slate]: hexToLottie('#fff7ee'),
    [ORIG.scrabble]: hexToLottie('#96899a'),
    [ORIG.paper1]: hexToLottie('#f0e0cc'),
    [ORIG.paper2]: hexToLottie('#fff7ee'),
    [ORIG.paper3]: hexToLottie('#f5e6d4'),
  },
} as const

type ShapeNode = {
  ty?: string
  c?: { k?: number[] }
  it?: ShapeNode[]
  shapes?: ShapeNode[]
}

type LottieLayer = { shapes?: ShapeNode[] }
type LottieAsset = { layers?: LottieLayer[] }
type LottieData = {
  layers?: LottieLayer[]
  assets?: LottieAsset[]
}

function recolorShapes(
  shapes: ShapeNode[] | undefined,
  map: Record<string, readonly [number, number, number]>,
) {
  for (const shape of shapes ?? []) {
    if ((shape.ty === 'fl' || shape.ty === 'st') && Array.isArray(shape.c?.k) && typeof shape.c.k[0] === 'number') {
      const next = map[colorKey(shape.c.k)]
      if (next) {
        const alpha = shape.c.k[3] ?? 1
        shape.c.k = [next[0], next[1], next[2], alpha]
      }
    }
    if (shape.it) recolorShapes(shape.it, map)
    if (shape.shapes) recolorShapes(shape.shapes, map)
  }
}

function recolorAnimation(
  source: LottieData,
  mode: 'light' | 'dark',
): LottieData {
  const clone = JSON.parse(JSON.stringify(source)) as LottieData
  const map = THEME_MAP[mode]
  for (const layer of clone.layers ?? []) recolorShapes(layer.shapes, map)
  for (const asset of clone.assets ?? []) {
    for (const layer of asset.layers ?? []) recolorShapes(layer.shapes, map)
  }
  return clone
}

/** Animasi quill/parchment untuk layar "sedang disiapkan". */
export function PoetryLottie({ className }: PoetryLottieProps) {
  const { resolvedTheme } = useTheme()
  const mode = resolvedTheme === 'light' ? 'light' : 'dark'

  const animationData = useMemo(
    () => recolorAnimation(poetryAnimation as LottieData, mode),
    [mode],
  )

  return (
    <div className={className} aria-hidden="true" role="presentation">
      <Lottie
        key={mode}
        animationData={animationData}
        loop
        autoplay
        rendererSettings={{
          preserveAspectRatio: 'xMidYMid meet',
        }}
        className="h-full w-full bg-transparent"
      />
    </div>
  )
}
