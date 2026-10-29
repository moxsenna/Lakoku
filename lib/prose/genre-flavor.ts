/**
 * Genre-specific prose flavor directives for Lakoku Chapter Writer.
 *
 * Grounded in Lakoku Mobile Drama style (800–1000 words, P0–P5 precedence).
 * Enhances tone, sensory palette, dialogue dynamics, and genre vocabulary
 * without relaxing mobile readability or canon invariants.
 */
import {
  GENRE_CATALOG,
  GENRE_LABEL,
  V1_GENRE_LABEL_TO_ID,
  type GenreCatalogId,
} from '@/lib/taste-profile/catalog'

export interface GenreProseFlavor {
  id: GenreCatalogId
  label: string
  /** Panduan hook pembuka detik-0 (in medias res) */
  hookGuidance: string
  /** Atmosfer dan tensi emosional utama */
  atmosphere: string
  /** Fokus sensorik fisik & latar */
  sensoryFocus: string
  /** Dinamika pertukaran dialog & subteks */
  dialogueDynamics: string
  /** Kosakata & aksen narasi yang diperkaya */
  lexiconFocus: string
  /** Larangan khusus agar tidak jatuh ke klise murahan */
  antiPatterns: string
}

export const GENRE_PROSE_FLAVORS: Record<GenreCatalogId, GenreProseFlavor> = {
  family_drama: {
    id: 'family_drama',
    label: 'Drama Keluarga',
    hookGuidance:
      "Buka bab langsung di tengah benturan konflik atau dialog sindiran tajam (in medias res). Contoh: 'Tanda tangani surat ini, atau namamu dicoret dari keluarga.' atau sindiran di meja makan. DILARANG membuka dengan deskripsi cuaca, ruang tamu berdebu, atau lamunan masa lalu.",
    atmosphere:
      'Ketegangan relasi darah yang menekan, luka lama yang belum sembuh, beban ekspektasi keluarga, rasa bersalah, dan harga diri yang dipertaruhkan di balik kesopanan rumah tangga.',
    sensoryFocus:
      'Bahasa tubuh kaku, rahang mengeras, dada sesak menahan amarah, tatapan dingin yang saling menghindari, tangan mengepal di bawah meja.',
    dialogueDynamics:
      'Adu mulut beruntun dengan subteks tajam. Setiap kalimat saling membalas, menekan, atau menelanjangi kepalsuan lawan bicara.',
    lexiconFocus:
      'Kosakata penindasan, hak waris, utang budi, anak tiri, harga diri terinjak, pengorbanan yang disia-siakan, dan janji yang dikhianati.',
    antiPatterns:
      'DILARANG membuka dengan cuaca/pemandangan. DILARANG melodrama cengeng merengek tanpa tindakan. Tokoh utama bersikap stoik, tenang, dan mencatat bukti.',
  },

  romance: {
    id: 'romance',
    label: 'Romansa',
    hookGuidance:
      'Buka bab di momen kesepakatan dingin, klausul perjanjian, penolakan tegas, atau pertemuan tak terduga yang canggung dan bertegangan tinggi. DILARANG membuka dengan pujian kecantikan fisik atau renungan romantis pasif.',
    atmosphere:
      'Ketegangan tarik-ulur yang intens (slow burn/tension), keengganan mengakui ketertarikan karena gengsi atau trauma masa lalu, keintiman emosional yang terbangun dari momen kecil.',
    sensoryFocus:
      'Jarak fisik yang menyempit mendadak, desau napas hangat, senggolan bahu yang membuat kaku, pupil mata melebar, tangan yang membeku saat menyentuh dokumen atau pintu.',
    dialogueDynamics:
      'Banter tajam, adu gengsi (pride), saling menantang dengan kalimat-kalimat dingin bernada ejekan tapi sarat tarikan emosi.',
    lexiconFocus:
      'Kosakata batas kesabaran, status pernikahan kontrak, harga diri, tatapan menusuk, janji batas waktu, dan keheningan yang menyesakkan.',
    antiPatterns:
      'DILARANG cinta instan (insta-love) tanpa alasan rasional. DILARANG gombalan puitis mendayu-dayu. Tunjukkan ketertarikan lewat tensi permusuhan yang perlahan retak.',
  },

  mystery: {
    id: 'mystery',
    label: 'Misteri & Rahasia',
    hookGuidance:
      'Buka bab saat kejanggalan gawat baru saja ditemukan, saat hampir tertangkap basah, atau ketika waktu penyelidikan tersisa sedikit. DILARANG membuka dengan duduk merenungi meja berdebu, jendela hujan, atau kopi dingin.',
    atmosphere:
      'Kewaspadaan tinggi dan kecurigaan terukur; rasa tidak nyaman bahwa setiap orang menyembunyikan motif kedua; tekanan waktu dan taruhan kebenaran yang berbahaya.',
    sensoryFocus:
      'Telinga waspada mendengar derit langkah di tangga, kunci yang mendadak tidak cocok di lubangnya, aroma benda yang terbakar samar, napas tertahan di balik pintu tertutup.',
    dialogueDynamics:
      'Pertanyaan interogatif santai yang menguji alibi, jawaban yang sengaja memancing kepanikan lawan, tatapan mata yang mencari gelagat bohong.',
    lexiconFocus:
      'Kosakata alibi, bukti fisik, batas waktu, berkas yang dipalsukan, rekaman yang hilang, saksi yang berbohong, dan jebakan yang mulai menutup.',
    antiPatterns:
      'DILARANG monolog batin panjang menyimpulkan teka-teki sendirian. Biarkan bukti dan kejanggalan muncul lewat aksi fisik dan interaksi berisiko.',
  },

  fantasy_kingdom: {
    id: 'fantasy_kingdom',
    label: 'Fantasi & Kerajaan',
    hookGuidance:
      'Buka bab tepat saat vonis pengasingan dibacakan di aula takhta, saat pedang dicabut, atau saat konspirasi baru terbongkar di depan dewan bangsawan. DILARANG membuka dengan 3 paragraf penjelasan peta benua, sistem sihir, atau sejarah perang kuno (anti info-dumping).',
    atmosphere:
      'Beban kehormatan, intrik takhta yang dingin dan mematikan, hierarki kekuasaan yang kejam, serta konflik tajam antara kesetiaan sumpah darah melawan nurani pribadi.',
    sensoryFocus:
      'Denting bilah baja yang ditarik dari sarung, derap sepatu bot di lantai marmer aula, tatapan merendahkan para bangsawan di perjamuan, napas dingin di balik zirah perang.',
    dialogueDynamics:
      'Percakapan formal bersayap di mana setiap kata salah ucap adalah pengkhianatan; intimidasi terselubung antar fraksi penguasa.',
    lexiconFocus:
      'Kosakata sumpah darah, maklumat takhta, darah buangan, hak garis keturunan, bilah baja, intrik istana, dan harga sebuah mahkota.',
    antiPatterns:
      'DILARANG penjelasan sistem sihir seperti ensiklopedia. Masukkan lore sihir hanya saat sedang digunakan dalam aksi fisik atau ancaman langsung.',
  },

  slice_of_life: {
    id: 'slice_of_life',
    label: 'Slice of Life',
    hookGuidance:
      'Buka bab di tengah insiden kerjaan yang mendesak, tumpahan pesanan pertama di warung, debat gaji/kontrakan, atau momen ceplas-ceplos yang memicu tawa getir. DILARANG membuka dengan pemandangan mentari pagi atau deskripsi damai yang membosankan.',
    atmosphere:
      'Kehangatan membumi dengan sentuhan getir realistis; kejujuran emosi dalam ritme hidup sehari-hari; penerimaan diri di tengah impian, kelelahan, dan harapan kecil.',
    sensoryFocus:
      'Aroma bawang goreng dan asap minyak panas, dering telepon tagihan, bahu pegal setelah seharian berdiri, rasa dingin es teh manis di tenggorokan saat lelah.',
    dialogueDynamics:
      'Percakapan ceplas-ceplos khas Indonesia, saling ledek akrab tanpa basa-basi, humor getir yang menutupi kecemasan masa depan.',
    lexiconFocus:
      'Kosakata rutinitas nyata, kontrakan, cicilan, omzet hari ini, pelanggan pertama, lelah yang tertunda, dan kemenangan-kemenangan kecil yang memuaskan batin.',
    antiPatterns:
      'DILARANG obrolan hambar tanpa gesekan emosi. Setiap interaksi harus membawa realitas hidup yang membumi dan menyentuh.',
  },

  survival_thriller: {
    id: 'survival_thriller',
    label: 'Thriller & Bertahan Hidup',
    hookGuidance:
      'Buka bab saat sirine darurat berbunyi, pintu darurat macet, atau suara langkah mengejar di lorong sempit. DILARANG membuka dengan renungan masa lalu atau deskripsi pemandangan saat bahaya sedang aktif.',
    atmosphere:
      'Adrenalin mendesak (urgency tinggi), rasa terancam yang nyata di setiap detik, insting bertahan hidup hewani, dan keputusan cepat antara bertindak atau binasa.',
    sensoryFocus:
      'Keringat dingin membasahi telapak tangan pada gagang senjata, detak jantung berdentum keras di telinga, otot betis menegang siap melompat, napas tersengal tertahan di ruang sempit.',
    dialogueDynamics:
      'Bisikan patah-patah, instruksi singkat tanpa kata sambung, saling lempar isyarat mata di tengah kegelapan.',
    lexiconFocus:
      'Kosakata hitungan detik, celah sempit, sudut buta, sergapan, napas memburu, batas oksigen/amunisi, dan insting bertahan hidup.',
    antiPatterns:
      'DILARANG memperlambat adegan dengan renungan filosofis saat nyawa terancam. Ritme kalimat harus cepat dan mendesak.',
  },
}

