/**
 * Seed premium Lakoku - Bilik Ketujuh V2.
 *
 * Tujuan versi ini:
 * - Mengganti draft lama yang terlalu padat/sastra menjadi rasa baca serial: cepat, emosional, dialogis.
 * - Menyediakan Bab 1-3 full 800-1000 kata sebagai sampel produksi.
 * - Menyediakan 50 blueprint agar arah novel tetap utuh sebelum lanjut batch bab berikutnya.
 * - Route tetap disimpan sebagai metadata; label yang tampil ke pembaca dibuat natural, bukan istilah developer.
 */
import type {
  CanonSnapshot,
  ChapterBlueprint,
  ChapterDraft,
  Character,
} from '@/lib/narrative/types'

export const PREMIUM_BILIK_KETUJUH_V2_STORY_ID = 'premium:bilik-ketujuh-v2'

export type PremiumBilikKetujuhRouteId = 'truth_route' | 'obedience_route' | 'escape_route'

export const PREMIUM_BILIK_KETUJUH_V2_ROUTE_MAP = {
  storyId: PREMIUM_BILIK_KETUJUH_V2_STORY_ID,
  title: 'Bilik Ketujuh',
  subtitle: 'Rahasia ibunya dikunci di kamar yang dilarang dibuka.',
  genre: ['misteri', 'drama keluarga', 'pesantren', 'romansa tipis'],
  premium: true,
  targetChapterWordCount: { min: 800, max: 1000 },
  structure: {
    totalChapters: 50,
    currentFullDraftChapters: [1, 2, 3],
    branchingModel: 'converging_branch',
    majorChoiceChapters: [1, 6, 14, 28, 45],
  },
  routes: [
    {
      id: 'truth_route',
      internalLabel: 'Rute Kebenaran',
      readerPromise: 'Naya lebih berani membuka bukti, tetapi cepat menjadi musuh banyak orang.',
    },
    {
      id: 'obedience_route',
      internalLabel: 'Rute Kepatuhan Strategis',
      readerPromise: 'Naya tampak patuh untuk memancing orang dewasa lengah.',
    },
    {
      id: 'escape_route',
      internalLabel: 'Rute Bukti Luar',
      readerPromise: 'Naya mengamankan bukti ke luar pesantren, tetapi kehilangan akses ke dalam.',
    },
  ],
  choiceGates: {
    1: {
      prompt: 'Kunci Bilik Ketujuh ada di tangan Naya. Apa yang harus ia lakukan malam ini?',
      choices: [
        {
          id: 'open_now',
          label: 'Buka pintunya sekarang, sebelum Marwah kembali.',
          route: 'truth_route',
          nextChapter: 2,
          stateDelta: { route_truth: true, naya_keeps_black_key: true, naya_attempts_bilik_opening: true },
        },
        {
          id: 'pretend_obey',
          label: 'Pura-pura menurut, lalu perhatikan siapa yang panik.',
          route: 'obedience_route',
          nextChapter: 2,
          stateDelta: { route_obedience: true, naya_hides_intent: true, marwah_thinks_naya_obeys: true },
        },
        {
          id: 'hide_key_outside',
          label: 'Sembunyikan kunci di luar asrama dan cari Hafiz.',
          route: 'escape_route',
          nextChapter: 2,
          stateDelta: { route_escape: true, key_hidden_outside_asrama: true, naya_seeks_hafiz: true },
        },
      ],
    },
    6: {
      prompt: 'Naya menemukan buku tamu lama berisi nama ibunya. Siapa yang harus ia hadapi dulu?',
      choices: [
        { id: 'face_marwah', label: 'Desak Marwah bicara di ruang pengurus.', route: 'truth_route', nextChapter: 7 },
        { id: 'follow_rules', label: 'Ikuti sidang santri dan biarkan mereka merasa menang.', route: 'obedience_route', nextChapter: 7 },
        { id: 'send_copy', label: 'Foto halaman buku tamu dan kirim ke orang luar.', route: 'escape_route', nextChapter: 7 },
      ],
    },
    14: {
      prompt: 'Saksi pertama bersedia bicara, tetapi hanya jika Naya datang sendirian.',
      choices: [
        { id: 'come_alone', label: 'Datang sendiri dan rekam semua pengakuannya.', route: 'truth_route', nextChapter: 15 },
        { id: 'bring_marwah', label: 'Ajak Marwah agar kebohongannya diuji langsung.', route: 'obedience_route', nextChapter: 15 },
        { id: 'bring_salma', label: 'Ajak Salma dan siapkan jalan kabur.', route: 'escape_route', nextChapter: 15 },
      ],
    },
    28: {
      prompt: 'Dokumen wakaf asli muncul, tetapi satu tanda tangan bisa menghancurkan keluarga Salma.',
      choices: [
        { id: 'publish_document', label: 'Sebarkan dokumen itu malam ini.', route: 'truth_route', nextChapter: 29 },
        { id: 'negotiate_time', label: 'Tahan dokumen itu dan paksa pengurus membuat pengakuan tertulis.', route: 'obedience_route', nextChapter: 29 },
        { id: 'move_witness', label: 'Selamatkan saksi dulu, dokumen menyusul.', route: 'escape_route', nextChapter: 29 },
      ],
    },
    45: {
      prompt: 'Di depan semua wali santri, Naya harus memilih cara membuka rahasia terakhir.',
      choices: [
        { id: 'public_confession', label: 'Minta semua pelaku mengaku di depan wali santri.', route: 'truth_route', nextChapter: 46 },
        { id: 'legal_record', label: 'Serahkan bukti ke notaris dan pengurus yayasan.', route: 'obedience_route', nextChapter: 46 },
        { id: 'save_laila_name', label: 'Bawa nama Laila keluar sebelum pesantren menutup kasus lagi.', route: 'escape_route', nextChapter: 46 },
      ],
    },
  },
} as const

const characters: Character[] = [
  {
    id: 'char:naya',
    storyId: PREMIUM_BILIK_KETUJUH_V2_STORY_ID,
    canonicalName: 'Naya',
    role: 'protagonis',
    motivation: 'Mencari alasan kematian ibunya dan membuktikan bahwa Laila bukan perempuan pembawa aib.',
    introducedChapter: 1,
    status: 'ALIVE',
  },
  {
    id: 'char:laila',
    storyId: PREMIUM_BILIK_KETUJUH_V2_STORY_ID,
    canonicalName: 'Laila',
    role: 'ibu Naya dan pusat misteri',
    motivation: 'Meninggalkan petunjuk agar Naya kelak bisa membuka kebenaran.',
    introducedChapter: 1,
    status: 'DEAD',
  },
  {
    id: 'char:ustazah-marwah',
    storyId: PREMIUM_BILIK_KETUJUH_V2_STORY_ID,
    canonicalName: 'Marwah',
    role: 'wali asrama yang menjaga Bilik Ketujuh',
    motivation: 'Menutup rahasia lama yang bisa meruntuhkan pesantren dan dirinya sendiri.',
    introducedChapter: 1,
    status: 'ALIVE',
  },
  {
    id: 'char:hafiz',
    storyId: PREMIUM_BILIK_KETUJUH_V2_STORY_ID,
    canonicalName: 'Hafiz',
    role: 'penjaga koperasi dan saksi masa lalu',
    motivation: 'Menebus kesalahan karena dulu tidak berani menolong Laila.',
    introducedChapter: 1,
    status: 'ALIVE',
  },
  {
    id: 'char:kyai-hamid',
    storyId: PREMIUM_BILIK_KETUJUH_V2_STORY_ID,
    canonicalName: 'Kyai Hamid',
    role: 'pengasuh pesantren',
    motivation: 'Mempertahankan nama pesantren meski harus membungkam orang-orang terluka.',
    introducedChapter: 2,
    status: 'ALIVE',
  },
  {
    id: 'char:salma',
    storyId: PREMIUM_BILIK_KETUJUH_V2_STORY_ID,
    canonicalName: 'Salma',
    role: 'teman lama Naya',
    motivation: 'Melindungi Naya sambil menyembunyikan keterlibatan keluarganya.',
    introducedChapter: 3,
    status: 'ALIVE',
  },
]

