/**
 * Handcraft demo chapters 1–3 for demo:selasa-akhir.
 * Full editorial prose — no padding, no generator filler, show-don't-tell.
 */
import {
  MOBILE_DRAMA_RHYTHM,
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

/** Bab 1 — arrival, cold welcome, photo frame tension. ~803 kata, 50 paragraf. */
function coreCh1(): string[] {
  return [
    // HOOK
    'Embun masih menempel di seluruh atap rumah kaca setelah hujan sore yang baru saja reda.',
    'Aku berdiri di serambi basah sambil memeluk tas hitamku lebih erat dari yang seharusnya.',
    'Di dalam rumah, piring berdenting pelan—seseorang pura-pura sibuk menyambut kepulanganku.',
    'Udara sore terlalu lembap dan menempel di kulit seperti kain basah yang lupa dijemur.',
    'Aku menarik napas dalam, tapi paru-paruku terasa penuh bahkan sebelum sempat benar-benar mengisi. Denting piring berhenti, lalu suara langkah sandal mendekat dari arah dapur ke serambi depan.',
    'Aku mengencangkan tali tasku dan mencoba mengingat bagaimana lantai ini dulu terasa di bawah kaki.',

    // KONFLIK AWAL
    'Ibu Ratna muncul dengan baki teh yang goyang di kedua tangannya yang mulai keriput karena usia.',
    'Ia tidak memelukku dan bahkan tidak membuka kedua lengannya sedikit pun untuk menyambut kepulangan.',
    'Matanya menyapu tasku dari atas ke bawah—bukan menatap wajahku yang baru tiba dari perjalanan panjang.',
    '“Istirahat dulu Rani,” katanya datar sambil meletakkan cangkir teh panas di meja kecil serambi.',
    'Teh tumpah sedikit ke tatakannya, tapi ia tidak membersihkan tetesan cokelat yang menggenang di kayu.',
    '“Aku baru sampai Bu, dan aku tidak datang sejauh ini hanya untuk tidur siang di rumah keluarga.”',
    '“Kamu capek dari perjalanan—nanti saja kita bicara yang berat, biar tenagamu benar-benar pulih dulu.”',
    'Kata-katanya terdengar halus, tapi nadanya seperti sedang menutup pintu sebelum aku sempat masuk ke dalam.',
    'Aku tidak duduk meskipun kursi rotan di depanku kosong dan masih menyisakan hangat dari seseorang.',
    'Dimas melintas di koridor basah lalu berhenti tepat di ambang antara serambi dan ruang tengah yang gelap.',
    '“Selamat datang Mbak Rani,” ujarnya dengan suara yang terlalu hati-hati untuk seorang anggota keluarga.',
    'Seperti orang yang tahu persis di mana letak setiap retakan di lantai dan takut salah menginjak salah satunya.',

    // DIALOG / KONFRONTASI
    'Aku mengangguk kecil, tapi tenggorokanku sudah kering oleh debu perjalanan dan gugup yang tak tertahankan.',
    '“Teh Mbak? Masih panas,” tawarnya sambil sekilas melirik cangkir yang belum kusentuh sejak tadi diletakkan.',
    'Aku menggeleng pelan karena takut suaraku akan pecah kalau membuka mulut terlalu cepat di depan mereka.',
    '“Dimas sudah, biar Mbak Rani istirahat dulu.” Suara Ibu memotong jauh lebih tajam dari ucapannya sendiri.',
    'Dimas mundur selangkah, tapi kedua matanya masih tertuju padaku—seperti menyembunyikan sesuatu yang penting.',
    'Ada kalimat yang ingin ia ucapkan dengan segera, atau kalimat yang ia takutkan akan sampai ke kedua telingaku.',
    'Aku menoleh ke dinding serambi tempat foto Ayah masih tersenyum dari balik bingkai kayu jati yang sudah tua.',
    'Bingkainya miring sedikit ke kiri, seolah seseorang menyenggolnya tanpa repot-repot meluruskan kembali.',
    'Aku mengulurkan tangan untuk meluruskannya—gerakan kecil yang ribuan kali kulakukan sejak aku masih kecil.',
    'Paku di balik bingkai kayu itu berderit pelan saat kayu yang sudah lama tidak digeser bergerak kembali ke asalnya.',
    '“Kata Ibu jangan sentuh dulu barang-barang Ayah,” bisik Dimas dari belakang, hampir tidak terdengar.',
    'Aku menoleh padanya sejenak—cukup lama untuk melihat bahwa ia tidak benar-benar setuju dengan larangan itu.',
    'Tapi ia tidak berkata lebih banyak karena Ibu masih berdiri di sampingku dengan cangkir teh yang sama.',
    '“Jangan sentuh barang-barang Ayah dulu Rani, biarkan semuanya tetap di tempatnya masing-masing saat ini.”',
    'Suara Ibu tajam—bukan sekadar permintaan, bukan sekadar saran, melainkan perintah yang dibungkus senyum tipis.',
    'Aku menarik tangan sebelum bingkai benar-benar lurus, lalu menoleh perlahan ke arah perempuan yang melahirkanku.',
    '“Kenapa Bu? Aku cuma mau meluruskan foto Ayah yang sudah seminggu miring tanpa ada yang peduli sama sekali.”',
    '“Nanti berantakan—semuanya sudah diatur rapi sejak pemakaman selesai, jangan ada satu pun yang berubah.”',
    'Rapi—kata itu terdengar ganjil keluar dari mulut perempuan yang baru saja menguburkan suaminya minggu lalu.',
    'Di belakang Ibu, Dimas menggigit bibir bawahnya sendiri dan menunduk dalam-dalam ke lantai ubin yang basah.',
    'Aku tidak langsung menjawab karena sedang mencoba membaca semua yang sebenarnya mereka sembunyikan dariku.',
    'Tatapan Ibu tidak meninggalkan wajahku, seolah sedang menunggu apakah aku akan melawan atau menyerah saja.',

    // REVEAL / EMOSI
    'Berantakan—kata itu masih menggantung di udara serambi, lebih berat dari denting piring di dapur belakang.',
    'Aku menatap kaca rumah kaca di halaman yang dikaburkan oleh embun tebal dan bayangan daun pisang yang patah.',
    'Kuku-kuku jariku menekan telapak tanganku sendiri, dan aku bahkan tidak sadar sejak kapan tanganku mengepal.',
    'Dadaku sempit, tapi bukan karena capek—melainkan karena semua pertanyaan yang belum berani kutanyakan sejak tiba.',
    'Aku menelan ludah dan merasakan detak di pelipis yang mulai berdetak lebih keras dari jam dinding di ruang tamu.',
    'Ada sesuatu yang disembunyikan di dalam rumah ini, dan mereka semua jelas berharap aku terlalu lelah untuk mencari.',
    'Tapi aku tidak lelah—aku hanya belum memutuskan seberapa keras aku akan mengetuk pintu mereka besok pagi, dan aku masih ingat setiap sudut koridor yang menuju ke ruang kerja Ayah.',

    // CLIFFHANGER
    '“Besok pagi aku mau ke ruang kerja Ayah—dengan atau tanpa izin dari Ibu.”',
    'Ia tersenyum tipis tanpa kehangatan—senyum formalita yang sudah lama bukan lagi milikku di rumah ini.',
    '“Besok kita bicarakan dulu, jangan buru-buru membuat keputusan yang bisa merusak suasana seluruh rumah.” Lampu serambi berkedip dua kali lalu stabil kembali—tapi burung di luar sudah tidak kembali mengetuk kaca.',
  ]
}

/** Bab 2 — ruang kerja Ayah, laci, kunci, brankas, konfrontasi dengan Dimas. */
function coreCh2(): string[] {
  return [
    // HOOK
    'Pintu ruang kerja Ayah sudah setengah terbuka ketika aku sampai di ujung koridor pagi itu.',
    'Bau kertas tua dan minyak kayu keluar dari celah pintu, menempel di langit-langit mulutku.',
    'Aku tidak mengetuk—karena Ayah sudah tidak di dalam, dan yang kutakutkan bukan mengganggu orang hidup.',
    'Lampu meja menyala redup di atas tumpukan map cokelat yang bertebaran di seluruh permukaan kayu yang berdebu, bergetar setiap kali hujan mengetuk jendela dengan ritme yang tidak sabar menunggu seseorang membuka isinya.',

    // KONFLIK AWAL
    'Laci bawah meja kayu jati itu macet ketika aku menariknya dengan tangan kanan.',
    'Aku mencoba lagi, kali ini lebih kuat, sampai engselnya berderit dan debu beterbangan di bawah sinar pagi.',
    'Di antara amplop-amplop kosong dan ballpoint yang tintanya sudah mengering, jariku menyentuh sesuatu.',
    'Sebuah kunci kecil—berkarat di ujungnya, tapi masih utuh—terselip di lipatan kertas pembungkus cokelat.',
    'Aku mengangkat kunci kecil itu ke depan mata dan merasakan bobot yang lebih berat dari logam biasa—kunci brankas, bentuknya khas dengan segitiga di pangkal yang persis seperti yang dulu Ayah tunjukkan padaku semasa aku masih remaja dan belum pergi dari rumah ini.',

    // DIALOG / KONFRONTASI
    '“Mbak.”',
    'Suara itu muncul sebelum bayangan—Dimas berdiri di ambang pintu, satu tangan masih di saku celana.',
    'Ia tidak masuk penuh ke dalam ruangan, tapi cukup dekat untuk membuat jarak di antara kami terasa sempit.',
    '“Pagi-pagi sudah ke sini,” katanya sambil menatap kunci di tanganku, bukan mataku.',
    '“Aku tidak minta izin untuk masuk ke ruang kerja Ayah, Dimas. Ini tetap rumahku juga.”',
    'Rahangnya mengeras sepersekian detik sebelum ia menghela napas panjang dan menyandarkan bahu di kusen.',
    '“Kalau Mbak buka brankas itu sekarang, semuanya berubah—dan Ibu tidak akan memaafkanmu dengan mudah.”',
    '“Berubah untuk siapa? Untuk Ibu, atau untuk orang yang sudah mengusap debu di tutup brankas?”',
    'Dimas membuka mulut lalu menutupnya lagi, seolah menelan nama seseorang yang belum boleh disebut.',
    '“Untuk semuanya—termasuk Mbak sendiri, kalau terus menggali tanpa hati-hati di rumah ini.”',
    'Aku mengepal kunci di telapak tangan sampai logamnya menekan tulang dan terasa panas oleh keringat.',
    'Aku berbalik dan melangkah ke pojok ruangan tempat brankas tua itu menempel di lantai seperti kotak buta.',
    'Debu tebal menyelimuti hampir seluruh permukaannya—kecuali satu sudut yang bersih dan agak mengkilap.',
    'Seseorang sudah membukanya belum lama ini, dan mereka terburu-buru sehingga tidak sempat mengotori lagi.',
    'Aku berjongkok dan menyentuh sudut bersih itu dengan ujung jari—licin seperti baru saja dilap tadi malam oleh seseorang yang tidak ingin meninggalkan jejak.',
    '“Siapa yang terakhir buka brankas ini, Dimas? Jangan bohong padaku pagi-pagi begini.”',
    '“Aku tidak tahu,” jawabnya terlalu cepat—terlalu mulus untuk sebuah kebenaran yang sesungguhnya.',
    'Bohong itu terdengar rapi, seperti kalimat yang sudah dipraktikkan di depan cermin sebelum aku tiba.',
    'Aku berjongkok lebih rendah di depan brankas dan merasakan hawa dingin dari logam yang belum tersentuh matahari pagi, sementara jari-jariku mulai gemetar di atas lutut.',
    'Dari sudut mata, aku melihat Dimas mengangkat tangan—bukan untuk menahanku, lebih seperti minta waktu.',
    '“Tunggu Ibu dulu, Mbak. Jangan sendirian—kalau isinya bukan yang Mbak kira, aku tidak bisa bantu.”',
    '“Ibu yang melarangku menyentuh barang Ayah sejak kakiku menginjak serambi. Kenapa aku harus menunggu?”',
    'Hanya detak jam di meja dan desis hujan yang kembali menguat di kaca jendela yang mulai berembun.',
    'Aku menelan ludah dan merasakan kunci di tanganku seolah berubah lebih panas dari sekadar logam biasa.',
    'Celan brankas menunggu, dan Dimas masih berdiri di ambang tanpa bergerak—patung penjaga yang ragu.',
    'Aku menatap matanya lama, sampai ia mengalihkan pandang duluan ke lantai kayu yang mulai berdebu lagi.',
    'Jari-jariku gemetar di lutut, tapi aku memaksa wajahku tetap tenang—setenang permukaan air di gelas.',

    // REVEAL / EMOSI
    'Dimas tidak menjawab, hanya menunduk dan menggigit bibir bawahnya sendiri seperti anak kecil yang ketahuan.',
    'Di luar jendela, seekor burung mengetuk kaca sekali—lalu terbang, meninggalkan sunyi yang canggung di antara kami.',
    'Aku menatap celah kunci di brankas itu dan merasakan jari-jariku gemetar, bukan karena takut—tapi karena ragu.',
    'Kalau aku memutar kunci sekarang, aku akan melihat apa yang mereka sembunyikan sejak pemakaman selesai.',
    'Tapi aku juga akan membakar jembatan yang bahkan belum sempat kuperiksa apakah masih bisa kupercaya atau tidak.',
    '“Dimas—kalau aku tanya sekarang, apa kamu akan jujur padaku, atau kamu akan terus jaga rahasia yang bahkan Ibu takut sebut namanya?”',
    'Ia mengangkat wajahnya perlahan, dan untuk pertama kalinya pagi ini, ia menatap mataku tanpa mengalihkan pandangannya—bukan tatapan orang bersalah, melainkan tatapan seseorang yang takut pada sesuatu yang jauh lebih besar dari dirinya sendiri.',

    // CLIFFHANGER
    'Aku menggenggam kunci brankas lebih erat—logamnya dingin, tapi keputusan di ujung jariku terasa panas.',
    'Dimas masih berdiri di ambang pintu, tidak masuk, tidak pergi—hanya menunggu apa yang akan kulakukan.',
    'Aku bisa memutar kunci sekarang, mendengar bunyi klik yang tidak bisa diulang, dan tahu semuanya hari ini.',
    'Atau aku bisa menyimpan kunci ini dan mencari saksi dulu—Pak Hendra, notaris yang suaranya gemetar di telepon.',
    'Di luar, hujan mulai lagi, mengetuk atap kaca dengan ritme yang semakin cepat dan tidak sabar menunggu.',
    'Aku menelan ludah dengan susah payah—pilihanku berikutnya akan disaksikan Dimas, dan dia pasti akan membawa cerita ini ke Ibu begitu aku selesai.',
  ]
}

/** Bab 3 — dapur, meja makan, notaris ditolak, Dimas jadi celah. */
function coreCh3(): string[] {
  return [
    // HOOK
    'Dapur terlalu sunyi untuk rumah sebesar ini, padahal piring kotor masih menumpuk di wastafel sejak semalam.',
    'Aku menuangkan air ke gelas dan melihat permukaannya bergetar karena tanganku belum sepenuhnya stabil pagi ini.',
    'Dari meja makan, sepupuku menatapku dengan senyum setengah yang tidak pernah benar-benar sampai ke kedua matanya.',
    '“Kamu masih curiga terus ya Ran—padahal Ibu sudah capek banget ngurusin semuanya sendirian dari pemakaman.”',

    // KONFLIK AWAL
    '“Aku cuma tanya siapa yang mengurus wasiat Ayah—kenapa itu bikin semua orang di meja ini gelisah?”',
    'Ia tertawa pendek, lalu mengetuk meja dengan kuku jari telunjuk seolah menandai setiap tuduhan yang belum diucapkan.',
    '“Dasar anak kota—semua urusan mau dibawa ke notaris, ke dokumen, ke tanda tangan, biar kelihatan hebat.”',
    'Aku meletakkan gelas lebih keras dari yang kumaksud, dan bunyinya memotong tawa sepupuku di tengah jalan.',
    'Ibu masuk dari pintu belakang dengan celemek masih basah dan wajah yang sudah disiapkan untuk damai di meja.',
    '“Sudah—makan dulu Rani. Jangan bikin suasana dapur lebih berat dari masakan Ibu yang bahkan belum matang.”',
    'Aku tidak duduk meskipun kursi di depanku kosong dan masih menyisakan hangat dari punggung seseorang.',
    '“Pak Hendra menolak bertemu tanpa janji Bu—suaranya gemetar di telepon seperti orang yang disuruh tutup mulut.”',
    'Sendok jatuh dari tangan sepupuku dan mendenting nyaring di lantai ubin yang dingin karena hujan tadi malam.',

    // DIALOG / KONFRONTASI
    'Ibu menunduk pelan dan mengambil sendok itu dari lantai seperti dunia bisa dirapikan hanya dengan gerakan kecil.',
    '“Notaris sibuk Rani—orang seperti Pak Hendra memang banyak klien di kota, bukan cuma keluarga kita yang kecil.”',
    '“Sibuk, atau disuruh diam oleh seseorang di meja ini yang takut pada satu pertanyaan sederhana dariku?”',
    'Semua mata menoleh—bahkan Dimas yang berdiri di ambang pintu dapur tanpa berani masuk sepenuhnya sejak tadi.',
    '“Kamu keterlaluan,” desis sepupuku sambil bangkit dari kursi dan menggesernya kasar di atas ubin yang licin.',
    '“Dia baru datang dua hari dan sudah berani nuduh keluarga sendiri seperti kita ini maling warisan!”',
    '“Aku tidak bilang maling—aku hanya tanya kenapa notaris keluarga tiba-tiba tidak bisa ditemui sejak aku pulang.”',
    'Ibu mengangkat tangan kanannya dengan pelan, dan seluruh meja kembali sunyi—hanya suara kulkas tua berdengung.',
    'Sepupuku masih berdiri dengan napas memburu, tapi ia tidak berani melanjutkan kalimatnya di depan Ibu yang sudah mengangkat tangan.',
    'Dimas—yang sejak tadi diam—tiba-tiba melangkah setapak ke dalam dapur dan menyentuh lenganku dengan ujung jarinya.',
    '“Mbak,” bisiknya nyaris tanpa suara, “nanti aku cerita—tapi jangan di sini, jangan di depan Ibu.”',
    'Aku menoleh dan menangkap tatapannya yang penuh peringatan—bukan ancaman, tapi permohonan dari seseorang yang juga terjebak.',
    'Aku mengangguk kecil, terlalu kecil untuk dilihat Ibu, tapi cukup besar untuk membuat Dimas menarik tangannya kembali.',
    '“Cukup kalian semua—Rani capek dari perjalanan jauh, kalian juga capek. Makan dulu baru kita bicara.”',
    'Aku menatap piring kosong di hadapanku, lalu menatap Ibu yang tetap tidak menatapku balik sejak tadi pagi.',
    '“Bu—aku cuma mau tahu apa isi wasiat Ayah. Itu hakku sebagai anak kandungnya, kan?”',
    'Ibu menghela napas panjang dan meletakkan sendok kayu di atas meja dengan gerakan yang sangat pelan.',
    '“Nanti. Bukan sekarang saat kamu masih penuh curiga seperti ini—ada waktunya untuk semua itu nanti.”',
    '“Kalau memang tidak ada yang disembunyikan, kenapa waktunya tidak sekarang saja di meja ini?”',
    'Ibu tidak langsung menjawab—ia menatap jendela yang mulai diguyur hujan, seolah menghitung sesuatu di kepalanya.',
    'Aku bisa melihat kerut di dahinya semakin dalam, dan untuk pertama kalinya, aku melihat Ibu ragu di depanku.',
    '“Kamu tidak akan mengerti sekarang, Rani—tapi semua yang Ibu lakukan selama ini, Ibu lakukan untuk keluarga ini.”',

    // REVEAL / EMOSI
    'Pertanyaan itu menggantung di atas meja lebih lama dari yang kuduga—tidak ada yang berani menjawab dulu, bahkan sepupuku yang biasanya paling cepat bicara.',
    'Sepupuku duduk kembali dengan muka merah padam dan mata yang jelas menghindari gelas serta piring di hadapannya, seolah benda-benda dapur itu bisa menyelamatkannya dari pertanyaan-pertanyaanku.',
    'Dimas—yang sejak tadi hanya diam di ambang pintu seperti patung kayu—menggigit bibir bawahnya sendiri dan menatapku dengan sorot mata yang seolah berteriak bahwa dia ingin mengatakan sesuatu yang sudah terlalu lama disimpan.',
    'Tapi ia tidak bicara apapun karena Ibu masih berdiri di antara kami semua dengan celemek basah dan senyum tipis.',
    'Aku mengepal pinggiran meja kayu sampai buku-buku jariku memutih dan rasa sakit mulai menusuk di setiap sendi, sementara aku ingat Ayah pernah bilang: kebenaran selalu punya harga, kau tinggal pilih mau bayar sekarang atau nanti, Ran.',

    // CLIFFHANGER
    'Aku menghembuskan napas pelan-pelan dan menatap jendela dapur yang mulai diguyur hujan pagi yang semakin deras.',
    'Tik, tik, tik—seperti hitungan mundur yang tidak ada satupun dari mereka berani menyebutkan angka terakhirnya.',
    'Aku bisa terus mendesak di meja ini, atau aku bisa menggali lewat Dimas tanpa ribut di depan semua orang.',
    'Dimas—yang masih berdiri di ambang pintu—menangkap tatapanku, dan kali ini dia tidak menunduk lebih dulu.',
    'Hujan semakin deras di kaca jendela, menenggelamkan suara kulkas dan denting piring yang sudah tidak ada lagi.',
    'Aku tahu besok pagi aku harus memilih dengan jelas: Hendra dulu, atau Dimas dulu—dua jalan yang punya risiko dan harga yang sangat berbeda.',
  ]
}

export function buildHandcraftChapter(chapterNumber: 1 | 2 | 3): HandcraftChapter {
  const beat = getDemoBeat(chapterNumber)
  const coreMap: Record<1 | 2 | 3, () => string[]> = {
    1: coreCh1,
    2: coreCh2,
    3: coreCh3,
  }
  const paragraphs = coreMap[chapterNumber]()

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
