import 'server-only'
import sharp from 'sharp'

/**
 * Normalisasi sampul: potret 2:3, WebP terkompresi.
 *
 * Dua alasan langkah ini wajib, bukan hiasan:
 *   1. next.config.mjs memakai `images.unoptimized: true`, jadi Next TIDAK
 *      akan mengecilkan apa pun. Slot tampilnya 448px; tanpa kompresi
 *      pembaca mengunduh gambar penuh ~900KB untuk ruang 448px.
 *   2. Re-encode membuang metadata EXIF, tempat koordinat GPS ikut menempel
 *      pada foto dari ponsel yang diunggah pengguna.
 */

/** Lebar akhir; 2:3 pada 832x1248 cukup tajam untuk layar mobile 448px. */
const TARGET_WIDTH = 832
const TARGET_HEIGHT = 1248
const WEBP_QUALITY = 82

export type NormalizedCover = { data: Buffer; width: number; height: number; bytes: number }

/**
 * Ubah byte gambar apa pun jadi WebP potret.
 *
 * ARTWORK TIDAK PERNAH DIPOTONG. Penyedia gambar sering mengabaikan rasio
 * yang diminta; memaksa 2:3 dengan `fit: 'cover'` terbukti memenggal teks
 * judul yang digambar di tepi poster (kasus nyata: lima sampul katalog
 * rusak, 2026-10-31). Strateginya dua lapis:
 *
 *   1. Latar 2:3 dari gambar yang sama (cover-fit), dikaburkan dan
 *      digelapkan — rasio input apa pun menghasilkan kanvas penuh yang
 *      terasa menyatu, bukan pita kosong.
 *   2. Artwork utuh di depan dengan `fit: 'contain'` — judul selamat
 *      apa pun bentuk keluaran penyedia.
 *
 * Untuk input yang sudah 2:3, latar tidak pernah terlihat (contain
 * mengisi penuh) — perilaku identik dengan crop biasa.
 *
 * Melempar bila input bukan gambar yang bisa dibaca — pemanggil menangkapnya
 * dan menjawab pengguna dengan bahasa manusia.
 */
export async function normalizeCoverImage(input: Buffer): Promise<NormalizedCover> {
  const source = sharp(input, { failOn: 'error' }).rotate() // hormati orientasi EXIF sebelum metadata dibuang

  const background = await source
    .clone()
    .resize(TARGET_WIDTH, TARGET_HEIGHT, { fit: 'cover', position: 'attention' })
    .blur(40)
    .modulate({ brightness: 0.8, saturation: 1.05 })
    .png()
    .toBuffer()

  const foreground = await source
    .clone()
    .resize(TARGET_WIDTH, TARGET_HEIGHT, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer()

  const data = await sharp(background)
    .composite([{ input: foreground }])
    .webp({ quality: WEBP_QUALITY })
    .toBuffer()

  return { data, width: TARGET_WIDTH, height: TARGET_HEIGHT, bytes: data.byteLength }
}

/**
 * Deteksi format lewat magic byte, bukan Content-Type atau ekstensi.
 *
 * Header yang dikirim klien adalah klaim, bukan bukti; file berbahaya paling
 * mudah masuk dengan menyebut dirinya image/png.
 */
export function sniffImageFormat(input: Buffer): 'jpeg' | 'png' | 'webp' | null {
  if (input.byteLength < 12) return null

  // JPEG: FF D8 FF
  if (input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff) return 'jpeg'

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (pngSignature.every((byte, index) => input[index] === byte)) return 'png'

  // WebP: 'RIFF' .... 'WEBP'
  if (input.toString('ascii', 0, 4) === 'RIFF' && input.toString('ascii', 8, 12) === 'WEBP') {
    return 'webp'
  }

  return null
}