const aliases = [
  { characterId: 'char:naya', alias: 'Naya', aliasType: 'NAME' },
  { characterId: 'char:laila', alias: 'Laila', aliasType: 'NAME' },
  { characterId: 'char:ustazah-marwah', alias: 'Ustazah Marwah', aliasType: 'NAME' },
  { characterId: 'char:hafiz', alias: 'Pak Hafiz', aliasType: 'NAME' },
  { characterId: 'char:kyai-hamid', alias: 'Kyai Hamid', aliasType: 'NAME' },
  { characterId: 'char:salma', alias: 'Salma', aliasType: 'NAME' },
] as CanonSnapshot['aliases']

const voiceSheets = [
  { characterId: 'char:naya', register: 'default', speechHabits: ['tajam', 'menahan emosi', 'langsung bertanya'], forbiddenWords: [], sampleLines: ['Kalau memang tidak ada yang disembunyikan, kenapa semua orang takut pada satu pintu?'] },
  { characterId: 'char:ustazah-marwah', register: 'default', speechHabits: ['halus', 'mengatur', 'menekan tanpa berteriak'], forbiddenWords: [], sampleLines: ['Di pesantren ini, anak baik tidak memaksa membuka perkara orang tua.'] },
] as CanonSnapshot['voiceSheets']

const facts = [
  {
    id: 'fact:kunci-hitam-v2',
    storyId: PREMIUM_BILIK_KETUJUH_V2_STORY_ID,
    statement: 'Naya menemukan kunci hitam bernomor tujuh di lipatan sajadah peninggalan Laila.',
    subjectCharacterId: 'char:naya',
    establishedChapter: 1,
    salience: 0.95,
    loadBearing: true,
    paidOff: false,
  },
  {
    id: 'fact:bilik-ketujuh-dilarang',
    storyId: PREMIUM_BILIK_KETUJUH_V2_STORY_ID,
    statement: 'Bilik Ketujuh dilarang dibuka sejak malam Laila dibawa keluar dari asrama.',
    subjectCharacterId: 'char:ustazah-marwah',
    establishedChapter: 1,
    salience: 0.95,
    loadBearing: true,
    paidOff: false,
  },
  {
    id: 'fact:hafiz-kenal-laila',
    storyId: PREMIUM_BILIK_KETUJUH_V2_STORY_ID,
    statement: 'Hafiz mengenal Laila dan tahu cara membuka pintu gudang koperasi lama.',
    subjectCharacterId: 'char:hafiz',
    establishedChapter: 2,
    salience: 0.75,
    loadBearing: true,
    paidOff: false,
  },
] as CanonSnapshot['facts']

const knowledge = [] as CanonSnapshot['knowledge']

const secrets = [
  { id: 'secret:laila-not-disgraced', description: 'Laila tidak kabur karena aib; ia membawa bukti pemalsuan data santri dan wakaf.', revealGateChapter: 10, revealed: false },
  { id: 'secret:arman-alive', description: 'Ayah Naya masih hidup dengan identitas lain di sekitar pesantren.', revealGateChapter: 24, revealed: false },
  { id: 'secret:marwah-protected-naya', description: 'Marwah ikut menutup kasus, tetapi sebagian tindakannya dulu menyelamatkan bayi Naya.', revealGateChapter: 44, revealed: false },
  { id: 'secret:bilik-seventh-ledger', description: 'Bilik Ketujuh menyimpan salinan catatan asli yang membuktikan pemindahan anak-anak dan tanah wakaf.', revealGateChapter: 50, revealed: false },
] as CanonSnapshot['secrets']

const threads = [
  { id: 'thread:bilik-ketujuh', title: 'Rahasia Bilik Ketujuh', status: 'OPEN', openedChapter: 1, lastTouchedChapter: 1, payoffWindow: null, isMainMystery: true },
  { id: 'thread:nama-laila', title: 'Pemulihan nama Laila', status: 'OPEN', openedChapter: 1, lastTouchedChapter: 1, payoffWindow: null, isMainMystery: true },
] as CanonSnapshot['threads']

const actRollups = [
  { actNumber: 1, coversFromChapter: 1, coversToChapter: 10, summary: 'Naya kembali ke pesantren ibunya, menemukan kunci Bilik Ketujuh, dan sadar bahwa kisah Laila sengaja dipelintir.', stateDelta: {} },
] as CanonSnapshot['actRollups']

type FullChapterSpec = {
  chapterNumber: number
  title: string
  phase: string
  chapterGoal: string
  mandatoryBeats: string[]
  paragraphs: string[]
  sceneCount: number
  cast: string[]
  reveals: string[]
  proposedStateDelta: Record<string, unknown>
  newNamedCharacters: string[]
  dialogue: string[]
  emotionBeats: string[]
  threadIds: string[]
}

type BlueprintOnlySpec = {
  chapterNumber: number
  title: string
  phase: string
  chapterGoal: string
  mandatoryBeats: string[]
  proposedStateDelta: Record<string, unknown>
  newNamedCharacters: string[]
}

