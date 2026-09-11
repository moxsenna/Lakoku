import { buildContractFixture } from './build-contract-fixture'

/**
 * Kontrak cerita Sinta/Bagas — novel kedua M10-G (desa lereng gunung).
 *
 * Distinct dari nadia-raka: setting desa pegunungan (bukan galeri urban),
 * taruhan pusaka dan tanah adat (bukan lukisan), relasi saudara-seperguruan
 * (bukan kurator/antagonis romantis), tone mistis-komunal. Ending lock tetap
 * Bab 45 via `buildContractFixture` (closureRunway beku).
 */
export const sintaBagasContract = buildContractFixture({
  storyId: 'contract:sinta-bagas:keris-hilang',
  title: 'Keris yang Hilang dari Pendopo',
  genre: 'Misteri Pusaka',
  tone: 'Mistis, komunal, dan menekan',
  mainCharacter: {
    name: 'Sinta',
    role: 'Penjaga pendopo yang memegang amanah keris pusaka desa',
    wound: 'Sinta pernah menukar jadwal jaga demi upacara keluarga dan menutupinya.',
    desire: 'Menemukan keris pusaka sebelum upacara bersih desa dan menghadapi Bagas.',
  },
  mainConflict: 'Sinta menemukan peti pusaka kosong dan jejak lumpur di pendopo menjelang upacara bersih desa, sementara Bagas — saudara seperguruannya yang terakhir berjaga malam itu — menolak bicara, dan dua jalan terbuka: musyawarah adat atau menyusup ke lereng tambang tua yang dilarang.',
  finalQuestion: 'Akankah Sinta menegakkan amanah pusaka ketika kebenaran terakhir juga menyeret nama keluarganya sendiri?',
  corePromise: 'Setiap bab menyambung langsung malam hilangnya keris dan memaksa Sinta memilih antara musyawarah adat dan kebenaran yang ia cari sendiri.',
  endingCandidates: [
    {
      key: 'adat-justice',
      name: 'Musyawarah Adat',
      kind: 'main' as const,
      condition: 'Sinta menjaga bukti dan menempuh musyawarah adat sampai tuntas.',
      requiredClosure: ['Pencuri keris diungkap di depan sesepuh.', 'Nama pendopo dipulihkan.', 'Sinta menerima akibat pilihannya.'],
      blockingConditions: [],
    },
    {
      key: 'own-search',
      name: 'Pencarian Tangan Sendiri',
      kind: 'main' as const,
      condition: 'Sinta menyusup ke lereng tambang dan menemukan kebenaran lewat jalannya sendiri.',
      requiredClosure: ['Isi tambang menjelaskan hilangnya keris.', 'Bagas menghadapi akibat perbuatannya.', 'Sinta berdamai dengan masa lalunya.'],
      blockingConditions: [],
    },
    {
      key: 'let-go',
      name: 'Melepas Amanah',
      kind: 'secret' as const,
      condition: 'Sinta menghentikan pencarian demi keselamatan desa dan melepas obsesi pusaka.',
      requiredClosure: ['Sinta selamat dari ancaman lereng.', 'Desa menutup kasus tanpa nama.', 'Bagas menghilang dari hidupnya.'],
      blockingConditions: [],
    },
  ],
  plotDebts: [
    {
      id: 'main_mystery',
      question: 'Siapa yang mengambil keris pusaka pendopo pada malam itu?',
      introducedAt: 1,
      mustProgressBy: [5, 12, 32],
      mustCloseBy: 48,
      status: 'open',
    },
    {
      id: 'debt:mine-trail',
      question: 'Siapa yang meninggalkan jejak lumpur tambang di lantai pendopo?',
      introducedAt: 1,
      mustProgressBy: [10, 25],
      mustCloseBy: 48,
      status: 'open',
    },
    {
      id: 'debt:bagas-motive',
      question: 'Apa motif Bagas berjaga terakhir di pendopo malam itu?',
      introducedAt: 1,
      mustProgressBy: [8, 20, 40],
      mustCloseBy: 48,
      status: 'open',
    },
  ],
  revealRunway: [
    { secretId: 'secret:pendopo-key-copy', revealGateChapter: 12 },
    { secretId: 'secret:bagas-land-debt', revealGateChapter: 20 },
    { secretId: 'secret:mine-storehouse', revealGateChapter: 32 },
    { secretId: 'secret:buyer-ordered-theft', revealGateChapter: 45 },
  ],
  motifs: {
    stakes: 'keris pusaka yang hilang sebelum upacara bersih desa',
    relationship: 'kepercayaan Sinta kepada Bagas dan sesepuh desa',
    mystery: 'peti kosong serta jejak lumpur tambang tanpa pemilik',
  },
})
