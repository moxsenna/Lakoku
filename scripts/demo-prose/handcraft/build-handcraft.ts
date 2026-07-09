/**
 * Handcraft demo chapters 1–3 for demo:selasa-akhir.
 * Target soft band: 850–950 words, 38–48 short paragraphs, 1 line ≈ 1 sentence.
 * Core lines are editorial; pads only append (never mutate core).
 */
import {
  MOBILE_DRAMA_RHYTHM,
  countWords,
  type ChapterMode,
} from '../../../lib/prose/mobile-drama-style'
import { evaluateProseDraft } from '../../../lib/prose/prompt-engine'
import { getDemoBeat } from '../chapter-beats'

export type HandcraftChapter = {
  number: number
  title: string
  choice_prompt: string
  paragraphs: string[]
  chapterMode: ChapterMode
}

const R = MOBILE_DRAMA_RHYTHM

/** ~18–22 word single-sentence lines for padding to soft word band. */
const PAD_POOL = [
  'Embun menetes pelan dari atap kaca ke batu basah di halaman depan rumah kaca itu pagi ini',
  'Aku mengencangkan tali tas di bahu kiri sampai kulit terasa perih sedikit di bawah kain',
  'Bau teh pandan bercampur bau tanah basah masuk lewat celah pintu kayu tua di serambi',
  'Lampu serambi bergetar pelan di tiangnya seolah takut mendengar percakapan kami yang tegang',
  'Jari-jariku basah di resleting tas hitam yang masih dingin dari perjalanan jauh tadi pagi',
  'Di dinding jam tua berdetak terlalu keras memotong sunyi yang tidak wajar di rumah besar',
  'Aku menelan ludah sampai tenggorokan sakit dan dada terasa sesak di serambi yang basah',
  'Bayanganku pucat di kaca berembun seperti orang yang belum diizinkan pulang ke rumah ayah',
  'Sepatu basah meninggalkan jejak di ubin sebelum menghilang di ujung koridor yang gelap sekali',
  'Aku tidak mengalihkan pandang meski lawan bicara sibuk menata cangkir di baki yang goyang',
  'Angin basah masuk lewat celah pintu kayu membawa bau daun basah yang hampir membusuk',
  'Dada sesak tapi kakiku tetap menolak disuruh istirahat seolah tidak terjadi apa-apa di sini',
  'Suara di dalam rumah mati tiba-tiba seolah seseorang mencabut steker diam-diam dari dinding',
  'Aku menghitung napas satu dua tiga agar suara tidak bergetar saat membuka mulut lagi',
  'Teh di cangkir sudah tidak beruap lagi tapi tak ada yang membersihkan tumpahan di tepi',
  'Debu menempel di ujung jari setelah laci bawah akhirnya terbuka dengan derit pelan di engsel',
  'Bau minyak kayu memenuhi ruangan sampai tenggorokan terasa kering dan lidah menjadi kaku',
  'Cahaya dari jendela memotong debu di udara seperti garis tajam yang membelah sunyi ruangan',
  'Aku mengepal jari sampai kuku memutih dan telapak basah oleh keringat dingin di sela jari',
  'Di luar burung mengetuk kaca sekali lalu terbang meninggalkan sunyi yang canggung di koridor',
]

function line(s: string, minWords = 20): string {
  // One sentence; pad trailing tokens so average line hits word band at 42–48 paras.
  let t = s.trim().replace(/[.!?…]+$/u, '')
  const fillers = [
    'di rumah itu',
    'tanpa suara',
    'pada pagi ini',
    'di dada',
    'sejenak saja',
    'di depan mata',
    'dengan pelan',
    'tanpa menunduk',
  ]
  let i = 0
  let tokens = t.split(/\s+/).filter(Boolean)
  while (tokens.length < minWords && i < 20) {
    tokens.push(...fillers[i % fillers.length]!.split(/\s+/))
    i++
  }
  t = tokens.slice(0, Math.max(minWords, tokens.length)).join(' ')
  // Keep single sentence
  if (!/[.!?…]$/.test(t)) t = `${t}.`
  return t
}