const fullChapterSpecs: FullChapterSpec[] = [
  {
    chapterNumber: 1,
    title: 'Kunci di Lipatan Sajadah',
    phase: 'hook',
    chapterGoal: 'Naya menemukan kunci hitam Bilik Ketujuh dan dipaksa memilih cara pertama menghadapi larangan Marwah.',
    mandatoryBeats: ['Naya kembali ke asrama ibunya', 'kunci hitam ditemukan', 'Marwah melarang Naya membuka Bilik Ketujuh', 'Hafiz memberi isyarat agar Naya tidak menyerahkan bukti begitu saja'],
    paragraphs: [
      `Ketukan itu datang dari dalam lemari.` ,
      `Naya baru saja menaruh tas di lantai kamar ketika bunyi pelan itu membuat tangannya berhenti. Tok. Tok. Tok. Bukan dari pintu. Bukan dari jendela. Dari lemari kayu tua di sudut kamar, lemari yang cat cokelatnya sudah mengelupas dan baunya seperti kapur barus basah. Semua santri baru sudah turun ke musala sejak lima menit lalu. Kamar itu seharusnya kosong. Hanya ada Naya, kasur tipis, dan sajadah lusuh peninggalan ibunya yang tadi diberikan pengurus dengan wajah terlalu kaku.` ,
      `Naya menelan ludah. Ia tidak percaya hantu. Setidaknya, ia selalu mengatakan begitu pada dirinya sendiri. Tapi malam pertama di Pesantren Darul Safa membuat keyakinan itu terasa murahan. Lampu lorong berkedip. Angin masuk dari celah jendela. Di dinding, foto para alumni perempuan berjilbab putih menatap lurus, seolah mereka tahu sesuatu yang tidak boleh dikatakan.` ,
      `Tok. Tok.` ,
      `Naya melangkah mendekat. Ujung jarinya baru menyentuh gagang lemari ketika suara perempuan terdengar dari belakang.` ,
      `Jangan dibuka.` ,
      `Naya menoleh cepat. Ustazah Marwah berdiri di ambang pintu. Tubuhnya kecil, wajahnya tenang, tapi matanya membuat Naya merasa seperti anak yang baru tertangkap mencuri.` ,
      `Saya cuma mau lihat isinya, jawab Naya.` ,
      `Kamar ini bekas kamar ibumu. Bukan berarti semua peninggalannya harus kamu bongkar malam ini.` ,
      `Kata ibuku, barang yang disimpan terlalu lama biasanya bukan kenangan. Biasanya bukti.` ,
      `Wajah Marwah berubah sedikit. Sangat sedikit, tetapi Naya melihatnya. Seperti kain putih yang terkena setitik kopi.` ,
      `Marwah masuk tanpa meminta izin. Ia mengambil sajadah lusuh dari atas kasur dan menepuk-nepuknya, seolah sedang mencari debu. Naya memperhatikan gerak tangannya. Terlalu cepat. Terlalu hafal. Saat lipatan sajadah terbuka, sebuah benda kecil jatuh ke lantai.` ,
      `Ting.` ,
      `Kunci hitam.` ,
      `Naya lebih dulu membungkuk, tetapi Marwah menginjak ujung sajadah, menahan geraknya. Untuk beberapa detik mereka sama-sama diam. Di gagang kunci itu ada angka yang tergores kasar: 7.` ,
      `Itu punya siapa? tanya Naya.` ,
      `Bukan urusanmu.` ,
      `Kalau bukan urusan saya, kenapa disimpan di sajadah ibu saya?` ,
      `Marwah menatapnya. Nada suaranya tetap pelan saat berkata, Di pesantren ini, anak baik tidak memulai malam pertama dengan membongkar luka orang tua.` ,
      `Naya tersenyum tipis. Anak baik juga tidak dibohongi soal kematian ibunya.` ,
      `Kali ini Marwah tidak langsung menjawab. Dari luar kamar terdengar suara sandal berhenti. Seorang laki-laki tua berdiri di lorong sambil membawa keranjang mukena. Naya mengenalnya dari foto lama yang pernah disimpan ibunya di dompet: Hafiz, penjaga koperasi pesantren. Wajahnya lebih kurus sekarang, tapi matanya sama. Mata orang yang terlalu lama menyimpan permintaan maaf.` ,
      `Hafiz melihat kunci itu. Tangannya gemetar sedikit.` ,
      `Ustazah, katanya pelan, bel tanda jamaah sudah kedua.` ,
      `Saya tahu, jawab Marwah tanpa menoleh.` ,
      `Hafiz menatap Naya sekilas. Bukan tatapan biasa. Tatapan itu jatuh ke kunci, lalu ke saku gamis Naya, lalu ke jendela yang menghadap halaman belakang. Cepat. Hampir tidak terlihat. Tapi Naya mengerti satu hal: laki-laki itu menyuruhnya menyembunyikan kunci.` ,
      `Marwah membungkuk untuk mengambil benda itu. Naya bergerak lebih dulu. Ia menyambar kunci, menggenggamnya erat, lalu memasukkannya ke balik lengan baju.` ,
      `Naya, suara Marwah menegang.` ,
      `Saya mau salat dulu, Ustazah.` ,
      `Serahkan.` ,
      `Kenapa?` ,
      `Karena kunci itu membuka ruangan yang sudah dikunci sejak sebelum kamu lahir.` ,
      `Ruangan apa?` ,
      `Marwah menutup mata sebentar. Ketika membukanya, wajahnya kembali rapi. Bilik Ketujuh.` ,
      `Nama itu membuat Hafiz menunduk. Membuat udara di kamar seperti turun beberapa derajat. Naya pernah mendengar nama itu sekali, dari ibunya yang mengigau seminggu sebelum meninggal. Jangan masuk Bilik Ketujuh, Nay. Kalau kamu masuk, jangan percaya orang yang menangis paling keras.` ,
      `Saat itu Naya mengira ibunya bicara karena obat. Sekarang ia tidak yakin.` ,
      `Di mana bilik itu?` ,
      `Tidak ada lagi, jawab Marwah terlalu cepat.` ,
      `Hafiz batuk kecil.` ,
      `Naya menoleh padanya. Marwah juga. Laki-laki itu langsung pura-pura merapikan mukena dalam keranjang, tetapi telinganya memerah.` ,
      `Berarti masih ada, kata Naya.` ,
      `Marwah melangkah mendekat. Untuk pertama kalinya, suaranya turun menjadi bisikan. Kamu tidak tahu apa yang kamu injak, Nak. Ibumu hancur karena tidak mau berhenti bertanya.` ,
      `Naya merasakan dadanya panas. Jangan bicara seolah Ibu saya salah karena ingin tahu.` ,
      `Yang salah kadang bukan pertanyaannya, tapi waktunya.` ,
      `Kalau begitu, malam ini waktunya.` ,
      `Bel musala berbunyi lagi, panjang dan nyaring. Marwah menahan napas. Ia jelas ingin merebut kunci itu, tetapi kehadiran Hafiz di lorong membuatnya berhitung. Akhirnya ia mundur setengah langkah.` ,
      `Setelah salat, kamu datang ke kantor pengurus. Sendiri. Jangan bicara pada siapa pun tentang kunci itu.` ,
      `Dan kalau saya bicara?` ,
      `Mata Marwah dingin. Orang-orang akan bertanya kenapa anak Laila kembali hanya untuk membuat keributan.` ,
      `Nama ibunya dilempar seperti batu. Naya menggenggam kunci sampai geriginya menusuk telapak tangan. Ia ingin marah, tapi Hafiz kembali memberi isyarat kecil. Kali ini lebih jelas: telunjuknya menunjuk ke bawah, ke halaman belakang. Lalu ia pergi seolah tidak pernah ikut campur.` ,
      `Marwah menyusul keluar. Di depan pintu, ia berhenti. Lemari itu jangan disentuh. Apalagi pintu di ujung lorong.` ,
      `Pintu apa?` ,
      `Tapi Marwah sudah berjalan pergi.` ,
      `Naya menunggu sampai langkahnya hilang. Lalu ia keluar kamar. Lorong asrama hampir kosong. Di ujung lorong, melewati jemuran mukena dan rak sandal, ada pintu sempit yang tertutup kain hijau. Tidak ada tulisan. Tidak ada gembok. Hanya angka 7 yang dipaku terbalik di atas kusennya.` ,
      `Dari balik pintu itu, terdengar ketukan yang sama.` ,
      `Tok. Tok. Tok.` ,
      `Lalu suara perempuan, serak dan lemah, memanggil nama ibunya.` ,
      `Laila?`,
    ],
    sceneCount: 4,
    cast: ['char:naya', 'char:ustazah-marwah', 'char:hafiz', 'char:laila'],
    reveals: [],
    proposedStateDelta: { naya_finds_black_key: true, bilik_seven_confirmed_exists: true },
    newNamedCharacters: ['char:naya', 'char:laila', 'char:ustazah-marwah', 'char:hafiz'],
    dialogue: ['Jangan dibuka.', 'Kalau bukan urusan saya, kenapa disimpan di sajadah ibu saya?', 'Ibumu hancur karena tidak mau berhenti bertanya.'],
    emotionBeats: ['takut berubah menjadi curiga', 'marah saat nama Laila dipakai menekan', 'penasaran mengalahkan kepatuhan'],
    threadIds: ['thread:bilik-ketujuh', 'thread:nama-laila'],
  },
  {
    chapterNumber: 2,
    title: 'Nama yang Dicoret',
    phase: 'rising_mystery',
    chapterGoal: 'Naya melihat cara pengurus mengontrol cerita tentang Laila dan menemukan catatan bahwa nama ayahnya pernah dicoret dari arsip.',
    mandatoryBeats: ['Naya dipanggil ke kantor pengurus', 'Kyai Hamid muncul sebagai sosok lembut tapi menekan', 'Hafiz memberi petunjuk koperasi', 'Naya menemukan nama Arman dicoret dari buku lama'],
    paragraphs: [
      `Naya tidak pergi ke kantor pengurus setelah salat.` ,
      `Ia tahu itu keputusan bodoh. Anak baru, malam pertama, sudah melawan panggilan ustazah. Tapi ada suara perempuan dari balik pintu bernomor tujuh, dan suara itu menyebut nama ibunya. Tidak ada aturan yang lebih penting dari itu.` ,
      `Masalahnya, pintu itu tidak mau terbuka.` ,
      `Kunci hitam masuk dengan pas. Terlalu pas sampai Naya sempat menahan napas. Namun ketika ia memutarnya, hanya terdengar bunyi klik kecil, lalu diam. Seperti ada kunci lain dari dalam. Ia mencoba sekali lagi. Gagal. Ketukan tadi pun berhenti. Lorong menjadi sunyi, terlalu sunyi, membuat Naya merasa justru dirinyalah yang sedang diawasi dari balik dinding.` ,
      `Kamu keras kepala seperti dia.` ,
      `Naya berbalik. Hafiz berdiri di dekat tangga, kali ini tanpa keranjang mukena. Wajahnya pucat.` ,
      `Seperti siapa?` ,
      `Hafiz tidak menjawab. Ia mendekat, lalu menekan pintu itu dengan telapak tangan. Jangan buka dari sini. Bilik ini punya dua mulut.` ,
      `Dua mulut?` ,
      `Satu untuk orang yang ingin masuk. Satu untuk orang yang ingin menghilangkan jejak.` ,
      `Kalimat itu membuat Naya kehilangan kata-kata. Hafiz seperti menyesal sudah bicara terlalu banyak. Ia menoleh ke tangga, memastikan tidak ada orang.` ,
      `Besok sebelum subuh, datang ke koperasi lama. Jangan lewat halaman utama. Lewat tempat wudu belakang.` ,
      `Saya harus percaya Bapak?` ,
      `Tidak. Justru jangan percaya siapa pun di sini. Termasuk saya.` ,
      `Lalu ia pergi.` ,
      `Naya baru kembali ke kamar ketika pengeras suara memanggil namanya. Bukan sekali. Tiga kali. Suara santri yang membaca pengumuman terdengar gemetar, seolah ikut takut pada nama yang harus diucapkannya.` ,
      `Naya binti Laila diminta menghadap kantor pengurus sekarang.` ,
      `Binti Laila. Bukan binti Arman, nama ayah yang tertulis di akta lahirnya. Di pesantren ini, bahkan panggilan pun bisa menjadi hukuman.` ,
      `Kantor pengurus berada di samping rumah kyai. Lampunya terang, lantainya bersih, dindingnya penuh piagam. Di ruangan itu Naya melihat Marwah duduk dengan map hijau di pangkuan. Di sebelahnya, seorang lelaki sepuh bersorban putih tersenyum lembut.` ,
      `Kyai Hamid.` ,
      `Naya pernah melihat fotonya di brosur pesantren. Pengasuh Darul Safa. Suaranya di video kajian selalu teduh. Malam itu, keteduhan itu terasa seperti selimut tebal yang bisa dipakai untuk membekap orang.` ,
      `Duduk, Nak.` ,
      `Naya duduk.` ,
      `Kyai Hamid menatapnya lama. Ibumu santri yang cerdas.` ,
      `Kenapa semua orang selalu mulai dari kalimat itu? tanya Naya.` ,
      `Marwah mengangkat wajah. Naya.` ,
      `Tidak apa-apa, Marwah, kata Kyai Hamid. Anak yang kehilangan ibu memang sering membawa duri di lidahnya.` ,
      `Naya meremas ujung rok. Kalau Ibu saya cerdas, kenapa namanya seperti penyakit di tempat ini?` ,
      `Senyum Kyai Hamid tidak hilang. Karena tidak semua luka perlu dibuka di depan anaknya.` ,
      `Saya bukan anak kecil.` ,
      `Justru karena itu kami ingin kamu menjaga diri. Darul Safa menerima kamu bukan untuk mengulang kesalahan Laila.` ,
      `Kesalahan apa?` ,
      `Ruangan itu hening.` ,
      `Marwah membuka map hijau. Di dalamnya ada fotokopi formulir pendaftaran Naya, surat kematian Laila, dan selembar pernyataan yang sudah disiapkan. Naya membaca sekilas. Isinya sederhana: ia mengaku menemukan kunci lama, menyerahkannya kepada pengurus, dan berjanji tidak menyebarkan cerita yang merugikan pesantren.` ,
      `Tanda tangan di sini, kata Marwah.` ,
      `Naya tertawa kecil. Saya baru satu jam di sini, sudah disuruh tanda tangan surat bungkam?` ,
      `Ini surat ketertiban.` ,
      `Namanya boleh diperhalus. Isinya tetap takut.` ,
      `Kyai Hamid menghela napas. Laila dulu juga begitu. Selalu mengira keberanian sama dengan kebenaran.` ,
      `Naya menatapnya. Untuk pertama kali malam itu, ia merasa takut bukan karena pintu atau suara dari balik bilik. Ia takut karena orang-orang di depannya tampak terlalu yakin bahwa mereka berhak menentukan versi hidup ibunya.` ,
      `Saya mau membaca surat ini dulu.` ,
      `Boleh. Di sini.` ,
      `Naya menunduk seolah membaca. Padahal matanya mencari jalan. Di luar jendela, dekat pohon belimbing, Hafiz berdiri sebentar. Ia mengangkat tangan ke dada, lalu menunjuk ke arah belakang kantor. Isyarat yang sama: lewat belakang.` ,
      `Naya mengembalikan surat itu tanpa tanda tangan. Saya butuh wudu.` ,
      `Marwah menyipit. Wudu?` ,
      `Iya. Biar kalau saya dipaksa bohong, setidaknya saya masih punya malu.` ,
      `Wajah Marwah memerah. Kyai Hamid tertawa pelan, tetapi tawanya tidak sampai ke mata. Lima menit.` ,
      `Naya keluar dengan langkah biasa. Begitu sampai belokan, ia berlari.` ,
      `Tempat wudu belakang gelap dan licin. Hafiz sudah menunggu di pintu kecil yang hampir tertutup rak galon. Ia membukanya dengan kunci perak. Di balik pintu itu ada ruangan sempit penuh karung beras, dus sabun, dan rak buku tua.` ,
      `Koperasi lama, bisik Hafiz. Dulu ibumu sering menjaga di sini.` ,
      `Naya menatap rak paling bawah. Ada buku besar bersampul cokelat. Hafiz tidak menyentuhnya, hanya memberi lampu senter.` ,
      `Cari tahun kelahiranmu.` ,
      `Tangan Naya dingin saat membuka halaman demi halaman. Nama santri, nama wali, alamat, catatan pembayaran. Lalu ia menemukannya. Laila Safitri. Di bawahnya ada tulisan bayi perempuan. Naya.` ,
      `Kolom ayah di sebelahnya pernah diisi. Tapi nama itu dicoret berkali-kali sampai hampir bolong.` ,
      `Naya mendekatkan senter. Di balik coretan hitam, masih tersisa dua huruf depan.` ,
      `Ar.` ,
      `Arman, bisik Naya.` ,
      `Nama itu membuat perutnya seperti dijatuhkan. Selama ini Arman hanya hidup sebagai foto kabur di laci ibunya dan tanda tangan di akta. Laila tidak pernah menjelekkan lelaki itu, tapi juga tidak pernah menjelaskan kenapa Naya tumbuh tanpa ayah. Sekarang, di buku tua pesantren, nama itu bukan hilang. Nama itu sengaja dilukai.` ,
      `Siapa yang mencoret ini?` ,
      `Hafiz langsung mematikan senter.` ,
      `Dari luar pintu, suara Marwah terdengar sangat dekat.` ,
      `Pak Hafiz. Buka pintunya. Saya tahu Naya ada di dalam.` ,
    ],
    sceneCount: 5,
    cast: ['char:naya', 'char:ustazah-marwah', 'char:hafiz', 'char:kyai-hamid'],
    reveals: [],
    proposedStateDelta: { naya_refuses_silence_letter: true, arman_name_crossed: true, koperasi_old_room_found: true },
    newNamedCharacters: ['char:kyai-hamid'],
    dialogue: ['Bilik ini punya dua mulut.', 'Saya baru satu jam di sini, sudah disuruh tanda tangan surat bungkam?', 'Pak Hafiz. Buka pintunya. Saya tahu Naya ada di dalam.'],
    emotionBeats: ['curiga terhadap kelembutan Kyai Hamid', 'marah pada surat bungkam', 'takut saat nama Arman muncul'],
    threadIds: ['thread:bilik-ketujuh', 'thread:nama-laila'],
  },
  {
    chapterNumber: 3,
    title: 'Teman yang Pura-Pura Lupa',
    phase: 'rising_mystery',
    chapterGoal: 'Naya bertemu Salma, satu-satunya teman lama yang mengenal masa kecilnya, tetapi Salma menyembunyikan hubungan keluarganya dengan hilangnya Laila.',
    mandatoryBeats: ['Naya lolos dari koperasi lama', 'Salma muncul sebagai teman yang pura-pura tidak mengenal Naya', 'ada ancaman sosial di antara santri', 'Naya menemukan petunjuk lagu nina bobo Laila'],
    paragraphs: [
      `Hafiz tidak membuka pintu.` ,
      `Ia justru mendorong rak berisi dus sabun sampai bergeser sedikit. Di belakang rak itu ada lubang rendah, cukup untuk dilewati orang dewasa kalau mau merangkak dan mengorbankan harga diri.` ,
      `Masuk, bisiknya.` ,
      `Naya menatap lubang itu. Bapak bercanda?` ,
      `Kalau saya bercanda, saya pilih tempat yang tidak membuat lutut sakit.` ,
      `Di luar, Marwah mengetuk lagi. Pak Hafiz.` ,
      `Hafiz menatap Naya dengan wajah keras. Sekarang.` ,
      `Naya merangkak masuk. Bau tanah lembap langsung menyerang hidungnya. Lubang itu ternyata lorong sempit di bawah panggung aula lama. Kayu di atas kepalanya berderit setiap kali ia bergerak. Dari celah papan, ia melihat kaki Marwah masuk ke koperasi. Melihat ujung gamis Hafiz. Mendengar suara mereka seperti datang dari dunia lain.` ,
      `Anak itu membawa tabiat ibunya, kata Marwah.` ,
      `Hafiz menjawab datar. Anak itu membawa mata ibunya. Itu yang membuat Ustazah takut.` ,
      `Jangan mulai.` ,
      `Saya belum mulai apa-apa. Dulu juga saya diam. Hasilnya apa? Laila pulang dalam kain kafan, dan kita semua disuruh lupa.` ,
      `Naya menutup mulutnya dengan tangan. Jantungnya memukul terlalu keras. Jadi Hafiz tahu. Marwah tahu. Semua orang dewasa tahu sesuatu tentang malam kematian ibunya, tetapi selama ini Naya hanya diberi cerita pendek: Laila sakit, Laila lemah, Laila tidak kuat menanggung malu.` ,
      `Malu apa? Siapa yang membuatnya malu?` ,
      `Langkah Marwah mendekat ke rak. Naya menahan napas.` ,
      `Kalau kau kasihan pada anak itu, jangan beri dia harapan palsu, Hafiz. Kebenaran tidak selalu menyelamatkan.` ,
      `Tidak. Tapi kebohongan selalu meminta korban baru.` ,
      `Ada jeda panjang. Lalu Marwah pergi.` ,
      `Hafiz menunggu sampai suara langkah benar-benar hilang. Ia membuka papan dari sisi lain dan menarik Naya keluar di belakang aula. Udara malam membuat Naya hampir menangis, bukan karena sedih, tapi karena akhirnya bisa bernapas.` ,
      `Pergi ke kamar, kata Hafiz. Jangan temui saya lagi beberapa hari.` ,
      `Bapak tahu ayah saya?` ,
      `Wajah Hafiz mengeras.` ,
      `Arman itu siapa?` ,
      `Hafiz memalingkan muka. Nama yang dicoret biasanya dicoret oleh orang yang takut nama itu kembali.` ,
      `Itu bukan jawaban.` ,
      `Untuk malam ini, itu jawaban paling aman.` ,
      `Naya ingin membantah, tapi Hafiz mengangkat tangan. Di telapak tangannya ada bekas luka memanjang, seperti pernah tersayat benda tajam. Luka itu tampak lama, namun Naya mendadak ingat cerita ibunya tentang seorang santri putra yang dulu menahan pintu dengan tangan kosong agar Laila sempat lari membawa bayi. Cerita itu selalu berhenti sebelum nama orangnya disebut.` ,
      `Bapak yang menolong Ibu?` ,
      `Hafiz menutup telapak tangannya. Saya yang terlambat menolong.` ,
      `Naya ingin menahannya, tetapi suara tawa santri terdengar dari arah aula. Sekelompok anak perempuan lewat membawa ember cucian. Mereka berhenti saat melihat Naya keluar dari balik panggung bersama Hafiz.` ,
      `Salah satu dari mereka tersenyum miring. Santri baru kok sudah keluyuran sama penjaga koperasi?` ,
      `Naya menegakkan tubuh. Kalau mulutmu mau dipakai fitnah, minimal tunggu besok. Aku masih capek.` ,
      `Anak-anak itu terdiam, lalu cekikikan. Hanya satu yang tidak tertawa. Seorang gadis berkerudung biru muda, wajahnya bulat, matanya gelisah. Ia menatap Naya seperti mengenalinya, lalu cepat-cepat menunduk.` ,
      `Naya mengenal wajah itu.` ,
      `Salma?` ,
      `Gadis itu membeku.` ,
      `Dulu kamu tinggal di sebelah kontrakan Ibu. Kamu yang suka minta mangga muda.` ,
      `Anak-anak lain langsung menoleh pada Salma. Salma tertawa kecil, terlalu dibuat-buat. Salah orang kali. Aku baru lihat dia malam ini.` ,
      `Kalimat itu memukul Naya lebih sakit daripada sindiran santri lain. Salma bukan sahabat dekat, tapi di masa kecil yang sempit, satu anak yang mau duduk bersamanya di teras sudah terasa seperti keluarga. Dan sekarang gadis itu memilih pura-pura lupa.` ,
      `Oh, kata Naya. Maaf. Mungkin aku salah.` ,
      `Ia berjalan meninggalkan mereka. Di belakangnya, tawa kembali terdengar. Tapi beberapa langkah kemudian, sesuatu mengenai tumitnya. Gulungan kertas kecil.` ,
      `Naya tidak langsung mengambilnya. Ia terus berjalan sampai belokan, baru menunduk. Kertas itu diikat benang biru. Di dalamnya ada tulisan pendek.` ,
      `Jangan sebut namaku. Mereka mengawasi anak Laila.` ,
      `Di bawah tulisan itu ada gambar kecil: bulan sabit dan angka tujuh.` ,
      `Naya menyimpan kertas itu di balik kaus kaki. Ia menoleh sekali lagi ke arah Salma. Gadis itu masih berdiri di dekat ember cucian, pura-pura ikut tertawa, tetapi tangannya memegang dada seperti orang yang takut jantungnya jatuh. Salah satu santri senior merangkul bahu Salma dan berbisik sesuatu. Wajah Salma langsung pucat. Saat itulah Naya paham: Salma bukan hanya pura-pura lupa. Salma sedang disuruh lupa.` ,
      `Di pesantren ini, orang tidak selalu berbohong karena jahat. Kadang karena ada ibu yang harus dilindungi, ayah yang punya utang, atau adik yang masih butuh biaya mondok. Naya benci memikirkan itu, karena membuat kebohongan Salma terasa lebih sulit dibenci.` ,
      `Saat ia sampai kamar, lampu sudah dimatikan. Para santri tidur berjajar. Ada yang mendengkur pelan, ada yang masih berbisik. Naya naik ke kasurnya tanpa suara.` ,
      `Ia ingin tidur. Tubuhnya lelah. Kepalanya penuh nama Arman, pintu dua mulut, surat bungkam, dan Salma yang pura-pura lupa.` ,
      `Lalu ia mendengar lagu itu.` ,
      `Pelan sekali. Hampir tertutup suara kipas angin. Lagu yang dulu dinyanyikan ibunya saat Naya demam.` ,
      `Tidurlah, anak pintu. Esok jangan jadi batu.` ,
      `Naya membuka mata.` ,
      `Tidak ada yang bergerak. Semua santri tampak tidur. Tapi suara itu jelas datang dari bawah kasurnya.` ,
      `Ia turun perlahan. Di lantai, tepat di bawah dipan, ada kotak seng kecil yang sebelumnya tidak ada. Tutupnya penyok. Di atasnya tertulis dengan spidol pudar:` ,
      `Untuk anak Laila, kalau ia cukup berani membenci ibunya dulu.` ,
      `Naya menyentuh tutup kotak itu. Dari dalam, terdengar suara rekaman tua berderak.` ,
      `Suara Laila.` ,
      `Nay, kalau kamu menemukan ini, jangan percaya Salma sepenuhnya.` ,
    ],
    sceneCount: 5,
    cast: ['char:naya', 'char:ustazah-marwah', 'char:hafiz', 'char:salma', 'char:laila'],
    reveals: [],
    proposedStateDelta: { salma_pretends_not_to_know_naya: true, hidden_audio_box_found: true, laila_warns_about_salma: true },
    newNamedCharacters: ['char:salma'],
    dialogue: ['Anak itu membawa mata ibunya. Itu yang membuat Ustazah takut.', 'Kalau mulutmu mau dipakai fitnah, minimal tunggu besok.', 'Nay, kalau kamu menemukan ini, jangan percaya Salma sepenuhnya.'],
    emotionBeats: ['terpojok secara sosial', 'dikhianati oleh teman lama', 'terguncang oleh suara Laila'],
    threadIds: ['thread:bilik-ketujuh', 'thread:nama-laila'],
  },
]

