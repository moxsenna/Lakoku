/**
 * Fixture data lokal untuk fase Reader-UI.
 *
 * INTERNAL: file ini TIDAK boleh diimpor langsung oleh komponen UI.
 * UI hanya berbicara dengan `lib/api/client.ts`. Saat backend nyata siap,
 * isi client diganti menjadi `fetch()` dan file fixture ini bisa dihapus
 * tanpa mengubah satu pun komponen.
 */

import type { StoryDetail, Chapter, ChoiceOutcome } from './types'

export const storyFixtures: StoryDetail[] = [
  {
    id: 'pesan-terakhir',
    title: 'Pesan Terakhir di Ponselnya',
    cover: '/covers/pesan-terakhir.png',
    tagline: 'Satu notifikasi mengubah segalanya.',
    synopsis:
      'Kamu menemukan pesan dari wanita lain di ponsel suamimu—tepat di malam ulang tahun pernikahan kalian. Kamu akan langsung menghadapinya, atau mencari bukti lebih dulu?',
    role: 'Alya, 29 tahun — istri yang selama ini memilih percaya',
    tropes: ['Pengkhianatan', 'Kebangkitan Diri', 'Rahasia Keluarga'],
    totalChapters: 50,
    currentChapter: 12,
    status: 'BERJALAN',
    jejak: [
      {
        chapter: 3,
        decision: 'Pura-pura belum tahu.',
        consequence: 'Raka mulai lengah. Kamu mendapat akses ke laptop kerjanya.',
      },
      {
        chapter: 7,
        decision: 'Simpan bukti itu untuk dirimu sendiri.',
        consequence: 'Ibu mertuamu mulai curiga dengan sikap tenangmu.',
      },
      {
        chapter: 11,
        decision: 'Temui Nadia secara diam-diam.',
        consequence: 'Kamu tahu Nadia juga dibohongi. Sekutu baru, atau jebakan baru?',
      },
    ],
  },
  {
    id: 'warisan-tersembunyi',
    title: 'Warisan yang Tersembunyi',
    cover: '/covers/warisan-yang-tersembunyi.png',
    tagline: 'Surat itu tidak seharusnya sampai padamu.',
    synopsis:
      'Sehari setelah pemakaman ayahmu, sebuah surat bersegel tiba. Isinya: kamu pewaris tunggal—dan seluruh keluargamu sudah tahu sejak lama.',
    role: 'Laras, 27 tahun — anak yang selalu dianggap tidak penting',
    tropes: ['Warisan', 'Rahasia Keluarga', 'Kebangkitan Diri'],
    totalChapters: 50,
    currentChapter: 50,
    status: 'SELESAI',
    endingName: 'Harga Kejujuran',
    jejak: [
      {
        chapter: 9,
        decision: 'Tunjukkan surat itu pada notaris, bukan keluargamu.',
        consequence: 'Kamu selangkah lebih cepat dari om Bram.',
      },
      {
        chapter: 24,
        decision: 'Maafkan ibumu, tapi jangan lupakan.',
        consequence: 'Hubungan kalian pulih perlahan—dengan syarat yang kamu tentukan.',
      },
      {
        chapter: 41,
        decision: 'Katakan yang sebenarnya di rapat keluarga.',
        consequence: 'Semua topeng terbuka. Tidak ada jalan kembali.',
      },
    ],
  },
  {
    id: 'di-balik-kaca',
    title: 'Di Balik Kaca',
    cover: '/covers/di-balik-kaca.png',
    tagline: 'Atasan barumu adalah masa lalumu.',
    synopsis:
      'Hari pertama kerja di kantor impianmu, kamu bertemu direktur baru: laki-laki yang meninggalkanmu lima tahun lalu tanpa penjelasan. Dan sekarang, dia yang memegang kariermu.',
    role: 'Sekar, 26 tahun — profesional muda yang tidak mau jatuh dua kali',
    tropes: ['Cinta Lama', 'Second Chance', 'Romance'],
    totalChapters: 50,
    currentChapter: 1,
    status: 'BARU',
    jejak: [],
  },
  {
    id: 'koper-di-depan-pintu',
    title: 'Koper di Depan Pintu',
    cover: '/covers/koper-di-depan-pintu.png',
    tagline: 'Malam ini kamu harus memilih: pergi, atau bertahan.',
    synopsis:
      'Pernikahan kontrak itu seharusnya berakhir bulan depan. Tapi tadi malam, dia memintamu tinggal—dan pagi ini kamu menemukan alasan sebenarnya di laci mejanya.',
    role: 'Ratri, 30 tahun — istri kontrak yang mulai lupa ini hanya kontrak',
    tropes: ['Pernikahan Kontrak', 'Romance', 'Pengkhianatan'],
    totalChapters: 50,
    currentChapter: 5,
    status: 'BERJALAN',
    jejak: [
      {
        chapter: 4,
        decision: 'Tanyakan langsung soal perpanjangan kontrak.',
        consequence: 'Dia menghindar. Untuk pertama kalinya, kamu melihatnya gugup.',
      },
    ],
  },
]