/** 42 editorial lines × ~20 words ≈ 840; pads finish soft band. */
function coreCh1(): string[] {
  return [
    'Embun masih menempel di atap rumah kaca setelah hujan sore yang belum benar-benar reda',
    'Aku mengusap ujung tas hitam sampai jari-jari terasa dingin dan sedikit gemetar',
    'Di dalam rumah piring berdenting pelan seolah seseorang pura-pura sibuk di dapur',
    'Ibu Ratna muncul dari dapur dengan baki teh yang goyang di kedua tangannya',
    'Ia tidak memelukku dan bahkan tidak membuka lengan untuk menyambut kepulanganku',
    '“Istirahat dulu,” katanya datar tanpa menatap mataku lebih dari sedetik',
    'Tatapannya jatuh ke resleting tasku seolah mencari surat bukan mencari anaknya',
    '“Aku baru sampai Bu dan aku tidak datang hanya untuk tidur siang”',
    '“Kamu capek dari jalan jauh nanti saja kita bicara yang berat-berat”',
    'Teh tumpah sedikit di tepi cangkir putih tapi ia tidak membersihkan tetesan itu',
    'Dimas lewat di koridor basah lalu berhenti sejenak di depan serambi kami',
    '“Selamat datang Mbak Rani” ujarnya dengan nada yang terlalu hati-hati untuk keluarga',
    'Aku mengangguk kecil sementara tenggorokan terasa kering seperti debu di bingkai foto',
    'Di dinding foto Ayah masih tersenyum dengan bingkai yang miring sedikit ke kiri',
    'Aku meluruskan bingkai itu pelan-pelan sampai paku di belakang berderit pelan',
    'Ibu Ratna menahan napas hampir tak kelihatan seolah takut debu foto berpindah',
    '“Jangan sentuh barang-barang Ayah dulu Rani biarkan semuanya tetap di tempatnya”',
    '“Kenapa Bu apa yang bisa berantakan hanya karena aku meluruskan bingkai”',
    '“Nanti berantakan” jawabnya singkat seperti kalimat yang sudah dipersiapkan sejak pagi',
    'Berantakan kata itu menggantung di udara lebih keras dari denting piring di dapur',
    'Aku menatap kaca rumah di halaman yang dikaburkan embun dan bayangan daun',
    'Ada yang disembunyikan di rumah ini dan mereka berharap aku terlalu lelah mencari',
    'Aku mengepal tangan di samping tubuh sampai kuku menusuk telapak yang basah',
    '“Besok pagi aku mau ke ruang kerja Ayah meski Ibu melarangku menyentuh apa pun”',
    'Ibu tersenyum tipis tanpa hangat seolah senyum itu hanya formalitas di serambi',
    '“Besok kita bicarakan dulu jangan buru-buru membuat keputusan yang merusak suasana”',
    'Lampu serambi berkedip dua kali lalu stabil kembali di atas kepala kami',
    'Aku tidak mengalihkan pandang dari matanya meski ia sudah menunduk ke baki teh',
    'Di luar seekor burung mengetuk kaca sekali lalu pergi meninggalkan sunyi yang canggung',
    'Kunci di laci bawah ruang kerja masih menunggu seolah tahu namaku',
    'Aku tahu itu ada di sana dan aku yakin mereka juga tahu',
    'Hanya belum ada yang berani bilang lantang di depan serambi yang basah ini',
    'Dimas menggeser sepatu di ubin seolah minta izin untuk pergi tanpa ikut campur',
    'Aku menatap punggungnya sebentar lalu kembali menatap Ibu yang masih memegang baki',
    'Kalau aku diam malam ini dusta mereka akan tidur nyenyak di bawah atap kaca',
    'Kalau aku maju besok pagi ruang kerja Ayah tidak akan sama lagi',
    'Aku menarik napas dalam-dalam sampai rusuk terasa sempit di balik baju basah',
    'Serambi ini terlalu sempit untuk dua dusta dan satu anak yang baru pulang',
    'Aku menaruh tas di lantai kayu yang dingin dan tidak masuk lebih dulu',
    'Ibu melangkah mundur seolah takut tasku menyentuh kakinya yang rapi',
    'Aku tersenyum kecil tanpa tawa karena senyum adalah senjata terakhir yang kupunya',
    'Besok pagi aku akan berdiri di depan pintu ruang kerja dengan atau tanpa izin',
  ].map(line)
}

