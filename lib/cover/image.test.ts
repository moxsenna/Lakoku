import { describe, expect, it, vi } from 'vitest'
import { sniffImageFormat } from './image'

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
