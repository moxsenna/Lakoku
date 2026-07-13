import { buildContractFixture } from './build-contract-fixture'

export const romansaDramaContract = buildContractFixture({
  storyId: 'contract:romansa-drama:nada-pulang',
  title: 'Nada yang Membawa Kita Pulang',
  genre: 'Romansa Drama',
  tone: 'Hangat, getir, dan penuh kerinduan',
  mainCharacter: {
    name: 'Aluna Maheswari',
    role: 'Pianis kafe yang kembali ke kota pesisir',
    wound: 'Aluna meninggalkan cinta pertamanya tanpa penjelasan setelah ibunya sakit.',
    desire: 'Menyelamatkan sekolah musik ibunya dan berani membangun hidup yang ia pilih sendiri.',
  },
  mainConflict: 'Aluna harus bekerja sama dengan Raka, cinta lama yang kini bertunangan demi kewajiban keluarga, untuk mempertahankan sekolah musik dari penggusuran.',
  finalQuestion: 'Akankah Aluna dan Raka memilih cinta yang jujur tanpa mengorbankan orang-orang yang bergantung kepada mereka?',
  corePromise: 'Romansa kesempatan kedua tumbuh melalui kerja bersama, luka yang diakui, dan pilihan dewasa yang tidak menjadikan cinta sebagai pelarian.',
  endingCandidates: [
    {
      key: 'duet-new-home',
      name: 'Duet di Rumah Baru',
      condition: 'Aluna dan Raka jujur kepada keluarga serta menyelamatkan sekolah secara mandiri.',
      requiredClosure: ['Pertunangan lama diselesaikan dengan hormat.', 'Sekolah musik memiliki rumah baru.', 'Aluna dan Raka memilih hubungan terbuka.'],
    },
    {
      key: 'solo-with-hope',
      name: 'Lagu yang Belum Selesai',
      condition: 'Aluna memilih pemulihan diri ketika Raka belum bebas dari kewajibannya.',
      requiredClosure: ['Sekolah musik tetap berjalan.', 'Raka berhenti memberi janji palsu.', 'Aluna membangun masa depan tanpa menunggu.'],
    },
    {
      key: 'community-stage',
      name: 'Panggung untuk Semua',
      condition: 'Aluna mengutamakan komunitas dan membangun hubungan dengan ritme baru.',
      requiredClosure: ['Warga memperoleh kepemilikan sekolah.', 'Konflik keluarga Raka selesai.', 'Hubungan mereka mendapat batas yang sehat.'],
    },
  ],
  plotDebts: [
    {
      id: 'debt:unread-letter',
      question: 'Apa isi surat yang Aluna titipkan sebelum meninggalkan Raka?',
      introducedAt: 2,
      mustProgressBy: [12, 32],
      mustCloseBy: 45,
      status: 'open',
    },
    {
      id: 'debt:school-deed',
      question: 'Mengapa akta sekolah musik mencantumkan keluarga Raka?',
      introducedAt: 5,
      mustProgressBy: [20, 35, 40],
      mustCloseBy: 48,
      status: 'progressing',
    },
    {
      id: 'debt:mother-final-song',
      question: 'Untuk siapa ibu Aluna menulis komposisi terakhirnya?',
      introducedAt: 9,
      mustProgressBy: [20, 40],
      mustCloseBy: 49,
      status: 'open',
    },
  ],
  revealRunway: [
    { secretId: 'secret:raka-never-read-letter', revealGateChapter: 12 },
    { secretId: 'secret:mother-borrowed-from-raka-family', revealGateChapter: 20 },
    { secretId: 'secret:fiancee-knows-the-deal', revealGateChapter: 32 },
    { secretId: 'secret:school-deed-was-protected', revealGateChapter: 45 },
  ],
  motifs: {
    stakes: 'sekolah musik yang terancam digusur sebelum resital tahunan',
    relationship: 'kepercayaan Aluna kepada Raka dan murid-murid ibunya',
    mystery: 'surat perpisahan serta komposisi terakhir ibunya',
  },
})