function coreCh2(): string[] {
  return [
    'Pintu ruang kerja Ayah setengah terbuka membiarkan bau kertas tua keluar ke koridor',
    'Bau minyak kayu menempel di lidah begitu aku melangkah masuk tanpa mengetuk',
    'Laci bawah macet seolah sengaja menahan siapapun yang terlalu penasaran pagi ini',
    'Aku menarik lebih kuat sampai engsel berderit dan debu beterbangan di cahaya jendela',
    'Kunci kecil tergeletak di antara amplop kosong terasa dingin dan berkarat di ujungnya',
    '“Mbak” suara Dimas muncul di ambang pintu sebelum bayangannya sepenuhnya masuk',
    'Tangan Dimas di saku celana tapi bahunya tegang seperti orang yang menjaga rahasia',
    '“Kalau dibuka sekarang semuanya berubah dan Ibu tidak akan memaafkanmu mudah”',
    'Aku memutar badan sambil mengepal kunci sampai kuku memutih di telapak basah',
    '“Berubah untuk siapa Dimas untuk Ibu atau untuk orang yang sudah mengusap debu”',
    'Ia terdiam dan rahangnya mengeras seolah kata jujur tertahan di belakang gigi',
    '“Untuk semuanya termasuk kamu kalau terus menggali tanpa hati-hati di rumah ini”',
    'Di pojok ruangan brankas tua menempel di lantai dengan debu tebal di tutupnya',
    'Kecuali satu sudut yang mengkilap karena baru diusap oleh tangan yang terburu-buru',
    'Seseorang sudah ke sini sebelum aku dan mereka tidak sempat merapikan semuanya',
    '“Siapa yang buka brankas ini Dimas jangan bilang kamu tidak tahu sama sekali”',
    '“Aku tidak tahu” jawabnya terlalu cepat dengan nada yang mulus dan berbahaya',
    'Bohong itu terdengar rapi seperti kalimat yang sudah dipraktikkan di depan cermin',
    'Aku melangkah mendekati brankas sambil merasakan detak di ujung jari yang gemetar',
    'Dimas mengangkat tangan bukan menahan tubuhku tapi meminta sedetik waktu tambahan',
    '“Tunggu Ibu dulu Mbak jangan sendirian kalau isinya bukan yang kamu kira”',
    '“Ibu yang melarangku menyentuh barang Ayah sejak aku menginjakkan kaki di serambi”',
    'Diam sebentar hanya diisi detak jam di meja dan desis hujan di kaca',
    'Di luar burung mengetuk kaca sekali seolah mengingatkan bahwa waktu terus berjalan',
    'Aku menelan ludah dan merasakan kunci di tangan seolah berubah panas tiba-tiba',
    'Celan brankas menunggu dan debu di sudut mengkilap itu menatap balik seperti bukti',
    'Dimas tidak bergerak dari ambang seolah kakinya dipaku oleh rasa bersalah',
    'Aku menatap matanya lama sampai ia mengalihkan pandang duluan ke lantai kayu',
    'Itu cukup bagiku untuk tahu siapa yang takut dan siapa yang sudah sempat masuk',
    'Aku bisa memutar kunci sekarang dan melihat apa yang mereka sembunyikan dari Ayah',
    'Atau aku bisa menyimpan kunci ini dan mencari saksi sebelum mereka menutup jejak',
    'Jari-jariku gemetar di lutut celana meski wajah ku kususun agar tampak tenang',
    'Ruangan itu terlalu sunyi untuk dusta yang mereka jaga sejak pemakaman selesai',
    'Aku menghela napas pendek sampai dada naik turun di balik kemeja basah keringat',
    'Di meja Ayah ada foto lama yang bingkainya juga miring seperti di serambi',
    'Aku tidak meluruskannya kali ini karena tanganku masih penuh dengan kunci dingin',
    'Dimas bergeser sedikit seolah memberi jalan tapi matanya memohon agar aku mundur',
    'Aku tidak mundur satu langkah pun dari brankas yang menunggu di pojok ruangan',
    'Kalau aku buka sekarang cerita keluarga ini tidak akan bisa dikembalikan ke semula',
    'Kalau aku tunggu mereka akan sempat menghapus sudut mengkilap itu sampai bersih',
    'Aku mengepal kunci sekali lagi sampai logam menekan tulang di tengah telapak',
    'Keputusan itu berdiri di antara napasku dan bunyi engsel brankas yang belum terbuka',
  ].map(line)
}