const blueprintSpecs: BlueprintOnlySpec[] = [
  { chapterNumber: 1, title: 'Kunci di Lipatan Sajadah', phase: 'hook', chapterGoal: 'Naya menemukan kunci hitam Bilik Ketujuh dan memilih langkah pertama.', mandatoryBeats: ['kunci ditemukan', 'Marwah melarang', 'Hafiz memberi isyarat'], proposedStateDelta: { naya_finds_black_key: true }, newNamedCharacters: ['char:naya', 'char:laila', 'char:ustazah-marwah', 'char:hafiz'] },
  { chapterNumber: 2, title: 'Nama yang Dicoret', phase: 'rising_mystery', chapterGoal: 'Naya melihat nama Arman dicoret dari arsip lama.', mandatoryBeats: ['surat bungkam', 'Kyai Hamid menekan', 'arsip koperasi lama'], proposedStateDelta: { arman_name_crossed: true }, newNamedCharacters: ['char:kyai-hamid'] },
  { chapterNumber: 3, title: 'Teman yang Pura-Pura Lupa', phase: 'rising_mystery', chapterGoal: 'Naya bertemu Salma dan menemukan rekaman Laila.', mandatoryBeats: ['Salma pura-pura lupa', 'kotak seng muncul', 'rekaman Laila memperingatkan Naya'], proposedStateDelta: { hidden_audio_box_found: true }, newNamedCharacters: ['char:salma'] },
  { chapterNumber: 4, title: 'Suara dari Kotak Seng', phase: 'rising_mystery', chapterGoal: 'Rekaman Laila memberi petunjuk pertama tentang daftar anak yang dipindahkan.', mandatoryBeats: ['rekaman diputar diam-diam', 'Naya mendengar nama-nama asing', 'satu nama cocok dengan santri senior'], proposedStateDelta: { laila_audio_names_children: true }, newNamedCharacters: [] },
  { chapterNumber: 5, title: 'Anak yang Hilang dari Absen', phase: 'rising_mystery', chapterGoal: 'Naya menemukan satu santri pernah dihapus dari buku absen.', mandatoryBeats: ['absen lama dicuri sesaat', 'nama anak hilang muncul', 'Salma memberi peringatan kedua'], proposedStateDelta: { missing_student_record_found: true }, newNamedCharacters: [] },
  { chapterNumber: 6, title: 'Buku Tamu Malam Jumat', phase: 'choice_gate', chapterGoal: 'Naya menemukan buku tamu lama dan harus memilih siapa yang dihadapi dulu.', mandatoryBeats: ['buku tamu lama ditemukan', 'nama Laila tercatat malam Jumat', 'choice gate kedua'], proposedStateDelta: { guestbook_found: true }, newNamedCharacters: [] },
  { chapterNumber: 7, title: 'Sidang Kecil untuk Anak Baru', phase: 'consequence', chapterGoal: 'Pilihan Naya berdampak pada posisi sosialnya di asrama.', mandatoryBeats: ['santri senior menekan', 'Marwah menjaga wajah', 'Naya kehilangan satu akses'], proposedStateDelta: { naya_social_pressure_rises: true }, newNamedCharacters: [] },
  { chapterNumber: 8, title: 'Jendela Koperasi Lama', phase: 'rising_mystery', chapterGoal: 'Hafiz menunjukkan jalur rahasia menuju sisi lain Bilik Ketujuh.', mandatoryBeats: ['jalur rahasia dipetakan', 'Hafiz menyebut utang pada Laila', 'Naya curiga Hafiz terlibat'], proposedStateDelta: { secret_path_mapped: true }, newNamedCharacters: [] },
  { chapterNumber: 9, title: 'Surat yang Tidak Pernah Dikirim', phase: 'rising_mystery', chapterGoal: 'Naya menemukan surat Laila untuk Arman yang tidak pernah sampai.', mandatoryBeats: ['surat Laila ditemukan', 'Arman disebut masih hidup', 'Marwah mengambil salinan'], proposedStateDelta: { laila_letter_to_arman_found: true }, newNamedCharacters: [] },
  { chapterNumber: 10, title: 'Aib yang Dipalsukan', phase: 'reveal_gate', chapterGoal: 'Reveal bahwa Laila tidak kabur karena aib, melainkan membawa bukti pemalsuan.', mandatoryBeats: ['secret:laila-not-disgraced terbuka', 'Naya marah pada cerita lama', 'Kyai Hamid mulai melihat Naya sebagai ancaman'], proposedStateDelta: { laila_disgrace_story_false: true }, newNamedCharacters: [] },
  { chapterNumber: 11, title: 'Perempuan di Balik Dinding', phase: 'rising_mystery', chapterGoal: 'Naya mendengar saksi perempuan yang pernah dikurung di sisi lain bilik.', mandatoryBeats: ['suara perempuan kembali', 'nama Rukmini muncul', 'Naya menemukan bekas makanan lama'], proposedStateDelta: { rukmini_name_seeded: true }, newNamedCharacters: [] },
  { chapterNumber: 12, title: 'Malam Tanpa Lampu', phase: 'thriller', chapterGoal: 'Asrama sengaja dipadamkan untuk mengambil kunci dari Naya.', mandatoryBeats: ['lampu padam', 'kunci hampir dicuri', 'Salma menyelamatkan Naya tapi menolak menjelaskan'], proposedStateDelta: { key_theft_attempted: true }, newNamedCharacters: [] },
  { chapterNumber: 13, title: 'Tukang Kebun yang Menunduk', phase: 'rising_mystery', chapterGoal: 'Naya bertemu tukang kebun yang bereaksi aneh saat mendengar nama Arman.', mandatoryBeats: ['tukang kebun muncul', 'bekas luka dikenali dari cerita Laila', 'Naya mendapat gelang lama'], proposedStateDelta: { arman_shadow_seeded: true }, newNamedCharacters: [] },
  { chapterNumber: 14, title: 'Saksi yang Minta Datang Sendiri', phase: 'choice_gate', chapterGoal: 'Saksi pertama meminta Naya datang sendiri dan pilihan route ketiga dibuat.', mandatoryBeats: ['saksi siap bicara', 'syarat berbahaya', 'choice gate ketiga'], proposedStateDelta: { witness_one_ready: true }, newNamedCharacters: [] },
  { chapterNumber: 15, title: 'Pengakuan di Ruang Jahit', phase: 'consequence', chapterGoal: 'Naya mendengar pengakuan pertama tentang pemindahan anak.', mandatoryBeats: ['ruang jahit dibuka', 'saksi bercerita setengah', 'saksi menghilang setelah bicara'], proposedStateDelta: { child_transfer_confession_partial: true }, newNamedCharacters: [] },
  { chapterNumber: 16, title: 'Daftar Bayi Tanpa Ayah', phase: 'reveal_gate', chapterGoal: 'Reveal daftar bayi yang ayahnya sengaja dihapus dari arsip.', mandatoryBeats: ['daftar bayi muncul', 'nama Naya ada di sana', 'Salma tahu lebih dulu'], proposedStateDelta: { father_records_erased: true }, newNamedCharacters: [] },
  { chapterNumber: 17, title: 'Doa yang Dipakai Mengancam', phase: 'drama', chapterGoal: 'Kyai Hamid memakai forum doa untuk menekan Naya secara halus.', mandatoryBeats: ['forum doa', 'sindiran publik', 'Naya hampir terpancing'], proposedStateDelta: { public_pressure_intensifies: true }, newNamedCharacters: [] },
  { chapterNumber: 18, title: 'Broker Tanah Wakaf', phase: 'rising_mystery', chapterGoal: 'Nama broker tanah masuk ke konflik utama.', mandatoryBeats: ['Jamal disebut', 'wakaf lama terhubung ke Bilik Ketujuh', 'dokumen hilang'], proposedStateDelta: { jamal_name_seeded: true }, newNamedCharacters: [] },
  { chapterNumber: 19, title: 'Tanda Tangan Laila', phase: 'rising_mystery', chapterGoal: 'Naya menemukan tanda tangan Laila dipalsukan.', mandatoryBeats: ['tanda tangan dibandingkan', 'Marwah ketahuan tahu bentuk asli', 'Naya menyimpan foto bukti'], proposedStateDelta: { forged_laila_signature_found: true }, newNamedCharacters: [] },
  { chapterNumber: 20, title: 'Salma dan Hutang Keluarganya', phase: 'relationship_turn', chapterGoal: 'Salma mengaku keluarganya pernah menerima uang tutup mulut.', mandatoryBeats: ['Salma menangis', 'ayah Salma terlibat', 'Naya merasa dikhianati'], proposedStateDelta: { salma_family_hush_money: true }, newNamedCharacters: [] },
  { chapterNumber: 21, title: 'Kamar yang Pernah Terbakar', phase: 'reveal_gate', chapterGoal: 'Reveal bahwa Bilik Ketujuh pernah dibakar untuk menghapus bukti.', mandatoryBeats: ['bekas arang ditemukan', 'foto lama cocok', 'Hafiz mengaku memadamkan api'], proposedStateDelta: { bilik_fire_revealed: true }, newNamedCharacters: [] },
  { chapterNumber: 22, title: 'Anak-Anak yang Berganti Nama', phase: 'rising_mystery', chapterGoal: 'Naya menemukan pola anak pindahan yang berganti nama.', mandatoryBeats: ['pola nama ditemukan', 'salah satu alumni bisa dilacak', 'Naya butuh akses luar'], proposedStateDelta: { renamed_children_pattern: true }, newNamedCharacters: [] },
  { chapterNumber: 23, title: 'Jejak ke Terminal Lama', phase: 'thriller', chapterGoal: 'Naya mengikuti petunjuk keluar pesantren ke terminal lama.', mandatoryBeats: ['izin keluar dipalsukan', 'Naya hampir tertangkap', 'tukang kebun menolong dari jauh'], proposedStateDelta: { terminal_old_lead_found: true }, newNamedCharacters: [] },
  { chapterNumber: 24, title: 'Ayah yang Tidak Mati', phase: 'reveal_gate', chapterGoal: 'Reveal bahwa Arman masih hidup dengan identitas lain.', mandatoryBeats: ['secret:arman-alive terbuka', 'Naya melihat bekas luka', 'Arman menolak mengaku dulu'], proposedStateDelta: { arman_alive_revealed: true }, newNamedCharacters: [] },
  { chapterNumber: 25, title: 'Bukan Saatnya Memanggil Ayah', phase: 'emotional_fallout', chapterGoal: 'Naya marah pada Arman yang hidup tetapi membiarkannya tumbuh tanpa ayah.', mandatoryBeats: ['konfrontasi emosional', 'Arman memberi alasan belum lengkap', 'Naya memilih tetap mencari bukti'], proposedStateDelta: { naya_anger_at_arman: true }, newNamedCharacters: [] },
  { chapterNumber: 26, title: 'Alumni yang Jadi Reporter', phase: 'rising_mystery', chapterGoal: 'Reporter alumni masuk sebagai opsi tekanan publik.', mandatoryBeats: ['Nadine muncul', 'bukti luar mulai aman', 'risiko skandal membesar'], proposedStateDelta: { nadine_reporter_contact: true }, newNamedCharacters: [] },
  { chapterNumber: 27, title: 'Harga Sebuah Berita', phase: 'dilemma', chapterGoal: 'Naya belajar bahwa membuka kasus ke publik bisa melukai korban lain.', mandatoryBeats: ['korban lain takut', 'Nadine meminta izin', 'Salma memohon waktu'], proposedStateDelta: { public_exposure_dilemma: true }, newNamedCharacters: [] },
  { chapterNumber: 28, title: 'Dokumen Wakaf Asli', phase: 'choice_gate', chapterGoal: 'Dokumen asli muncul tetapi bisa menghancurkan keluarga Salma.', mandatoryBeats: ['dokumen wakaf asli', 'tanda tangan ayah Salma', 'choice gate keempat'], proposedStateDelta: { original_waqf_document_found: true }, newNamedCharacters: [] },
  { chapterNumber: 29, title: 'Konsekuensi Satu Tanda Tangan', phase: 'consequence', chapterGoal: 'Pilihan Naya menimbulkan reaksi publik, pengurus, dan keluarga Salma.', mandatoryBeats: ['Salma terpukul', 'Marwah menawarkan kesepakatan', 'Jamal mulai bergerak'], proposedStateDelta: { salma_family_exposed_risk: true }, newNamedCharacters: [] },
  { chapterNumber: 30, title: 'Jamal Datang Saat Subuh', phase: 'thriller', chapterGoal: 'Broker tanah datang menekan pengurus dan mengancam Naya.', mandatoryBeats: ['Jamal muncul fisik', 'Kyai Hamid tampak takut', 'Naya melihat hubungan uang dan agama'], proposedStateDelta: { jamal_arrives: true }, newNamedCharacters: [] },
  { chapterNumber: 31, title: 'Pesan dari Nomor Tak Bernama', phase: 'thriller', chapterGoal: 'Naya menerima ancaman yang membuktikan bukti digitalnya diawasi.', mandatoryBeats: ['ancaman masuk', 'file cadangan hilang', 'Hafiz dicurigai'], proposedStateDelta: { digital_surveillance_threat: true }, newNamedCharacters: [] },
  { chapterNumber: 32, title: 'Pengurus yang Menjual Diam', phase: 'reveal_gate', chapterGoal: 'Reveal bahwa beberapa pengurus dibayar untuk menjaga cerita palsu Laila.', mandatoryBeats: ['bukti transfer lama', 'nama pengurus muncul', 'Marwah tidak ada di daftar penerima'], proposedStateDelta: { paid_silence_revealed: true }, newNamedCharacters: [] },
  { chapterNumber: 33, title: 'Marwah Tidak Ada di Daftar', phase: 'moral_complication', chapterGoal: 'Naya mulai ragu apakah Marwah murni pelaku atau penjaga rahasia yang lebih rumit.', mandatoryBeats: ['Marwah membantu diam-diam', 'Naya menolak percaya', 'petunjuk bayi Naya muncul'], proposedStateDelta: { marwah_complexity_seeded: true }, newNamedCharacters: [] },
  { chapterNumber: 34, title: 'Bayi di Malam Hujan', phase: 'flashback_fragments', chapterGoal: 'Fragmen masa lalu menunjukkan Naya bayi pernah diselamatkan seseorang.', mandatoryBeats: ['rekaman kedua Laila', 'tangisan bayi', 'selimut biru ditemukan'], proposedStateDelta: { baby_naya_rescue_seeded: true }, newNamedCharacters: [] },
  { chapterNumber: 35, title: 'Arman Memilih Lari', phase: 'emotional_turn', chapterGoal: 'Arman mengaku pernah lari karena takut Naya dibunuh secara sosial.', mandatoryBeats: ['Arman mengaku pengecut', 'Naya menolak memaafkan', 'bukti baru dari Arman'], proposedStateDelta: { arman_confession_partial: true }, newNamedCharacters: [] },
  { chapterNumber: 36, title: 'Pintu Kedua Bilik Ketujuh', phase: 'rising_mystery', chapterGoal: 'Pintu kedua Bilik Ketujuh ditemukan di bawah aula lama.', mandatoryBeats: ['pintu kedua ditemukan', 'kunci hitam akhirnya berfungsi', 'ruang dalam belum bisa dimasuki penuh'], proposedStateDelta: { second_bilik_door_found: true }, newNamedCharacters: [] },
  { chapterNumber: 37, title: 'Kotak Besi Tanpa Nama', phase: 'rising_mystery', chapterGoal: 'Di balik pintu kedua ada kotak besi tanpa nama.', mandatoryBeats: ['kotak besi', 'kombinasi angka dari lagu Laila', 'isi belum lengkap'], proposedStateDelta: { iron_box_found: true }, newNamedCharacters: [] },
  { chapterNumber: 38, title: 'Lagu untuk Membuka Kunci', phase: 'puzzle', chapterGoal: 'Naya memakai lagu nina bobo Laila sebagai kode kotak besi.', mandatoryBeats: ['kode lagu dipecahkan', 'dokumen salinan sebagian', 'foto bayi Naya dan Marwah'], proposedStateDelta: { lullaby_code_solved: true }, newNamedCharacters: [] },
  { chapterNumber: 39, title: 'Foto yang Membuat Naya Muak', phase: 'emotional_fallout', chapterGoal: 'Foto Marwah menggendong bayi Naya membuat Naya bingung dan marah.', mandatoryBeats: ['foto bayi', 'Naya menuduh Marwah munafik', 'Marwah hampir mengaku'], proposedStateDelta: { marwah_baby_photo_found: true }, newNamedCharacters: [] },
  { chapterNumber: 40, title: 'Malam Para Wali Santri', phase: 'pressure_build', chapterGoal: 'Pertemuan wali santri diumumkan dan semua pihak bersiap menguasai narasi.', mandatoryBeats: ['rapat wali diumumkan', 'Nadine siap publikasi', 'Kyai Hamid menawarkan damai palsu'], proposedStateDelta: { parent_meeting_announced: true }, newNamedCharacters: [] },
  { chapterNumber: 41, title: 'Kesepakatan yang Bau Kuburan', phase: 'dilemma', chapterGoal: 'Pengurus menawarkan beasiswa dan nama baik jika Naya diam.', mandatoryBeats: ['tawaran beasiswa', 'Naya hampir goyah karena masa depan', 'Salma menampar realitas'], proposedStateDelta: { hush_deal_offered: true }, newNamedCharacters: [] },
  { chapterNumber: 42, title: 'Saksi Terakhir Menghilang', phase: 'thriller', chapterGoal: 'Saksi terakhir diculik atau disembunyikan sebelum rapat wali.', mandatoryBeats: ['saksi hilang', 'Jamal dituduh', 'Marwah menunjukkan jalur lama'], proposedStateDelta: { final_witness_missing: true }, newNamedCharacters: [] },
  { chapterNumber: 43, title: 'Di Rumah Marwah', phase: 'moral_complication', chapterGoal: 'Naya melihat sisi pribadi Marwah dan alasan ia menutup kasus.', mandatoryBeats: ['rumah Marwah', 'surat Laila untuk Marwah', 'pengakuan belum lengkap'], proposedStateDelta: { marwah_private_truth_seen: true }, newNamedCharacters: [] },
  { chapterNumber: 44, title: 'Perempuan yang Menyelamatkan Bayi Itu', phase: 'reveal_gate', chapterGoal: 'Reveal Marwah pernah menyelamatkan bayi Naya meski ikut menutup kasus Laila.', mandatoryBeats: ['secret:marwah-protected-naya terbuka', 'Naya bingung antara marah dan berutang', 'Marwah memberi kunci terakhir'], proposedStateDelta: { marwah_saved_baby_naya: true }, newNamedCharacters: [] },
  { chapterNumber: 45, title: 'Cara Membuka Rahasia', phase: 'choice_gate', chapterGoal: 'Naya memilih cara membuka rahasia terakhir di depan wali santri.', mandatoryBeats: ['wali santri berkumpul', 'bukti siap', 'choice gate terakhir'], proposedStateDelta: { final_strategy_chosen: true }, newNamedCharacters: [] },
  { chapterNumber: 46, title: 'Suara Laila di Aula', phase: 'climax', chapterGoal: 'Rekaman Laila diputar dan membelah aula menjadi percaya dan menolak.', mandatoryBeats: ['rekaman diputar', 'Kyai Hamid kehilangan kontrol', 'Jamal mencoba kabur'], proposedStateDelta: { laila_audio_public: true }, newNamedCharacters: [] },
  { chapterNumber: 47, title: 'Orang Saleh Juga Bisa Takut', phase: 'climax', chapterGoal: 'Kyai Hamid mengaku sebagian tetapi masih menyembunyikan aktor utama.', mandatoryBeats: ['pengakuan sebagian', 'massa wali santri marah', 'Marwah menekan Hamid'], proposedStateDelta: { hamid_partial_confession: true }, newNamedCharacters: [] },
  { chapterNumber: 48, title: 'Tanda Tangan yang Membunuh Nama', phase: 'climax', chapterGoal: 'Bukti tanda tangan palsu mengunci keterlibatan pengurus dan broker tanah.', mandatoryBeats: ['dokumen dibandingkan', 'Jamal tersudut', 'Arman bersaksi'], proposedStateDelta: { forged_signature_public_proof: true }, newNamedCharacters: [] },
  { chapterNumber: 49, title: 'Sebelum Pintu Terakhir Dibuka', phase: 'pre_resolution', chapterGoal: 'Naya harus memilih apakah memaafkan orang yang menolong sekaligus melukai ibunya.', mandatoryBeats: ['Naya dan Marwah bicara berdua', 'Arman meminta tempat sebagai ayah', 'Naya menolak penyelesaian mudah'], proposedStateDelta: { naya_rejects_easy_forgiveness: true }, newNamedCharacters: [] },
  { chapterNumber: 50, title: 'Bilik Ketujuh', phase: 'resolution', chapterGoal: 'Bilik Ketujuh dibuka penuh dan catatan asli memulihkan nama Laila.', mandatoryBeats: ['secret:bilik-seventh-ledger terbuka', 'nama Laila dipulihkan', 'ending bervariasi sesuai route state'], proposedStateDelta: { bilik_seven_ledger_revealed: true, laila_name_restored: true }, newNamedCharacters: [] },
]