/**
 * Bab pada posisi terkini tiap cerita.
 * Dikunci per (storyId, number) sehingga reader menampilkan bab yang benar
 * untuk cerita yang dibuka—bukan satu sample statis.
 */
export const chapterFixtures: Chapter[] = [
  {
    storyId: 'pesan-terakhir',
    number: 12,
    title: 'Malam Tanpa Jawaban',
    paragraphs: [
      'Hujan turun sejak sore, dan kamu masih duduk di ruang tamu dengan ponsel Raka di genggamanmu.',
      'Layarnya sudah mati. Tapi kalimat itu masih menyala di kepalamu.',
      '“Aku kangen. Kapan kamu bilang ke dia?”',
      'Pintu depan terbuka. Langkah Raka terdengar berat—dia selalu begitu kalau pulang larut.',
      '“Kamu belum tidur?” suaranya hati-hati, seperti sedang mengukur jarak.',
      'Kamu meletakkan ponselnya di meja. Pelan. Tanpa suara.',
      'Mata Raka mengikuti gerakan tanganmu, lalu berhenti di layar yang gelap itu.',
      'Untuk beberapa detik, tidak ada yang bicara. Hanya hujan.',
      '“Alya…” dia mulai.',
      '“Duduk,” katamu. Suaramu lebih tenang dari yang kamu duga.',
      'Dia duduk. Di ujung sofa. Jauh.',
      'Kamu menatapnya, dan untuk pertama kalinya dalam enam tahun, kamu tidak tahu siapa laki-laki di depanmu ini.',
      '“Siapa Nadia?”',
      'Rahangnya mengeras. “Dari mana kamu—”',
      '“Jawab dulu pertanyaanku.”',
      'Di luar, hujan makin deras. Di dalam, ada sesuatu yang sedang runtuh perlahan.',
      'Raka menunduk. Kedua tangannya saling menggenggam, seperti orang yang sedang berdoa—atau menyerah.',
      '“Dia… bukan siapa-siapa yang perlu kamu khawatirkan.”',
      'Justru kalimat itu yang membuat dadamu sesak. Bukan siapa-siapa tidak mengirim pesan jam dua pagi.',
      'Kamu berdiri. Kunci mobil ada di meja. Kamar tamu ada di lantai atas. Dan kebenaran—entah ada di mana.',
    ],
    choicePrompt: 'Dia menunggu reaksimu. Satu keputusan malam ini bisa mengubah semuanya.',
    choices: [
      {
        id: 'hadapi',
        label: 'Hadapi dia sekarang. Minta dia buka semua pesannya.',
        hint: 'Keputusan ini bisa mengubah hubungan kalian.',
      },
      {
        id: 'pergi',
        label: 'Ambil kunci mobil dan pergi malam ini juga.',
        hint: 'Keputusan ini bisa mengubah hubungan kalian.',
      },
      {
        id: 'simpan',
        label: 'Naik ke kamar tamu. Simpan pertanyaanmu untuk besok.',
      },
    ],
  },
  {
    storyId: 'di-balik-kaca',
    number: 1,
    title: 'Wajah yang Tidak Kusangka',
    paragraphs: [
      'Kamu tiba tiga puluh menit lebih awal. Lift kaca membawamu naik ke lantai dua puluh dua, dan seluruh kota terbentang di bawah seperti janji.',
      'Ini kantor yang kamu kejar selama dua tahun. Hari ini hari pertamamu.',
      'Resepsionis mengantarmu ke ruang rapat. “Direktur baru ingin menyapa tim sebelum mulai,” katanya.',
      'Kamu duduk, merapikan blazer, mengulang nama-nama yang kamu hafal semalam.',
      'Pintu terbuka. Dan waktu, entah bagaimana, berhenti.',
      'Laki-laki itu berdiri di ambang pintu dengan setelan abu-abu yang rapi. Lima tahun menambah garis di wajahnya, tapi matanya tidak berubah.',
      'Arga.',
      'Laki-laki yang pergi tanpa satu kata pun, lima tahun lalu, dan meninggalkanmu dengan pertanyaan yang tidak pernah selesai.',
      'Dia menyapu ruangan dengan pandangannya—dan berhenti tepat di kamu.',
      'Untuk sepersekian detik, topeng profesionalnya retak. Lalu kembali sempurna.',
      '“Selamat pagi, semuanya,” katanya. “Saya Arga Wicaksana. Mulai hari ini, saya yang memimpin divisi ini.”',
      'Suaranya masih sama. Dan itu yang paling kamu benci.',
      'Rapat berjalan seperti kabut. Kamu mendengar setengah, mencatat seperempat.',
      'Saat semua bubar, dia memanggil satu nama. Namamu.',
      '“Bisa bicara sebentar?”',
      'Ruangan kosong perlahan. Tinggal kalian berdua dan dua puluh dua lantai jarak dari tanah.',
      'Dia menatapmu, dan untuk pertama kalinya dalam lima tahun, dia tidak tahu harus bilang apa.',
      '“Sekar,” akhirnya dia bicara. “Aku tidak tahu kamu melamar di sini.”',
      'Kamu bisa memilih banyak hal sekarang. Tapi kamu hanya punya satu kesempatan pertama.',
    ],
    choicePrompt: 'Dia menunggu. Bagaimana kamu membuka babak baru yang tidak kamu minta ini?',
    choices: [
      {
        id: 'profesional',
        label: 'Bersikap dingin dan profesional. Ini soal kerja, bukan masa lalu.',
        hint: 'Keputusan ini menentukan posisimu di kantor.',
      },
      {
        id: 'jujur',
        label: 'Tuntut penjelasan yang tidak pernah kamu dapat lima tahun lalu.',
        hint: 'Keputusan ini membuka luka lama.',
      },
      {
        id: 'mundur',
        label: 'Minta dipindahkan ke divisi lain sebelum semuanya rumit.',
      },
    ],
  },
  {
    storyId: 'di-balik-kaca',
    number: 2,
    title: 'Jarak Dua Puluh Dua Lantai',
    paragraphs: [
      'Minggu pertama berjalan seperti perang dingin yang sopan.',
      'Kalian bertukar email dengan bahasa yang terlalu rapi. “Mohon reviunya, Pak.” “Sudah saya cek, terima kasih.” Setiap kata dipilih agar tidak ada celah.',
      'Tapi kantor terbuka ini tidak dirancang untuk menyembunyikan apa pun. Meja kalian hanya terpisah dinding kaca, dan setiap kali kamu mengangkat kepala, dia ada di sana—menunduk di atas laptopnya, atau menatap kota, atau sesekali, menatapmu terlalu lama.',
      'Hari Kamis, dia menahanmu setelah rapat divisi. “Presentasimu tadi bagus,” katanya. “Data soal segmen muda itu—kamu yang menyusun sendiri?”',
      '“Iya, Pak.” Kamu menekankan kata terakhir.',
      'Dia tersenyum tipis, seperti mengerti permainan yang sedang kamu mainkan. “Klien Meridian minta tim kecil untuk pitch bulan depan. Aku mau kamu memimpinnya.”',
      'Kamu tahu apa artinya. Berbulan-bulan bekerja berdampingan. Rapat larut. Perjalanan dinas.',
      '“Kenapa saya?”',
      '“Karena kamu yang terbaik di divisi ini,” katanya. Lalu, lebih pelan: “Dan karena aku tidak mau kehilangan orang baik hanya karena aku takut canggung.”',
      'Kalimat itu menggantung di antara kalian, lebih berat dari yang seharusnya.',
      'Di luar jendela, matahari sore memantul di gedung-gedung. Dan kamu sadar—apa pun jawabanmu, kamu tidak akan bisa berpura-pura selamanya bahwa dia hanya atasan.',
    ],
    choicePrompt: 'Tawaran itu di depan matamu. Karier, atau jarak aman?',
    choices: [
      {
        id: 'terima',
        label: 'Terima. Ini kesempatanmu—jangan biarkan masa lalu merampasnya.',
        hint: 'Keputusan ini mendekatkan kalian, suka atau tidak.',
      },
      {
        id: 'syarat',
        label: 'Terima, tapi ajukan syarat: semua profesional, tanpa pengecualian.',
        hint: 'Keputusan ini menetapkan aturan mainmu sendiri.',
      },
      {
        id: 'tolak',
        label: 'Tolak dengan halus. Kamu belum siap sedekat itu.',
      },
    ],
  },
  {
    storyId: 'di-balik-kaca',
    number: 3,
    title: 'Yang Tersisa dari Lima Tahun',
    paragraphs: [
      'Ruang rapat kecil di lantai sembilan belas menjadi markas kalian.',
      'Malam itu tinggal kalian berdua, dikelilingi cangkir kopi kosong dan slide yang belum juga sempurna.',
      'Pukul sembilan lewat, dia melepas dasinya dan menyandarkan punggung. “Boleh aku tanya sesuatu yang bukan soal kerja?”',
      'Kamu tidak menjawab. Tapi kamu juga tidak menghentikannya.',
      '“Kamu pernah membenciku?”',
      'Pertanyaan itu terlalu jujur untuk jam selarut ini. Kamu meletakkan spidol.',
      '“Setiap hari, selama satu tahun,” katamu. “Lalu aku sadar membencimu pun tetap membuatmu jadi pusat hidupku. Jadi aku berhenti.”',
      'Dia mengangguk pelan, seperti menerima hukuman yang memang pantas.',
      '“Aku pergi karena ayahku sakit dan perusahaannya hampir bangkrut,” katanya. “Aku pikir kalau aku menyeretmu ke dalam kekacauan itu, aku akan menghancurkanmu juga. Jadi aku memilih menghancurkan diriku sendiri saja.”',
      '“Kamu tidak pernah memberiku kesempatan untuk memilih,” balasmu. Suaramu bergetar, tapi tidak patah.',
      '“Aku tahu,” katanya. “Itu kesalahan terbesarku.”',
      'Untuk pertama kalinya dalam lima tahun, jarak dua puluh dua lantai itu terasa hanya sejengkal.',
      'Dan itu justru yang membuatmu takut.',
    ],
    choicePrompt: 'Kebenaran sudah di meja. Sekarang giliranmu memutuskan apa yang kaubawa pulang.',
    choices: [
      {
        id: 'maafkan',
        label: 'Katakan bahwa kamu mulai mengerti—meski belum bisa memaafkan.',
        hint: 'Keputusan ini membuka pintu yang lama kaukunci.',
      },
      {
        id: 'tegas',
        label: 'Tegaskan: alasan bagus tetap tidak mengubah apa yang hilang.',
        hint: 'Keputusan ini menjaga hatimu tetap terlindungi.',
      },
    ],
  },
  {
    storyId: 'koper-di-depan-pintu',
    number: 5,
    title: 'Laci yang Terkunci',
    paragraphs: [
      'Pagi datang terlalu cepat. Sisi ranjang sebelahmu sudah kosong, seprainya dingin.',
      'Semalam dia memintamu tinggal. Bukan dengan kalimat panjang—hanya “Jangan pergi dulu,” diucapkan pelan saat dia pikir kamu sudah tidur.',
      'Kontrak kalian berakhir bulan depan. Seharusnya sederhana: tanda tangan, berpisah, lupakan.',
      'Tapi tidak ada yang sederhana sejak kamu mulai menghitung caranya menyebut namamu.',
      'Kamu turun ke ruang kerjanya untuk mengembalikan buku yang kemarin dia pinjamkan.',
      'Di meja, laci paling bawah sedikit terbuka—dia tidak pernah lupa menguncinya.',
      'Kamu tahu kamu tidak seharusnya. Tapi tanganmu sudah lebih dulu bergerak.',
      'Di dalamnya bukan dokumen. Bukan uang. Hanya sebuah map tipis dengan namamu di sampulnya.',
      'Isinya: setiap hal kecil tentangmu. Kopi yang kamu suka. Tanggal yang kamu takuti. Catatan tulisan tangannya sendiri.',
      'Dan di halaman terakhir, satu kalimat yang membuat napasmu tertahan.',
      '“Kalau dia tahu alasan sebenarnya aku menikahinya, dia akan pergi. Dan aku belum siap.”',
      'Langkah kaki terdengar dari arah dapur. Dia pulang lebih cepat.',
      '“Ratri?” suaranya memanggil. “Kamu di bawah?”',
      'Map itu masih di tanganmu. Laci masih terbuka. Dan seluruh cerita yang kamu kira kamu pahami baru saja berubah bentuk.',
    ],
    choicePrompt: 'Langkahnya makin dekat. Apa yang kamu lakukan dengan yang baru kamu tahu?',
    choices: [
      {
        id: 'konfrontasi',
        label: 'Hadapi dia dengan map itu di tangan. Sekarang juga.',
        hint: 'Keputusan ini memaksa kebenaran keluar lebih cepat.',
      },
      {
        id: 'kembalikan',
        label: 'Kembalikan map, tutup laci, pura-pura tidak tahu.',
        hint: 'Keputusan ini menyimpan kartu untukmu sendiri.',
      },
      {
        id: 'pergi',
        label: 'Ambil koper yang belum sempat kamu bongkar, dan pergi.',
      },
    ],
  },
]

