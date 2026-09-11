import { buildContractFixture } from './build-contract-fixture'

/**
 * Kontrak cerita Kirana/Gilang — novel ketiga M10-G (kota pesisir).
 *
 * Distinct dari nadia-raka (galeri urban) dan sinta-bagas (desa gunung):
 * setting kota pelabuhan, taruhan arsip dan kapal warisan, relasi
 * kakak-beradik, tone angin-laut dan birokrasi pelabuhan. Dipakai untuk
 * matriks branch-fork G.2.2: early fork Bab 10 + late fork Bab 44.
 */
export const kiranaGilangContract = buildContractFixture({
  storyId: 'contract:kirana-gilang:arsip-kapal',
  title: 'Arsip Kapal di Dermaga Tua',
  genre: 'Misteri Pelabuhan',
  tone: 'Angin laut, birokratis, dan mendesak',
  mainCharacter: {
    name: 'Kirana',
    role: 'Arsiparis pelabuhan yang menjaga dokumen kapal warisan ayahnya',
    wound: 'Kirana pernah menandatangani manifes tanpa memeriksa isinya demi menyelamatkan gajinya.',
    desire: 'Menemukan arsip kapal yang hilang sebelum lelang dermaga dan menghadapi Gilang.',
  },
  mainConflict: 'Kirana menemukan lemari arsip kosong dan segel rusak di kantor syahbandar menjelang lelang dermaga tua, sementara Gilang — kakaknya yang terakhir lembur malam itu — menolak bicara, dan dua jalan terbuka: jalur hukum pelabuhan atau menyusup ke gudang kontainer yang disegel.',
  finalQuestion: 'Akankah Kirana membuka seluruh kebenaran ketika arsip terakhir juga menyeret nama ayahnya sendiri?',
  corePromise: 'Setiap bab menyambung langsung malam hilangnya arsip dan memaksa Kirana memilih antara jalur hukum pelabuhan dan kebenaran yang ia cari sendiri.',
  endingCandidates: [
    {
      key: 'harbor-justice',
      name: 'Hukum Pelabuhan',
      kind: 'main' as const,
      condition: 'Kirana menjaga bukti dan menempuh jalur hukum pelabuhan sampai tuntas.',
      requiredClosure: ['Pencuri arsip diungkap di sidang syahbandar.', 'Nama dermaga dipulihkan.', 'Kirana menerima akibat pilihannya.'],
      blockingConditions: [],
    },
    {
      key: 'own-search',
      name: 'Penyelidikan Tangan Sendiri',
      kind: 'main' as const,
      condition: 'Kirana menyusup ke gudang kontainer dan menemukan kebenaran lewat jalannya sendiri.',
      requiredClosure: ['Isi kontainer menjelaskan hilangnya arsip.', 'Gilang menghadapi akibat perbuatannya.', 'Kirana berdamai dengan masa lalunya.'],
      blockingConditions: [],
    },
    {
      key: 'let-go',
      name: 'Melepas Dermaga',
      kind: 'secret' as const,
      condition: 'Kirana menghentikan pencarian demi keselamatan dan melepas obsesi arsip.',
      requiredClosure: ['Kirana selamat dari ancaman pelabuhan.', 'Lelang berjalan tanpa namanya.', 'Gilang menghilang dari hidupnya.'],
      blockingConditions: [],
    },
  ],
  plotDebts: [
    {
      id: 'main_mystery',
      question: 'Siapa yang mengambil arsip kapal dari lemari syahbandar pada malam itu?',
      introducedAt: 1,
      mustProgressBy: [5, 12, 32],
      mustCloseBy: 48,
      status: 'open',
    },
    {
      id: 'debt:container-seal',
      question: 'Siapa yang merusak segel gudang kontainer bernomor tanpa catatan?',
      introducedAt: 1,
      mustProgressBy: [10, 25],
      mustCloseBy: 48,
      status: 'open',
    },
    {
      id: 'debt:gilang-motive',
      question: 'Apa motif Gilang lembur terakhir di kantor syahbandar malam itu?',
      introducedAt: 1,
      mustProgressBy: [8, 20, 40],
      mustCloseBy: 48,
      status: 'open',
    },
  ],
  revealRunway: [
    { secretId: 'secret:archive-key-copy', revealGateChapter: 12 },
    { secretId: 'secret:gilang-harbor-debt', revealGateChapter: 20 },
    { secretId: 'secret:container-manifest', revealGateChapter: 32 },
    { secretId: 'secret:buyer-ordered-theft', revealGateChapter: 45 },
  ],
  motifs: {
    stakes: 'arsip kapal yang hilang sebelum lelang dermaga tua',
    relationship: 'kepercayaan Kirana kepada Gilang dan syahbandar pelabuhan',
    mystery: 'lemari kosong serta segel rusak tanpa catatan resmi',
  },
})
