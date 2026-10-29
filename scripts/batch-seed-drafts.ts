import { readFileSync } from 'node:fs'

function loadEnv(): void {
  for (const name of ['.env.local', '.env']) {
    try {
      const raw = readFileSync(name, 'utf8')
      for (const line of raw.split('\n')) {
        const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*['"]?(.*?)['"]?\s*$/)
        if (match?.[1] && match[2] !== undefined && !process.env[match[1]]) {
          process.env[match[1]] = match[2]
        }
      }
    } catch { /* file tidak ada */ }
  }
}
loadEnv()

import { createCatalogDraft, createDbCatalogWriter } from '@/lib/catalog/generator-db.server'
import { createDeterministicProvider, DEFAULT_RUNTIME_POLICY } from '@lakoku/ai-gateway'
import { createProviderFromExactRoutes } from '@lakoku/ai-gateway/server'
import { toAiModelRoute, assertM10GG1RouteAuthority } from '../lib/narrative-qa/contracts/m10-g-g1-route-authority.contract'
import { M10_G_G1_9ROUTER_ROUTE_AUTHORITY } from '../fixtures/m10-g/g1-route-authority-9router'

interface StorySeed {
  slug: string
  title: string
  tagline: string
  synopsis: string
  protagonist: string
  genre: string
  tropes: string[]
}

const STORIES: StorySeed[] = [
  // family_drama (4)
  { slug: 'warisan-untuk-pembantu', title: 'Warisan untuk Pembantu', tagline: 'Harta keluarga dibagi, tapi namaku tidak ada di dalamnya.', synopsis: 'Sejak kecil Rara disuruh melayani kakak tirinya di rumah sendiri. Ayah selalu bilang Rara tidak berhak atas apa pun karena ibunya sudah lama pergi. Saat ayah meninggal dan surat wasiat dibacakan, ternyata seluruh harta jatuh ke tangan pembantu rumah yang lebih dianggap anak daripada Rara sendiri. Tapi Rara punya bukti bahwa wasiat itu palsu, dan dia akan membuktikannya di pengadilan.', protagonist: 'Rara', genre: 'family_drama', tropes: ['Rahasia Keluarga', 'Anak Tiri', 'Warisan'] },
  { slug: 'aku-anak-yang-dibuang', title: 'Aku Anak yang Dibuang', tagline: 'Mereka bilang aku sial. Mereka tidak tahu sial itu menular.', synopsis: 'Dari lahir, Galih dianggap pembawa sial karena ibunya meninggal saat melahirkannya. Ayah menikah lagi dan anak baru jadi pusat perhatian. Galih disuruh keluar rumah saat umur 17 tahun dengan hanya bawa satu tas. Lima tahun kemudian dia pulang dengan perusahaan yang lebih besar dari semua aset keluarganya. Ayah menangis memohon kembali, tapi Galih hanya bilang satu kata: tidak.', protagonist: 'Galih', genre: 'family_drama', tropes: ['Anak Dibuang', 'Kesuksesan Diam-diam', 'Pembalasan'] },
  { slug: 'kaka-adopsi-adik-kandung', title: 'Kaka Adopsi, Adik Kandung', tagline: 'Yang kandung disingkirkan, yang diadopsi dimanjakan.', synopsis: 'Keluarga Ardi mengadopsi Bayu saat Bayu umur 5 tahun. Sejak itu, Ardianto sang anak kandung selalu kedua. Sekolah, mobil, bahkan jodoh, semua yang terbaik diberikan ke Bayu. Saat Ardianto menemukan bahwa Bayu sebenarnya anak kandung dari perselingkuhan ibunya sendiri, dia sadar permainan itu sudah berjalan sejak 20 tahun lalu.', protagonist: 'Ardianto', genre: 'family_drama', tropes: ['Anak Adopsi', 'Perselingkuhan', 'Rahasia Keluarga'] },
  { slug: 'rahasia-kamar-tidur-ayah', title: 'Rahasia Kamar Tidur Ayah', tagline: 'Pintu itu selalu terkunci. Sampai malam kunci itu ada di tanganku.', synopsis: 'Setelah ibu meninggal, ayah mengunci kamar utama dan tidak pernah membukanya lagi. Lima tahun kemudian, Dinta menemukan kunci itu tergeletak di lantai lorong. Apa yang dia lihat di dalam kamar itu mengubah seluruh cerita tentang keluarganya yang selama ini dia kira sempurna.', protagonist: 'Dinta', genre: 'family_drama', tropes: ['Rahasia Keluarga', 'Kamar Terkunci', 'Pengkhianatan'] },

  // romance (4)
  { slug: 'kontrak-nikah-30-hari', title: 'Kontrak Nikah 30 Hari', tagline: 'Tiga puluh hari. Satu atap. Nol perasaan. Itu kesepakatannya.', synopsis: 'Sasha butuh status menikah untuk klaim warisan nenek. Raka butuh istri untuk menyelamatkan citra perusahaannya yang sedang dalam skandal. Mereka sepakat menikah 30 hari, tanpa cinta, tanpa sentuhan, tanpa rasa. Tapi aturan pertama yang mereka buat bersama adalah aturan pertama yang dilanggar.', protagonist: 'Sasha', genre: 'romance', tropes: ['Pernikahan Kontrak', 'CEO Dingin', 'Second Chance'] },
  { slug: 'cerai-di-meja-sah', title: 'Cerai di Meja Sah', tagline: 'Kata cerai sudah sah. Tapi kenapa dadaku masih menunggu dia pulang?', synopsis: 'Nadia dan Fadhil menikah lima tahun tanpa anak. Ibunya Fadhil terus menekan, dan Fadhil memilih diam. Hari ketika talak dijatuhkan di pengadilan agama, Nadia berjalan keluar dengan kepala tegak. Tiga bulan kemudian, dia bertemu Fadhil lagi di tempat yang tidak pernah dia duga: kamar rawat inap, dengan Fadhil yang lupa semuanya karena amnesia.', protagonist: 'Nadia', genre: 'romance', tropes: ['Cerai', 'Amnesia', 'Second Chance'] },
  { slug: 'suamiku-bosku', title: 'Suamiku Bosku', tagline: 'Di kantor dia boss yang ditakuti. Di rumah dia suami yang tidak pernah kuliahi.', synopsis: 'Nikahnya rahasia. Di kantor, Arya adalah CEO yang dingin dan tidak kenal ampun. Di rumah, dia suami yang belum pernah makan masakan istrinya. Karena Nadine dipindah ke divisi yang dipimpin langsung oleh Arya, dan aturan kantor melarang hubungan pribadi di antara atasan-bawahan, mereka harus berpura-pura tidak kenal satu sama lain setiap hari.', protagonist: 'Nadine', genre: 'romance', tropes: ['Office Romance', 'Rahasia Menikah', 'CEO Dingin'] },
  { slug: 'jodoh-dari-surat-lama', title: 'Jodoh dari Surat Lama', tagline: 'Nenek meninggalkan surat, bukan warisan. Isinya nama seorang lelaki.', synopsis: 'Setelah nenek meninggal, Salsabila menemukan surat tua di balik Al-Quran. Isinya perjanjian jodoh antara neneknya dan sahabat nenek 40 tahun lalu, dengan nama lelaki yang kini sudah jadi dosen muda di kampusnya. Tapi lelaki itu sudah punya kekasih, dan dia tidak percaya pada jodoh yang dijodohkan.', protagonist: 'Salsabila', genre: 'romance', tropes: ['Jodoh', 'Surat Lama', 'Kampus'] },

  // mystery (3)
  { slug: 'buku-tamu-yang-tak-pernah-pergi', title: 'Buku Tamu yang Tak Pernah Pergi', tagline: 'Namanya selalu muncul di buku tamu, meski dia sudah meninggal tiga tahun lalu.', synopsis: 'Resepsionis baru di Hotel CendanaRawa menemukan kejanggalan: nama seorang tamu muncul di buku tamu setiap bulan, meskipun orang itu sudah meninggal tiga tahun lalu. Saat dia melacak alamat yang tercatat, yang dia temukan adalah kamar kosong dengan lukisan seorang wanita yang wajahnya mirip dirinya sendiri.', protagonist: 'Laras', genre: 'mystery', tropes: ['Hotel Misterius', 'Identitas Ganda', 'Masa Lalu Tersembunyi'] },
  { slug: 'kunci-di-bawah-lantai', title: 'Kunci di Bawah Lantai', tagline: 'Rumah warisan dari nenek, dengan satu papan lantai yang bunyi berbeda.', synopsis: 'Mahesa mewarisi rumah tua neneknya di kampung. Saat merenovasi, dia menemukan satu papan lantai yang berbunyi hampa. Di bawahnya ada kotak besi berisi kunci berbeda, foto keluarga yang tidak dikenalinya, dan surat perjanjian yang menyebut nama ayahnya sebagai pihak yang berutang nyawa.', protagonist: 'Mahesa', genre: 'mystery', tropes: ['Rumah Warisan', 'Surat Perjanjian', 'Rahasia Nenek'] },
  { slug: 'surat-dari-yang-telah-tiada', title: 'Surat dari Yang Telah Tiada', tagline: 'Amplop itu bertuliskan namaku, dicap tiga hari lalu. Pengirimnya meninggal lima tahun silam.', synopsis: 'Setiap bulan, Kirana menerima surat dari alamat yang sama. Tulisan tangannya persis seperti tulisan ibunya yang meninggal lima tahun lalu. Isinya peringatan: jangan percaya siapa pun yang tinggal di lantai tiga. Saat Kirana akhirnya melacak alamat pengirim, yang dia temukan adalah orang yang wajahnya persis seperti ibunya.', protagonist: 'Kirana', genre: 'mystery', tropes: ['Surat Misterius', 'Identitas Ganda', 'Rahasia Ibu'] },

  // fantasy_kingdom (3)
  { slug: 'putri-buangan-takhta', title: 'Putri Buangan Takhta', tagline: 'Mereka buang aku ke perbatasan. Mereka tidak tahu ramalan itu tentangku.', synopsis: 'Putri Kalista dibuang ke desa perbatasan karena dianggap membawa petaka. Sebelas tahun kemudian, kerajaan dikepung pasukan bayangan yang hanya bisa dikalahkan oleh pembawa ramalan. Dan ramalan itu, yang selama ini dianggap tentang pangeran pertama, ternyata menyebut nama sang putri buangan.', protagonist: 'Kalista', genre: 'fantasy_kingdom', tropes: ['Putri Buangan', 'Ramalan', 'Pengkhianatan Takhta'] },
  { slug: 'prahara-pedang-selatan', title: 'Prahara Pedang Selatan', tagline: 'Aku dibuang dari perguruan. Mereka pikir aku tidak bisa berbuat apa-apa.', synopsis: 'Satria diusir dari Perguruan Pedang Utara karena dituduh mencuri kitab pamungkas. Tanpa nama, tanpa gelar, dia membangun kelompok kecil di hutan selatan. Lima tahun kemudian, perguruan yang membuangnya meminta bantuan. Musuh yang mereka takutkan justru berasal dari kegelapan yang mereka ciptakan sendiri.', protagonist: 'Satria', genre: 'fantasy_kingdom', tropes: ['Perguruan Silat', 'Dibuang', 'Kebangkitan'] },
  { slug: 'mahkota-retak', title: 'Mahkota Retak', tagline: 'Pangeran pertama mendapat takhta. Aku mendapat pilihan: diam atau bicara.', synopsis: 'Pangeran Bagas tahu kaka kandungnya membunuh ayahanda untuk merebut mahkota. Tapi mengungkapkannya berarti perang saudara dan ribuan rakyat mati. Diam berarti menyerahkan kerajaan ke tangan pembunuh. Saat satu-satunya saksi masih hidup muncul dari pengasingan, Bagas harus memilih antara darah dan keadilan.', protagonist: 'Bagas', genre: 'fantasy_kingdom', tropes: ['Intrik Takhta', 'Pembunuhan Raja', 'Pilihan Moral'] },

  // slice_of_life (3)
  { slug: 'warung-sate-pak-man', title: 'Warung Sate Pak Man', tagline: 'Ayah bilang warung ini cukup. Aku bilang warung ini belum selesai bercerita.', synopsis: 'Setelah bos di Jakarta menolak promosinya untuk ketiga kalinya, Damar pulang ke kampung dan mengambil alih warung sate ayah yang sekarat. Dari dapur sempit itu, dia belajar bahwa rezeki tidak selalu soal karier, dan pelanggan yang datang membawa cerita yang lebih berharga dari gaji bulanan.', protagonist: 'Damar', genre: 'slice_of_life', tropes: ['Pulang Kampung', 'Warung Keluarga', 'Cerita Hidup'] },
  { slug: 'rumah-kontrakan-nomor-7', title: 'Rumah Kontrakan Nomor 7', tagline: 'Enam kamar, enam cerita, satu pintu yang selalu terbuka.', synopsis: 'Rumah kontrakan tua dengan enam kamar dihuni enam orang asing yang saling tidak kenal. Ada mahasiswa yang tidak pulang-pulang, janda muda yang selalu tutup pintu, driver online yang tidur siang, dan pemilik rumah yang jarang terlihat. Sampai satu malam, keran air di kamar nomor 7 tumpah dan semua rahasia mulai mengalir keluar.', protagonist: 'Yuni', genre: 'slice_of_life', tropes: ['Rumah Kontrakan', 'Tetangga', 'Cerita Keseharian'] },
  { slug: 'resign-dari-lantai-21', title: 'Resign dari Lantai 21', tagline: 'Aku taruh surat resign di meja boss. Lalu kubeli mesin sangrai kopi.', synopsis: 'Delapan tahun bekerja di korporat tidak pernah membuat Sekar bahagia. Hari ketika surat resign diterima, dia buka kedai kopi kecil di sudut gang dengan tabungan yang habis separuh. Pelanggan pertamanya adalah mantan boss yang kini duduk di kursi plastik dengan wajah pucat.', protagonist: 'Sekar', genre: 'slice_of_life', tropes: ['Resign', 'Kedai Kopi', 'Kehidupan Baru'] },

  // survival_thriller (3)
  { slug: 'pulau-tanpa-peta', title: 'Pulau Tanpa Peta', tagline: 'Kapal kita karam. Peta kita hilang. Dan pulau ini tidak ada di peta mana pun.', synopsis: 'Grup turis 12 orang terdampar di pulau yang tidak tercatat di peta navigasi mana pun. Tidak ada sinyal. Tidak ada perahu. Yang ada hanya hutan lebat, gua yang berpendar, dan jejak kaki yang bukan milik mereka. Satu per satu, anggota grup mulai hilang. Yang tersisa harus memilih: menunggu tolong atau mencari jalan keluar sendiri.', protagonist: 'Reza', genre: 'survival_thriller', tropes: ['Pulau Terpencil', 'Bertahan Hidup', 'Tanda Tanya'] },
  { slug: '70-lantai-ke-bawah', title: '70 Lantai ke Bawah', tagline: 'Lift berhenti di lantai B7. Pintu tidak mau terbuka. Lampu mati.', synopsis: 'Saat gempa mengguncang gedung 70 lantai, lima orang terjebak di basement tujuh. Listrik padam, air mulai masuk, dan satu-satunya jalan keluar terhalang reruntuhan. Tapi yang lebih menakutkan dari reruntuhan adalah kenyataan bahwa salah satu dari mereka sebenarnya tahu mengapa gempa itu terjadi.', protagonist: 'Vina', genre: 'survival_thriller', tropes: ['Terjebak', 'Gempa', 'Pengkhianatan'] },
  { slug: 'sinyal-terakhir', title: 'Sinyal Terakhir', tagline: 'Satu bar sinyal. Satu pesan terakhir. Dan waktu yang tinggal 24 jam.', synopsis: 'Dua puluh empat orang dibangunkan di ruangan tertutup tanpa ingatan bagaimana mereka sampai di sana. Di ponsel masing-masing ada satu aplikasi: hitungan mundur 24 jam dan satu bar sinyal yang terus melemah. Aturannya sederhana: sebelum sinyal habis, satu orang harus keluar. Hanya satu.', protagonist: 'Arka', genre: 'survival_thriller', tropes: ['Game Bertahan', 'Hitungan Mundur', 'Pengkhianatan'] },
]

const provider = (() => {
  const baseUrl = process.env.NINEROUTER_BASE_URL
  const apiKey = process.env.NINEROUTER_API_KEY
  if (baseUrl && apiKey) {
    const authority = assertM10GG1RouteAuthority(M10_G_G1_9ROUTER_ROUTE_AUTHORITY)
    return createProviderFromExactRoutes({
      writerRoute: toAiModelRoute(authority, 'writer'),
      choicesRoute: toAiModelRoute(authority, 'choice'),
      judgeRoute: toAiModelRoute(authority, 'continuity'),
      generationPolicy: DEFAULT_RUNTIME_POLICY,
    })
  }
  throw new Error('NINEROUTER_BASE_URL / NINEROUTER_API_KEY belum diset')
})()

async function createDrafts(): Promise<void> {
  const writer = createDbCatalogWriter()
  const existing = await writer.loadState('__probe__')
  console.log(`[batch-seed] Membuat 20 draf novel katalog...`)

  const results: Array<{ slug: string; status: string; contractSource?: string; error?: string }> = []
  for (const story of STORIES) {
    const storyId = `catalog:${story.slug}`
    try {
      const res = await createCatalogDraft({
        storyId,
        title: story.title,
        tagline: story.tagline,
        synopsis: story.synopsis,
        protagonistName: story.protagonist,
        tropes: story.tropes,
        genreId: story.genre,
        provider,
      })
      results.push({ slug: story.slug, status: 'created', contractSource: res.contractSource })
      console.log(`  [OK] ${storyId}: ${res.contractSource}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('CATALOG_STORY_EXISTS')) {
        results.push({ slug: story.slug, status: 'already-exists' })
        console.log(`  [SKIP] ${storyId}: sudah ada`)
      } else {
        results.push({ slug: story.slug, status: 'error', error: msg })
        console.error(`  [FAIL] ${storyId}: ${msg}`)
      }
    }
  }

  const created = results.filter((r) => r.status === 'created').length
  const skipped = results.filter((r) => r.status === 'already-exists').length
  const failed = results.filter((r) => r.status === 'error').length
  console.log(`\n[batch-seed] Draf selesai: ${created} baru, ${skipped} sudah ada, ${failed} gagal.`)
}

createDrafts().catch((err) => {
  console.error('[batch-seed] GAGAL:', err instanceof Error ? err.message : err)
  process.exit(1)
})
