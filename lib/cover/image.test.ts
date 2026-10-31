import { describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { normalizeCoverImage, sniffImageFormat } from './image'

vi.mock('server-only', () => ({}))

function jpegBytes(): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01])
}

function pngBytes(): Buffer {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d])
}

function webpBytes(): Buffer {
  return Buffer.concat([Buffer.from('RIFF', 'ascii'), Buffer.alloc(4), Buffer.from('WEBP', 'ascii'), Buffer.alloc(4)])
}

describe('sniffImageFormat', () => {
  it('mengenali JPEG dari magic byte, bukan klaim header', () => {
    expect(sniffImageFormat(jpegBytes())).toBe('jpeg')
  })

  it('mengenali PNG', () => {
    expect(sniffImageFormat(pngBytes())).toBe('png')
  })

  it('mengenali WebP', () => {
    expect(sniffImageFormat(webpBytes())).toBe('webp')
  })

  it('menolak file yang mengaku gambar tapi bukan', () => {
    expect(sniffImageFormat(Buffer.from('<html><body>hi</body></html>'))).toBeNull()
    expect(sniffImageFormat(Buffer.from('%PDF-1.4 fake pdf here!!'))).toBeNull()
  })

  it('menolak input terlalu pendek', () => {
    expect(sniffImageFormat(Buffer.from([0xff, 0xd8]))).toBeNull()
  })
})

describe('normalizeCoverImage', () => {
  /**
   * Gambar uji lebar 2:1 dengan penanda di TEPI: pita merah di kiri dan
   * biru di kanan (masing-masing 10% lebar), tengah putih. Kalau ada
   * pemotongan, salah satu pita tepi pasti hilang.
   */
  async function wideTestImage(): Promise<Buffer> {
    const stripe = async (color: { r: number; g: number; b: number }) =>
      sharp({
        create: { width: 60, height: 300, channels: 3, background: color },
      })
        .png()
        .toBuffer()
    return sharp({
      create: { width: 600, height: 300, channels: 3, background: { r: 240, g: 240, b: 240 } },
    })
      .composite([
        { input: await stripe({ r: 200, g: 30, b: 30 }), left: 0, top: 0 },
        { input: await stripe({ r: 30, g: 30, b: 200 }), left: 540, top: 0 },
      ])
      .png()
      .toBuffer()
  }

  /** Ambil satu piksel dari WebP hasil normalize. */
  async function pixelOf(webp: Buffer, x: number, y: number): Promise<{ r: number; g: number; b: number }> {
    const { data, info } = await sharp(webp).raw().toBuffer({ resolveWithObject: true })
    const offset = (y * info.width + x) * info.channels
    return { r: data[offset], g: data[offset + 1], b: data[offset + 2] }
  }

  it('selalu menghasilkan kanvas 2:3 apa pun rasio input', async () => {
    const result = await normalizeCoverImage(await wideTestImage())
    expect(result.width).toBe(832)
    expect(result.height).toBe(1248)
  })

  it('tidak memotong artwork: kedua sisi gambar lebar tetap terlihat', async () => {
    const result = await normalizeCoverImage(await wideTestImage())
    // Artwork 2:1 di-contain ke 832x416, menempel di tengah vertikal
    // (y sekitar 416-832). Baris tengah harus memuat merah DAN biru —
    // kalau ada yang ter-crop, salah satu warna hilang.
    const left = await pixelOf(result.data, 10, 624)
    const right = await pixelOf(result.data, 820, 624)
    expect(left.r).toBeGreaterThan(150)
    expect(left.b).toBeLessThan(100)
    expect(right.b).toBeGreaterThan(150)
    expect(right.r).toBeLessThan(100)
  })

  it('hasilnya WebP yang bisa dikenali sniffImageFormat', async () => {
    const result = await normalizeCoverImage(await wideTestImage())
    expect(sniffImageFormat(result.data)).toBe('webp')
    expect(result.bytes).toBeGreaterThan(0)
  })
})
