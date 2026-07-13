import { buildContractFixture } from './build-contract-fixture'

export const misteriDramaContract = buildContractFixture({
  storyId: 'contract:misteri-drama:arsip-hujan',
  title: 'Arsip Terakhir di Musim Hujan',
  genre: 'Misteri Drama',
  tone: 'Tegang, muram, dan intim',
  mainCharacter: {
    name: 'Maya Pradipta',
    role: 'Arsiparis kota yang menyelidiki kematian kakaknya',
    wound: 'Maya membiarkan pertengkaran terakhir dengan kakaknya tidak termaafkan.',
    desire: 'Membuktikan kematian kakaknya bukan kecelakaan dan memulihkan namanya.',
  },
  mainConflict: 'Maya menemukan arsip banjir yang menghubungkan kematian kakaknya dengan jaringan pejabat kota, sementara ayahnya memintanya menghentikan penyelidikan demi keselamatan keluarga.',
  finalQuestion: 'Akankah Maya membuka seluruh kebenaran ketika bukti terakhir juga dapat menghancurkan ayahnya?',
  corePromise: 'Setiap petunjuk membuka lapisan kebohongan kota sekaligus memaksa Maya menilai ulang keluarga yang ingin ia lindungi.',
  endingCandidates: [
    {
      key: 'publish-truth',
      name: 'Arsip Dibuka',
      condition: 'Maya menjaga bukti asli dan memilih kesaksian publik.',
      requiredClosure: ['Dalang sabotase banjir terungkap.', 'Nama kakak Maya dipulihkan.', 'Maya menerima akibat peran ayahnya.'],
    },
    {
      key: 'protect-witnesses',
      name: 'Kebenaran yang Dijaga',
      condition: 'Maya memprioritaskan keselamatan saksi sambil menyerahkan bukti melalui jalur hukum.',
      requiredClosure: ['Para saksi mendapat perlindungan.', 'Jaringan pejabat kehilangan kendali.', 'Maya berdamai dengan kakaknya secara simbolis.'],
    },
  ],
  plotDebts: [
    {
      id: 'debt:missing-rain-ledger',
      question: 'Siapa yang mengambil buku catatan debit hujan dari arsip kota?',
      introducedAt: 1,
      mustProgressBy: [12, 32, 45],
      mustCloseBy: 48,
      status: 'open',
    },
    {
      id: 'debt:last-phone-call',
      question: 'Mengapa kakak Maya menelepon ayah mereka pada malam kematiannya?',
      introducedAt: 3,
      mustProgressBy: [20, 40],
      mustCloseBy: 48,
      status: 'progressing',
    },
    {
      id: 'debt-floodgate-key',
      question: 'Siapa pemilik kunci pintu air yang ditemukan di mobil korban?',
      introducedAt: 8,
      mustProgressBy: [20, 35, 45],
      mustCloseBy: 48,
      status: 'open',
    },
  ],
  revealRunway: [
    { secretId: 'secret:ledger-copy', revealGateChapter: 12 },
    { secretId: 'secret:brother-was-witness', revealGateChapter: 20 },
    { secretId: 'secret:father-signed-order', revealGateChapter: 32 },
    { secretId: 'secret:mayor-ordered-sabotage', revealGateChapter: 45 },
  ],
  motifs: {
    stakes: 'arsip banjir yang dihapus sebelum sidang kota',
    relationship: 'kepercayaan Maya kepada ayah dan jurnalis sekutunya',
    mystery: 'buku debit hujan serta panggilan terakhir kakaknya',
  },
})
