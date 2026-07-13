import { buildContractFixture } from './build-contract-fixture'

export const fantasiPetualanganContract = buildContractFixture({
  storyId: 'contract:fantasi-petualangan:langit-retak',
  title: 'Penjaga Langit yang Retak',
  genre: 'Fantasi Petualangan',
  tone: 'Ajaib, mendesak, dan heroik',
  mainCharacter: {
    name: 'Kirana Awan',
    role: 'Pembuat peta muda yang dapat mendengar pulau terbang',
    wound: 'Kirana merasa bersalah karena ekspedisi masa kecilnya membuat kakaknya hilang di badai langit.',
    desire: 'Menemukan kakaknya dan mencegah kepulauan langit jatuh ke Laut Kabut.',
  },
  mainConflict: 'Kirana harus menyatukan tiga kompas purba sebelum Panglima Varun memakainya untuk mengendalikan Jantung Angin dan menjatuhkan pulau-pulau pemberontak.',
  finalQuestion: 'Akankah Kirana menyelamatkan kepulauan jika harga terakhirnya adalah melepaskan kakak yang selama ini ia cari?',
  corePromise: 'Perjalanan lintas pulau menghadirkan keajaiban baru, sekutu yang diuji, dan rahasia tentang badai lama yang mengubah makna kepahlawanan Kirana.',
  endingCandidates: [
    {
      key: 'restore-wind',
      name: 'Langit Bernapas Lagi',
      condition: 'Kirana menyatukan kompas tanpa menyerahkan Jantung Angin kepada satu kerajaan.',
      requiredClosure: ['Pulau-pulau kembali stabil.', 'Varun kehilangan kendali atas armada.', 'Kirana menerima nasib kakaknya.'],
    },
    {
      key: 'free-the-heart',
      name: 'Jantung Angin Merdeka',
      condition: 'Kirana menghancurkan kompas dan membebaskan sihir langit.',
      requiredClosure: ['Sistem kompas lama berakhir.', 'Penduduk belajar menavigasi langit baru.', 'Kirana memilih tugas sebagai pembuat peta bebas.'],
    },
    {
      key: 'guardian-pact',
      name: 'Sumpah Para Penjaga',
      condition: 'Kirana membagi kuasa kompas kepada perwakilan setiap pulau.',
      requiredClosure: ['Dewan penjaga terbentuk.', 'Utang sekutu terbayar.', 'Ancaman jatuhnya pulau dihentikan.'],
    },
  ],
  plotDebts: [
    {
      id: 'debt:broken-star-map',
      question: 'Siapa yang merobek peta bintang peninggalan ibu Kirana?',
      introducedAt: 1,
      mustProgressBy: [12, 32, 40],
      mustCloseBy: 48,
      status: 'open',
    },
    {
      id: 'debt:brother-signal',
      question: 'Mengapa peluit kakak Kirana terdengar dari wilayah Varun?',
      introducedAt: 4,
      mustProgressBy: [20, 35, 45],
      mustCloseBy: 48,
      status: 'progressing',
    },
    {
      id: 'debt:dragon-oath',
      question: 'Utang apa yang harus dibayar keluarga Kirana kepada naga awan?',
      introducedAt: 7,
      mustProgressBy: [20, 40],
      mustCloseBy: 49,
      status: 'open',
    },
  ],
  revealRunway: [
    { secretId: 'secret:first-compass-is-living', revealGateChapter: 12 },
    { secretId: 'secret:brother-serves-varun', revealGateChapter: 20 },
    { secretId: 'secret:mother-broke-the-map', revealGateChapter: 32 },
    { secretId: 'secret:heart-requires-release', revealGateChapter: 45 },
  ],
  motifs: {
    stakes: 'pulau terbang yang turun setiap kali Jantung Angin melemah',
    relationship: 'kepercayaan Kirana kepada awak kapalnya dan kakak yang hilang',
    mystery: 'peta bintang robek serta suara peluit dari badai',
  },
})
