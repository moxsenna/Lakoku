import { buildContractFixture } from './build-contract-fixture'

/**
 * Kontrak cerita Nadia/Raka — rantai galeri seni.
 *
 * Selaras dengan fixture `fixtures/narrative/nadia-raka-continuity.ts`:
 * tokoh yang sama (Nadia protagonis, Raka antagonis), konflik yang sama
 * (lukisan galeri hilang, konfrontasi Bab 1), sehingga brief pilihan yang
 * dibangun dari kontrak ini menyebut tokoh yang benar, bukan tokoh kontrak
 * lain (mis. Maya/Shinta dari misteri-drama).
 */
export const nadiaRakaContract = buildContractFixture({
  storyId: 'contract:nadia-raka:bingkai-kosong',
  title: 'Bingkai Kosong di Galeri Senja',
  genre: 'Misteri Drama',
  tone: 'Tegang, intim, dan mendesak',
  mainCharacter: {
    name: 'Nadia',
    role: 'Kurator galeri yang menyelidiki hilangnya lukisan utama',
    wound: 'Nadia pernah menutup mata atas kejanggalan lelang demi kariernya.',
    desire: 'Membuktikan siapa yang mencuri lukisan dan menuntaskan konfrontasi dengan Raka.',
  },
  mainConflict: 'Nadia menemukan bingkai kosong dan serpihan kaca di galeri, sementara Raka — orang terakhir yang keluar malam itu — menolak mengaku, dan dua jalan terbuka: jalur hukum atau mengejar alamat gudang misterius.',
  finalQuestion: 'Akankah Nadia membuka seluruh kebenaran ketika bukti terakhir juga dapat menghancurkan orang yang ia kenal?',
  corePromise: 'Setiap bab menyambung langsung konfrontasi galeri dan memaksa Nadia memilih antara keadilan formal dan kebenaran yang ia kejar sendiri.',
  endingCandidates: [
    {
      key: 'court-justice',
      name: 'Keadilan Formal',
      kind: 'main' as const,
      condition: 'Nadia menjaga bukti dan menempuh jalur hukum sampai tuntas.',
      requiredClosure: ['Pencuri lukisan terungkap di persidangan.', 'Nama galeri dipulihkan.', 'Nadia menerima akibat pilihannya.'],
      blockingConditions: [],
    },
    {
      key: 'own-proof',
      name: 'Bukti Tangan Sendiri',
      kind: 'main' as const,
      condition: 'Nadia mengejar alamat gudang dan menemukan kebenaran lewat jalannya sendiri.',
      requiredClosure: ['Isi gudang menjelaskan hilangnya lukisan.', 'Raka menghadapi akibat perbuatannya.', 'Nadia berdamai dengan masa lalunya.'],
      blockingConditions: [],
    },
    {
      key: 'let-go',
      name: 'Melepas Bingkai',
      kind: 'secret' as const,
      condition: 'Nadia menghentikan pengejaran demi keselamatan dan melepas obsesi lukisan.',
      requiredClosure: ['Nadia selamat dari ancaman.', 'Galeri menutup kasus tanpa nama.', 'Raka menghilang dari hidupnya.'],
      blockingConditions: [],
    },
  ],
  plotDebts: [
    {
      id: 'main_mystery',
      question: 'Siapa yang mengambil lukisan utama galeri pada malam itu?',
      introducedAt: 1,
      mustProgressBy: [5, 12, 32],
      mustCloseBy: 48,
      status: 'open',
    },
    {
      id: 'debt:warehouse-address',
      question: 'Siapa yang mengirim alamat gudang lama tanpa nama ke ponsel Nadia?',
      introducedAt: 1,
      mustProgressBy: [10, 25],
      mustCloseBy: 48,
      status: 'open',
    },
    {
      id: 'debt:raka-motive',
      question: 'Apa motif Raka berada terakhir di galeri malam itu?',
      introducedAt: 1,
      mustProgressBy: [8, 20, 40],
      mustCloseBy: 48,
      status: 'open',
    },
  ],
  revealRunway: [
    { secretId: 'secret:gallery-key-copy', revealGateChapter: 12 },
    { secretId: 'secret:raka-debt-note', revealGateChapter: 20 },
    { secretId: 'secret:warehouse-ledger', revealGateChapter: 32 },
    { secretId: 'secret:collector-ordered-theft', revealGateChapter: 45 },
  ],
  motifs: {
    stakes: 'lukisan utama yang hilang sebelum pameran dibuka',
    relationship: 'kepercayaan Nadia kepada Raka dan pengacara galeri',
    mystery: 'bingkai kosong serta alamat gudang tanpa nama pengirim',
  },
})
