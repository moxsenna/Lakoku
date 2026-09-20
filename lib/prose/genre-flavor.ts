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
    atmosphere:
      'Ketegangan relasi darah yang menekan, luka lama yang belum sembuh, beban ekspektasi keluarga, rasa bersalah, dan harga diri yang dipertaruhkan di balik kesopanan rumah tangga.',
    sensoryFocus:
      'Keheningan canggung di meja makan, denting piring kaku, jam dinding berdetik lambat, foto keluarga berdebu, pintu kamar yang tertutup rapat, jarak fisik yang saling menghindar.',
    dialogueDynamics:
      'Dialog sarat subteks: kata-kata tampak sopan atau biasa, tetapi menyiratkan sindiran tajam, kepahitan, atau tuntutan terselubung. Banyak jeda menahan getar suara atau napas berat.',
    lexiconFocus:
      'Gunakan pilihan kata bernuansa kekerabatan, warisan, silsilah, janji masa kecil, pengorbanan, utang budi, dan rahasia yang disimpan bertahun-tahun.',
    antiPatterns:
      'DILARANG melodrama cengeng tanpa dasar aksi; DILARANG eksposisi silsilah bertele-tele. Tunjukkan kepedihan lewat sikap tubuh dan tatapan dingin.',
  },

  romance: {
    id: 'romance',
    label: 'Romansa',
    atmosphere:
      'Ketegangan tarik-ulur yang intens (slow burn/tension), keengganan mengakui ketertarikan karena gengsi atau trauma masa lalu, keintiman emosional yang terbangun dari momen kecil.',
    sensoryFocus:
      'Jarak fisik yang menyempit, sentuhan jemari tak sengaja yang membakar, helaan napas hangat di dekat telinga, degup jantung yang memberontak di balik dada, pupil mata yang melebar.',
    dialogueDynamics:
      'Sahut-menyahut cepat penuh gengsi atau candaan tajam yang menutupi rasa peduli mendalam; jeda hening sebelum menjawab saat kata-kata kejujuran hampir lolos dari bibir.',
    lexiconFocus:
      'Perkaya kosakata tatapan, kehangatan kulit, desah tertahan, batas kesabaran, getaran samar di ujung jari, dan keheningan yang lebih keras daripada kata-kata.',
    antiPatterns:
      'DILARANG gombalan murahan atau rayuan klise; DILARANG cinta instan tanpa proses emosional. Bangun ketertarikan lewat perhatian terhadap detail terkecil lawan bicara.',
  },

  mystery: {
    id: 'mystery',
    label: 'Misteri & Rahasia',
    atmosphere:
      'Kewaspadaan tinggi dan kecurigaan terukur; rasa tidak nyaman bahwa setiap orang menyembunyikan motif kedua; tekanan waktu dan taruhan kebenaran yang berbahaya.',
    sensoryFocus:
      'Detail fisik janggal yang luput dari orang lain (noda di ujung lengan kemeja, kunci yang tertinggal, laci sedikit terbuka), bayangan memanjang di lorong sepi, aroma kertas basah atau tanah hujan.',
    dialogueDynamics:
      'Percakapan interogatif terselubung: pertanyaan santai yang sebenarnya menguji alibi, tatapan mata yang mencari celah kepanikan, penghentian kalimat mendadak saat rahasia tersenggol.',
    lexiconFocus:
      'Gunakan kosakata kejanggalan, alibi, motif, jejak tersamar, tatapan ragu, kepingan fakta, firasat waspada, dan jeda yang mencurigakan.',
    antiPatterns:
      'DILARANG menyimpulkan bukti dalam narasi monolog ("aku langsung tahu..."); DILARANG membocorkan petunjuk tanpa interaksi adegan nyata. Biarkan fakta berbicara lewat aksi fisik.',
  },

  fantasy_kingdom: {
    id: 'fantasy_kingdom',
    label: 'Fantasi & Kerajaan',
    atmosphere:
      'Beban kehormatan, intrik takhta yang dingin dan mematikan, hierarki kekuasaan yang kejam, serta konflik tajam antara kesetiaan sumpah darah melawan nurani pribadi.',
    sensoryFocus:
      'Gemerincing baju besi di aula batu yang dingin, cahaya obor berkedip di balik pilar marmer, aroma lilin lebah dan dupa, segel lilin merah di atas perkamen, angin malam di balkon benteng.',
    dialogueDynamics:
      'Protokoler formal dan penghormatan kaku yang di baliknya menyembunyikan ancaman maut; permainan diplomasi bersayap di mana satu kata salah ucap bisa berarti pengkhianatan.',
    lexiconFocus:
      'Kosakata bernuansa takhta, maklumat, dewan bangsawan, sumpah darah, garis keturunan, bilah baja, intrik istana, mahkota, dan harga sebuah kesetiaan.',
    antiPatterns:
      'DILARANG info-dumping latar dunia/lore sihir secara panjang lebar; DILARANG narasi seperti ensiklopedia. Tetap fokus pada tindakan orang pertama ("aku") dan taruhan hidup-mati di depan mata.',
  },

  slice_of_life: {
    id: 'slice_of_life',
    label: 'Slice of Life',
    atmosphere:
      'Kehangatan membumi dengan sentuhan getir realistis; kejujuran emosi dalam ritme hidup sehari-hari; penerimaan diri di tengah impian, kelelahan, dan harapan kecil.',
    sensoryFocus:
      'Asap kopi hitam yang mengepul di pagi mendung, deru kendaraan jalanan kota, bahu pegal setelah seharian beraktivitas, cahaya lampu temaram di warung langganan, aroma nasi hangat.',
    dialogueDynamics:
      'Percakapan santai, ceplas-ceplos akrab tanpa kepalsuan, humor ringan yang menyelipkan keresahan masa depan, tawa lepas yang menepis lelah sejenak.',
    lexiconFocus:
      'Pilihan kata keseharian yang luwes, detail rutinitas, keresahan gaji/waktu, kebiasaan kecil teman bicara, langkah kaki pulang, dan ketenangan sesaat di tengah bising dunia.',
    antiPatterns:
      'DILARANG menciptakan konflik bombastis atau bencana artifisial; kekuatan cerita ada pada resonansi emosi tulus dan keintiman momen nyata antartokoh.',
  },

  survival_thriller: {
    id: 'survival_thriller',
    label: 'Thriller & Bertahan Hidup',
    atmosphere:
      'Adrenalin mendesak (urgency tinggi), rasa terancam yang nyata di setiap detik, insting bertahan hidup hewani, dan keputusan cepat antara bertindak atau binasa.',
    sensoryFocus:
      'Keringat dingin mengalir di pelipis, otot menegang siap melompat atau menghindar, deru napas pendek tertahan, detak nadi berdentum di gendang telinga, kegelapan yang menelan jalan keluar.',
    dialogueDynamics:
      'Kalimat pendek, bisikan cepat, instruksi mendesak tanpa basa-basi; pemeriksaan cepat kondisi fisik; saling bertukar sinyal tanpa suara agar tidak memicu bahaya.',
    lexiconFocus:
      'Kosakata bertempo cepat: menyergap, menerobos, membeku, menghitung detik, celah sempit, naluri, ancaman langsung, dan taruhan nyawa.',
    antiPatterns:
      'DILARANG memperlambat adegan dengan renungan puitis saat bahaya sedang mengejar; tempo kalimat harus secepat detak jantung tokoh yang sedang diburu waktu.',
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
    `  * Atmosfer Emosional: ${flavor.atmosphere}`,
    `  * Fokus Sensorik Fisik: ${flavor.sensoryFocus}`,
    `  * Dinamika Dialog & Subteks: ${flavor.dialogueDynamics}`,
    `  * Aksen Kosakata: ${flavor.lexiconFocus}`,
    `  * Pagar Gaya: ${flavor.antiPatterns}`,
  ].join('\n')
}