/**
 * Normalisasi string genre (id stabil atau label lokal) ke GenreCatalogId.
 */
export function normalizeGenreId(raw?: string | null): GenreCatalogId | null {
  if (!raw) return null
  const cleaned = raw.trim().toLowerCase()
  if (!cleaned) return null

  // 1) Direct catalog ID match
  if (cleaned in GENRE_PROSE_FLAVORS) {
    return cleaned as GenreCatalogId
  }

  // 2) Check V1 label mapping
  if (cleaned in V1_GENRE_LABEL_TO_ID) {
    const mapped = V1_GENRE_LABEL_TO_ID[cleaned]
    if (mapped in GENRE_PROSE_FLAVORS) return mapped as GenreCatalogId
  }

  // 3) Check catalog labels directly
  for (const g of GENRE_CATALOG) {
    if (g.label.toLowerCase() === cleaned) return g.id
  }

  // 4) Fuzzy prefix / contains matches
  if (cleaned.includes('keluarga') || cleaned.includes('family')) return 'family_drama'
  if (cleaned.includes('roman') || cleaned.includes('cinta')) return 'romance'
  if (cleaned.includes('misteri') || cleaned.includes('mystery')) return 'mystery'
  if (cleaned.includes('fantasi') || cleaned.includes('kerajaan') || cleaned.includes('kingdom')) {
    return 'fantasy_kingdom'
  }
  if (cleaned.includes('slice') || cleaned.includes('keseharian')) return 'slice_of_life'
  if (cleaned.includes('thriller') || cleaned.includes('survival') || cleaned.includes('hidup')) {
    return 'survival_thriller'
  }

  return null
}

/**
 * Bangun direktif prompt prosa genre untuk disisipkan ke prompt writer [P4].
 * Mengembalikan null bila genre tidak dikenali.
 */
export function buildGenreProseDirective(rawGenre?: string | null): string | null {
  const genreId = normalizeGenreId(rawGenre)
  if (!genreId) return null

  const flavor = GENRE_PROSE_FLAVORS[genreId]
  if (!flavor) return null

  const display = GENRE_LABEL[genreId] ?? flavor.label

  return [
    `- KARAKTER & ATMOSFER GENRE (${display.toUpperCase()}):`,
    `  * Hook Pembuka Detik-0 (In Medias Res): ${flavor.hookGuidance}`,
    `  * Atmosfer Emosional: ${flavor.atmosphere}`,
    `  * Fokus Sensorik Fisik: ${flavor.sensoryFocus}`,
    `  * Dinamika Dialog & Subteks: ${flavor.dialogueDynamics}`,
    `  * Aksen Kosakata: ${flavor.lexiconFocus}`,
    `  * Pagar Gaya: ${flavor.antiPatterns}`,
  ].join('\n')
}