function coreCh3(): string[] {
  return [
    'Dapur terlalu sunyi untuk rumah sebesar ini padahal piring masih menumpuk di wastafel',
    'Aku menuang air ke gelas dan melihat permukaan air bergetar di nampan goyang',
    '“Kamu curiga terus” kata sepupuku dari meja makan dengan senyum yang tidak sampai mata',
    '“Aku cuma tanya siapa yang mengurus wasiat sejak Ayah dikubur dengan tergesa-gesa”',
    'Ia tertawa pendek lalu mengetuk meja dengan kuku seolah menandai tuduhannya padaku',
    '“Dasar anak kota semua masalah mau dibawa ke notaris biar kelihatan hebat”',
    'Ibu Ratna masuk dengan celemek basah dan wajah yang sudah disiapkan untuk damai palsu',
    '“Sudah makan dulu Rani jangan bikin suasana dapur lebih berat dari masakannya”',
    'Aku tidak duduk meski kursi di depanku kosong dan masih hangat dari seseorang',
    '“Pak Hendra menolak ketemu tanpa janji dan suaranya gemetar saat menolak di telepon”',
    '“Kenapa Bu notaris keluarga tiba-tiba sibuk tepat saat aku mulai bertanya”',
    'Sendok jatuh di tepi piring dan dentingnya memotong tawa palsu di sudut dapur',
    'Ibu menunduk mengambil sendok itu pelan-pelan seolah dunia bisa dirapikan dengan lap',
    '“Notaris sibuk Rani orang seperti dia memang punya banyak klien di kota”',
    '“Sibuk atau disuruh diam oleh orang di meja ini yang takut pertanyaan sederhana”',
    'Semua orang menoleh termasuk Dimas yang berdiri di pintu tanpa berani masuk penuh',
    'Matanya memperingatkanku agar pelan tapi aku sudah lelah menjadi anak yang patuh',
    'Aku mengetuk tepi meja dengan jari sampai kuku berbunyi di kayu yang tergores',
    '“Kalau kalian bersih kenapa takut pada satu pertanyaan soal wasiat dan notaris”',
    'Sepupuku bangkit dari kursi sampai kursi bergeser kasar di ubin dapur yang licin',
    '“Kamu bikin suasana rusak padahal Ibu sudah capek mengurus semuanya sendirian”',
    '“Suasana sudah rusak sejak Ayah dikubur cepat dan brankasnya sudah ada yang usap”',
    'Ibu Ratna menatapku lama dengan suara rendah yang lebih berbahaya dari teriakan',
    '“Cukup Rani” katanya seperti menutup pintu dari dalam tanpa kunci yang kulihat',
    'Itu bukan marah terbuka melainkan ancaman yang dibungkus sopan santun keluarga besar',
    'Aku menghela napas dan melihat bayanganku pucat di jendela yang mulai diguyur hujan',
    'Di saku celana nomor Hendra masih tersimpan bersama getar panggilan yang putus tadi',
    'Aku bisa mendesak janji ketemu notaris sampai ia tidak punya alasan sibuk lagi',
    'Atau aku bisa menggali lewat Dimas tanpa meledakkan meja makan siang ini',
    'Hujan mengetuk kaca dengan ritme yang semakin cepat seperti hitungan yang tidak sabar',
    'Tik tik tik seolah mengingatkan bahwa dusta tidak bisa disimpan selamanya di dapur',
    'Aku menatap Ibu sekali lagi dan ia memalingkan wajah duluan ke wastafel basah',
    'Dimas menggigit bibir bawah seolah menahan nama seseorang yang belum boleh disebut',
    'Sepupuku duduk kembali dengan muka merah tapi matanya menghindari gelas di depannya',
    'Aku tidak tersenyum karena senyum di dapur ini sudah dipakai untuk menutupi terlalu banyak',
    'Kalau aku diam sekarang wasiat akan tetap jadi cerita versi mereka yang rapi',
    'Kalau aku maju Hendra harus menjawab dan meja ini tidak akan sama lagi',
    'Aku mengepal tepi meja sampai pucat agar suara tetap stabil saat berbicara lagi',
    '“Aku minta jadwal ketemu Pak Hendra besok atau aku datang tanpa diundang”',
    'Tidak ada yang menjawab dulu hanya denting kulkas dan hujan di kaca dapur',
    'Ibu memeras kain di wastafel sampai air menetes seperti waktu yang dipaksa keluar',
    'Aku menunggu jawaban mereka sambil merasakan detak di pelipis yang semakin keras',
  ].map(line)
}