/**
 * Konsekuensi per pilihan. Di produksi, ini dihasilkan backend
 * (bounded branching + validator konsistensi), bukan dipetakan statis.
 */
export const outcomeFixtures: Record<string, ChoiceOutcome> = {
  'pesan-terakhir:12:hadapi': {
    storyId: 'pesan-terakhir',
    chapterNumber: 12,
    choiceId: 'hadapi',
    consequence: [
      'Raka tidak langsung menjawab.',
      'Tapi ketika dia akhirnya menyerahkan ponselnya, tangannya gemetar—dan kamu tahu, apa pun yang akan kamu baca, malam ini kalian tidak akan tidur.',
    ],
    nextChapterNumber: 13,
    isEnding: false,
  },
  'pesan-terakhir:12:pergi': {
    storyId: 'pesan-terakhir',
    chapterNumber: 12,
    choiceId: 'pergi',
    consequence: [
      'Suara pintu yang kamu tutup terdengar lebih keras dari hujan.',
      'Di kaca spion, kamu melihat lampu ruang tamu masih menyala. Dia tidak mengejar. Dan entah kenapa, itu yang paling menyakitkan.',
    ],
    nextChapterNumber: 13,
    isEnding: false,
  },
  'pesan-terakhir:12:simpan': {
    storyId: 'pesan-terakhir',
    chapterNumber: 12,
    choiceId: 'simpan',
    consequence: [
      'Kamu menaiki tangga tanpa menoleh.',
      'Di bawah, Raka tidak bergerak dari sofa. Namun untuk pertama kalinya, ia berhenti memanggilmu dengan nama lengkapmu.',
    ],
    nextChapterNumber: 13,
    isEnding: false,
  },
  'di-balik-kaca:1:profesional': {
    storyId: 'di-balik-kaca',
    chapterNumber: 1,
    choiceId: 'profesional',
    consequence: [
      '“Selamat pagi, Pak Arga,” katamu. Datar. Rapi. Seperti map yang belum pernah dibuka.',
      'Sesuatu di matanya meredup—dan untuk pertama kalinya, kamu merasa kamu yang memegang kendali.',
    ],
    nextChapterNumber: 2,
    isEnding: false,
  },
  'di-balik-kaca:1:jujur': {
    storyId: 'di-balik-kaca',
    chapterNumber: 1,
    choiceId: 'jujur',
    consequence: [
      '“Kenapa kamu pergi?” Pertanyaan itu keluar sebelum kamu sempat menahannya.',
      'Dia terdiam lama. “Karena aku pengecut,” katanya akhirnya. Dan kejujuran itu justru lebih menyakitkan dari diam lima tahun.',
    ],
    nextChapterNumber: 2,
    isEnding: false,
  },
  'di-balik-kaca:1:mundur': {
    storyId: 'di-balik-kaca',
    chapterNumber: 1,
    choiceId: 'mundur',
    consequence: [
      '“Saya rasa akan lebih baik jika saya di divisi lain,” katamu.',
      'Dia mengangguk pelan, tapi tidak menandatangani apa pun. “Pikirkan lagi,” katanya. “Aku tidak akan memaksamu tinggal. Tapi aku juga tidak akan buru-buru melepasmu.”',
    ],
    nextChapterNumber: 2,
    isEnding: false,
  },
  'di-balik-kaca:2:terima': {
    storyId: 'di-balik-kaca',
    chapterNumber: 2,
    choiceId: 'terima',
    consequence: [
      '“Saya terima,” katamu. “Kapan kita mulai?”',
      'Sesuatu di bahunya melepas tegang. “Besok,” katanya, dan untuk pertama kalinya sejak dia kembali, senyumnya terlihat tulus.',
    ],
    nextChapterNumber: 3,
    isEnding: false,
  },
  'di-balik-kaca:2:syarat': {
    storyId: 'di-balik-kaca',
    chapterNumber: 2,
    choiceId: 'syarat',
    consequence: [
      '“Saya mau, dengan satu syarat. Semua di antara kita profesional. Tanpa pengecualian.”',
      '“Setuju,” katanya cepat. Terlalu cepat. Seolah dia tahu sebuah syarat justru menandakan kamu masih peduli.',
    ],
    nextChapterNumber: 3,
    isEnding: false,
  },
  'di-balik-kaca:2:tolak': {
    storyId: 'di-balik-kaca',
    chapterNumber: 2,
    choiceId: 'tolak',
    consequence: [
      '“Saya rasa lebih baik proyek ini dipimpin orang lain, Pak.”',
      'Dia menatapmu lama, lalu mengangguk. “Baik. Tapi aku tetap ingin kamu di tim.” Kamu menang malam ini—tapi kalian berdua tahu, kamu hanya menunda yang tak terhindarkan.',
    ],
    nextChapterNumber: 3,
    isEnding: false,
  },
  'koper-di-depan-pintu:5:konfrontasi': {
    storyId: 'koper-di-depan-pintu',
    chapterNumber: 5,
    choiceId: 'konfrontasi',
    consequence: [
      'Kamu berbalik dengan map itu terbuka di tanganmu. Wajahnya pucat seketika.',
      '“Jadi,” katamu, suara nyaris berbisik, “kapan kamu berencana memberitahuku alasan sebenarnya?”',
    ],
    nextChapterNumber: 6,
    isEnding: false,
  },
  'koper-di-depan-pintu:5:kembalikan': {
    storyId: 'koper-di-depan-pintu',
    chapterNumber: 5,
    choiceId: 'kembalikan',
    consequence: [
      'Kamu menutup laci tepat saat dia masuk. Senyummu sempurna. Terlalu sempurna.',
      '“Baru cari buku,” katamu. Dia percaya. Dan untuk pertama kalinya, kamu tahu sesuatu yang dia kira masih rahasia.',
    ],
    nextChapterNumber: 6,
    isEnding: false,
  },
  'koper-di-depan-pintu:5:pergi': {
    storyId: 'koper-di-depan-pintu',
    chapterNumber: 5,
    choiceId: 'pergi',
    consequence: [
      'Kamu melewatinya di ambang pintu tanpa menoleh, koper di tangan.',
      '“Ratri, tunggu—” Tapi kamu sudah di tangga, dan untuk pertama kalinya, dialah yang tertinggal dengan pertanyaan.',
    ],
    nextChapterNumber: 6,
    isEnding: false,
  },
}