function chapterWordCount(paragraphs: string[]): number {
  return paragraphs
    .join(' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length
}

function choiceOrGateChapter(chapterNumber: number): boolean {
  return [1, 6, 10, 14, 16, 21, 24, 28, 32, 44, 45, 50].includes(chapterNumber)
}

function canonicalName(characterId: string): string {
  return characters.find((character) => character.id === characterId)?.canonicalName ?? characterId
}

function buildBlueprints(): ChapterBlueprint[] {
  return blueprintSpecs.map((spec) => ({
    chapterNumber: spec.chapterNumber,
    version: 1,
    phase: spec.phase,
    chapterGoal: spec.chapterGoal,
    mandatoryBeats: [...spec.mandatoryBeats],
    forbiddenReveals: secrets
      .filter((secret) => secret.revealGateChapter > spec.chapterNumber)
      .map((secret) => secret.id),
    allowedStateDelta: { ...spec.proposedStateDelta },
    introducesCharacters: [...spec.newNamedCharacters],
    reconciledFromVersion: null,
    reconciliationReason: null,
  }))
}

export function buildPremiumBilikKetujuhV2Snapshot(): CanonSnapshot {
  return {
    storyId: PREMIUM_BILIK_KETUJUH_V2_STORY_ID,
    characters,
    aliases,
    voiceSheets,
    facts,
    knowledge,
    secrets,
    timeline: [],
    threads,
    actRollups,
    blueprints: buildBlueprints(),
  }
}

export function buildPremiumBilikKetujuhV2Draft(
  snapshot: CanonSnapshot,
  chapter: number,
): ChapterDraft {
  const spec = fullChapterSpecs.find((item) => item.chapterNumber === chapter)
  if (!spec) {
    throw new Error(`Chapter ${chapter} is blueprint-only in V2. Full prose is currently available for chapters 1-3.`)
  }

  const paragraphs = [...spec.paragraphs]
  const wordCount = chapterWordCount(paragraphs)

  return {
    storyId: snapshot.storyId,
    chapterNumber: spec.chapterNumber,
    title: spec.title,
    paragraphs,
    wordCount,
    sceneCount: spec.sceneCount,
    hasChoiceOrGate: choiceOrGateChapter(spec.chapterNumber),
    events: spec.cast.slice(0, 4).map((characterId, index) => ({
      characterMention: canonicalName(characterId),
      description: `${canonicalName(characterId)} terlibat dalam konflik Bab ${spec.chapterNumber}: ${spec.chapterGoal}`,
      ordinal: index,
      occursAt: spec.chapterNumber * 10 + index,
      isFlashback: false,
    })),
    knowledgeAssertions: [],
    reveals: spec.reveals.map((secretId) => ({ secretId })),
    proposedStateDelta: { ...spec.proposedStateDelta },
    newNamedCharacters: [...spec.newNamedCharacters],
    dialogue: spec.dialogue.map(text => ({ characterId: 'char:unknown', text })), 
    emotionBeats: spec.emotionBeats.map(() => ({ characterId: 'char:unknown', targetCharacterId: 'char:unknown', valence: 'neutral' })), 
    softClaims: [],
    advancedThreadIds: [...spec.threadIds],
    opensNewThread: false,
  }
}

export function buildAllPremiumBilikKetujuhV2Drafts(
  snapshot = buildPremiumBilikKetujuhV2Snapshot(),
): ChapterDraft[] {
  return fullChapterSpecs.map((spec) => buildPremiumBilikKetujuhV2Draft(snapshot, spec.chapterNumber))
}

export const PREMIUM_BILIK_KETUJUH_V2_STATS = {
  totalBlueprintChapters: blueprintSpecs.length,
  totalFullDraftChapters: fullChapterSpecs.length,
  fullDraftChapters: fullChapterSpecs.map((spec) => spec.chapterNumber),
  minWordCount: Math.min(...fullChapterSpecs.map((spec) => chapterWordCount(spec.paragraphs))),
  maxWordCount: Math.max(...fullChapterSpecs.map((spec) => chapterWordCount(spec.paragraphs))),
  choiceChapters: Object.keys(PREMIUM_BILIK_KETUJUH_V2_ROUTE_MAP.choiceGates).map(Number),
  revealChapters: secrets.map((secret) => secret.revealGateChapter),
} as const