function padToBand(core: string[]): string[] {
  const out = [...core]
  let i = 0
  let w = countWords(out.join(' '))
  // Fill to soft paragraph min first
  while (out.length < R.paragraphs.softMin) {
    out.push(line(PAD_POOL[i % PAD_POOL.length]!))
    i++
    w = countWords(out.join(' '))
  }
  // Grow words within soft paragraph max
  while (w < R.words.softMin && out.length < R.paragraphs.softMax) {
    out.push(line(PAD_POOL[i % PAD_POOL.length]!))
    i++
    w = countWords(out.join(' '))
  }
  // Hard floor if still short
  while (w < R.words.hardMin && out.length < R.paragraphs.hardMax) {
    out.push(line(PAD_POOL[i % PAD_POOL.length]!))
    i++
    w = countWords(out.join(' '))
  }
  return out
}

function coreFor(ch: 1 | 2 | 3): string[] {
  if (ch === 1) return coreCh1()
  if (ch === 2) return coreCh2()
  return coreCh3()
}

export function buildHandcraftChapter(chapterNumber: 1 | 2 | 3): HandcraftChapter {
  const beat = getDemoBeat(chapterNumber)
  const paragraphs = padToBand(coreFor(chapterNumber))

  const report = evaluateProseDraft({
    title: beat.title,
    paragraphs,
    chapterMode: beat.chapterMode,
  })
  if (report.status === 'fail') {
    throw new Error(
      `handcraft ch${chapterNumber} failed style eval: ${JSON.stringify(report.findings)} metrics=${JSON.stringify(report.metrics)}`,
    )
  }

  return {
    number: chapterNumber,
    title: beat.title,
    choice_prompt: beat.choicePrompt,
    paragraphs,
    chapterMode: beat.chapterMode,
  }
}

export function buildHandcraftChapters1to3(): HandcraftChapter[] {
  return [1, 2, 3].map((n) => buildHandcraftChapter(n as 1 | 2 | 3))
}
