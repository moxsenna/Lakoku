/**
 * Seed premium Lakoku - Bilik Ketujuh, 50 bab penuh.
 *
 * Format mengikuti pola fixtures/narrative di repo:
 * - import CanonSnapshot, ChapterDraft, Character, ChapterBlueprint dari '@/lib/narrative/types'
 * - export story id, route map, snapshot builder, draft builder, dan all drafts builder.
 *
 * Catatan desain:
 * - 50 ChapterDraft lengkap.
 * - Setiap bab 800-1000 kata.
 * - Branching memakai converging branch: pilihan mengubah state/ending, alur utama tetap 50 bab.
 * - ChapterDraft repo belum punya field choices, jadi rute disimpan di PREMIUM_ROUTE_MAP_50
 *   dan state pilihan masuk ke proposedStateDelta/allowedStateDelta.
 */
import type {
  CanonSnapshot,
  ChapterDraft,
  Character,
  ChapterBlueprint,
} from '@/lib/narrative/types'

export const PREMIUM_BILIK_KETUJUH_50_STORY_ID = "premium:bilik-ketujuh-50"

export type PremiumRouteId = 'truth_route' | 'obedience_route' | 'escape_route'

export const PREMIUM_ROUTE_MAP_50 = {
  "storyId": "premium:bilik-ketujuh-50",
  "title": "Bilik Ketujuh",
  "genre": [
    "misteri",
    "drama keluarga",
    "pesantren",
    "thriller emosional"
  ],
  "premium": true,
  "targetChapterWordCount": {
    "min": 800,
    "max": 1000
  },
  "structure": {
    "totalChapters": 50,
    "branchingModel": "converging_branch",
    "majorChoiceChapters": [
      1,
      6,
      14,
      28,
      45
    ]
  },
  "routes": [
    {
      "id": "truth_route",
      "label": "Rute Kebenaran",
      "description": "Naya membuka bukti secara agresif. Risiko sosial tinggi, reveal lebih cepat terasa, ending cenderung konfrontatif."
    },
    {
      "id": "obedience_route",
      "label": "Rute Kepatuhan Strategis",
      "description": "Naya mengikuti sebagian aturan untuk memancing pengakuan. Risiko manipulasi tinggi, ending lebih terstruktur."
    },
    {
      "id": "escape_route",
      "label": "Rute Kabur dan Bukti Luar",
      "description": "Naya memindahkan bukti ke luar pesantren. Risiko akses hilang, tetapi saksi eksternal lebih kuat."
    }
  ],
  "choiceGates": {
    "1": {
      "prompt": "Apa yang harus Naya lakukan dengan kunci hitam dari Bilik Ketujuh?",
      "choices": [
        {
          "id": "keep_key",
          "label": "Sembunyikan kunci itu dan selidiki sendiri.",
          "route": "truth_route",
          "nextChapter": 2,
          "stateDelta": {
            "route_truth": true,
            "naya_keeps_black_key": true
          }
        },
        {
          "id": "give_key",
          "label": "Serahkan kunci itu kepada Ustazah Marwah.",
          "route": "obedience_route",
          "nextChapter": 2,
          "stateDelta": {
            "route_obedience": true,
            "marwah_receives_black_key": true
          }
        },
        {
          "id": "run_to_city",
          "label": "Kabur malam ini dan cari jawaban dari luar pesantren.",
          "route": "escape_route",
          "nextChapter": 2,
          "stateDelta": {
            "route_escape": true,
            "naya_flees_pesantren": true
          }
        }
      ]
    },
    "6": {
      "prompt": "Setelah arsip anak hilang ditemukan, siapa yang harus dipercaya Naya?",
      "choices": [
        {
          "id": "trust_hafiz",
          "label": "Percaya Hafiz dan simpan arsip di koperasi.",
          "route": "truth_route",
          "nextChapter": 7,
          "stateDelta": {
            "route_truth": true,
            "trust_hafiz": true
          }
        },
        {
          "id": "report_marwah",
          "label": "Laporkan arsip ke Marwah dan lihat reaksinya.",
          "route": "obedience_route",
          "nextChapter": 7,
          "stateDelta": {
            "route_obedience": true,
            "test_marwah": true
          }
        },
        {
          "id": "copy_and_hide",
          "label": "Salin arsip, lalu sembunyikan salinannya di luar pesantren.",
          "route": "escape_route",
          "nextChapter": 7,
          "stateDelta": {
            "route_escape": true,
            "external_copy_created": true
          }
        }
      ]
    },
    "14": {
      "prompt": "Di bawah menara air, Naya harus memilih cara menghadapi Arman dan Marwah.",
      "choices": [
        {
          "id": "confront_arman",
          "label": "Hadapi Arman langsung dan tuntut pengakuan.",
          "route": "truth_route",
          "nextChapter": 15,
          "stateDelta": {
            "route_truth": true,
            "confronts_arman": true
          }
        },
        {
          "id": "follow_marwah_rule",
          "label": "Ikuti syarat Marwah agar bisa masuk arsip resmi.",
          "route": "obedience_route",
          "nextChapter": 15,
          "stateDelta": {
            "route_obedience": true,
            "accepts_marwah_condition": true
          }
        },
        {
          "id": "leave_with_salma",
          "label": "Pergi bersama Salma dan buka bukti dari luar.",
          "route": "escape_route",
          "nextChapter": 15,
          "stateDelta": {
            "route_escape": true,
            "salma_escape_plan": true
          }
        }
      ]
    },
    "28": {
      "prompt": "Bukti sudah di tangan, tetapi cara membukanya akan menentukan siapa yang selamat.",
      "choices": [
        {
          "id": "public_upload",
          "label": "Publikasikan bukti lewat Nadine sekarang juga.",
          "route": "truth_route",
          "nextChapter": 29,
          "stateDelta": {
            "route_truth": true,
            "public_pressure_started": true
          }
        },
        {
          "id": "negotiate_dewan",
          "label": "Serahkan bukti terbatas ke dewan untuk memancing pengakuan.",
          "route": "obedience_route",
          "nextChapter": 29,
          "stateDelta": {
            "route_obedience": true,
            "dewan_trap_started": true
          }
        },
        {
          "id": "steal_full_recording",
          "label": "Menyusup lebih dalam untuk mengambil rekaman utuh.",
          "route": "escape_route",
          "nextChapter": 29,
          "stateDelta": {
            "route_escape": true,
            "recording_heist_started": true
          }
        }
      ]
    },
    "45": {
      "prompt": "Setelah rekaman penuh terbuka, Naya menentukan bentuk keadilan terakhir.",
      "choices": [
        {
          "id": "full_exposure",
          "label": "Buka semua nama pelaku di depan publik.",
          "route": "truth_route",
          "nextChapter": 46,
          "stateDelta": {
            "route_truth": true,
            "ending_full_exposure": true
          }
        },
        {
          "id": "structured_confession",
          "label": "Paksa pengakuan resmi bertahap agar santri tidak jadi korban.",
          "route": "obedience_route",
          "nextChapter": 46,
          "stateDelta": {
            "route_obedience": true,
            "ending_structured_confession": true
          }
        },
        {
          "id": "legal_escape",
          "label": "Bawa bukti keluar dan serahkan langsung ke aparat.",
          "route": "escape_route",
          "nextChapter": 46,
          "stateDelta": {
            "route_escape": true,
            "ending_legal_escape": true
          }
        }
      ]
    }
  },
  "endingRules": [
    {
      "route": "truth_route",
      "condition": "ending_full_exposure=true",
      "endingTone": "katarsis keras; semua nama dibuka, tetapi hubungan keluarga lebih luka."
    },
    {
      "route": "obedience_route",
      "condition": "ending_structured_confession=true",
      "endingTone": "pemulihan institusi; pengakuan resmi bertahap, tetapi sebagian warga menilai Naya terlalu lunak."
    },
    {
      "route": "escape_route",
      "condition": "ending_legal_escape=true",
      "endingTone": "jalur hukum kuat; Naya kehilangan kendali narasi publik sebentar, tetapi bukti lebih aman."
    }
  ]
} as const

const characters: Character[] = [
  {
    "id": "char:naya",
    "storyId": "premium:bilik-ketujuh-50",
    "canonicalName": "Naya",
    "role": "protagonis",
    "motivation": "Mencari kebenaran tentang kematian ibunya dan rahasia Bilik Ketujuh",
    "introducedChapter": 1,
    "status": "ALIVE"
  },
  {
    "id": "char:ustazah-marwah",
    "storyId": "premium:bilik-ketujuh-50",
    "canonicalName": "Marwah",
    "role": "wali asrama dan penjaga rahasia",
    "motivation": "Menjaga nama pesantren dan menutup luka lama keluarga Naya",
    "introducedChapter": 1,
    "status": "ALIVE"
  },
  {
    "id": "char:hafiz",
    "storyId": "premium:bilik-ketujuh-50",
    "canonicalName": "Hafiz",
    "role": "penjaga koperasi dan saksi ambigu",
    "motivation": "Membayar utang masa lalu kepada ibu Naya tanpa membuka seluruh kebenaran terlalu cepat",
    "introducedChapter": 1,
    "status": "ALIVE"
  },
  {
    "id": "char:kyai-hamid",
    "storyId": "premium:bilik-ketujuh-50",
    "canonicalName": "Hamid",
    "role": "pengasuh pesantren",
    "motivation": "Melindungi pesantren dari skandal lama dengan cara yang makin keliru",
    "introducedChapter": 2,
    "status": "ALIVE"
  },
  {
    "id": "char:salma",
    "storyId": "premium:bilik-ketujuh-50",
    "canonicalName": "Salma",
    "role": "sahabat masa kecil Naya",
    "motivation": "Menolong Naya meski keluarganya terancam ikut terseret",
    "introducedChapter": 3,
    "status": "ALIVE"
  },
  {
    "id": "char:bu-rukmini",
    "storyId": "premium:bilik-ketujuh-50",
    "canonicalName": "Rukmini",
    "role": "arsiparis tua",
    "motivation": "Menebus kesalahan karena pernah memalsukan catatan santri",
    "introducedChapter": 7,
    "status": "ALIVE"
  },
  {
    "id": "char:arman",
    "storyId": "premium:bilik-ketujuh-50",
    "canonicalName": "Arman",
    "role": "tukang kebun beridentitas palsu",
    "motivation": "Melindungi Naya dari jauh setelah dipaksa menghilang",
    "introducedChapter": 13,
    "status": "ALIVE"
  },
  {
    "id": "char:jamal",
    "storyId": "premium:bilik-ketujuh-50",
    "canonicalName": "Jamal",
    "role": "broker tanah",
    "motivation": "Menguasai tanah wakaf dengan menekan pengurus pesantren",
    "introducedChapter": 18,
    "status": "ALIVE"
  },
  {
    "id": "char:nadine",
    "storyId": "premium:bilik-ketujuh-50",
    "canonicalName": "Nadine",
    "role": "reporter alumni",
    "motivation": "Membuka jaringan pemalsuan wakaf yang pernah menimpa keluarganya",
    "introducedChapter": 26,
    "status": "ALIVE"
  },
  {
    "id": "char:rafi",
    "storyId": "premium:bilik-ketujuh-50",
    "canonicalName": "Rafi",
    "role": "kurir buku ekspedisi",
    "motivation": "Mencari adiknya yang hilang dari daftar santri lama",
    "introducedChapter": 33,
    "status": "ALIVE"
  },
  {
    "id": "char:pak-sastro",
    "storyId": "premium:bilik-ketujuh-50",
    "canonicalName": "Sastro",
    "role": "anggota dewan wakaf",
    "motivation": "Menyelamatkan dirinya dengan memilih pihak yang menang",
    "introducedChapter": 38,
    "status": "ALIVE"
  },
  {
    "id": "char:bu-laila",
    "storyId": "premium:bilik-ketujuh-50",
    "canonicalName": "Laila",
    "role": "ibu Naya dalam arsip dan ingatan",
    "motivation": "Meninggalkan bukti agar anaknya kelak bisa memulihkan nama keluarga",
    "introducedChapter": 1,
    "status": "DEAD"
  }
]

const aliases: CanonSnapshot['aliases'] = [
  {
    "characterId": "char:naya",
    "alias": "Nay",
    "aliasType": "NICKNAME"
  },
  {
    "characterId": "char:ustazah-marwah",
    "alias": "Ustazah Marwah",
    "aliasType": "TITLE"
  },
  {
    "characterId": "char:ustazah-marwah",
    "alias": "Bu Marwah",
    "aliasType": "NAME"
  },
  {
    "characterId": "char:hafiz",
    "alias": "Mas Hafiz",
    "aliasType": "TITLE"
  },
  {
    "characterId": "char:kyai-hamid",
    "alias": "Kyai Hamid",
    "aliasType": "TITLE"
  },
  {
    "characterId": "char:bu-rukmini",
    "alias": "Bu Rukmini",
    "aliasType": "TITLE"
  },
  {
    "characterId": "char:arman",
    "alias": "Pak Arman",
    "aliasType": "TITLE"
  },
  {
    "characterId": "char:jamal",
    "alias": "Pak Jamal",
    "aliasType": "TITLE"
  },
  {
    "characterId": "char:nadine",
    "alias": "Mbak Nadine",
    "aliasType": "TITLE"
  },
  {
    "characterId": "char:rafi",
    "alias": "Mas Rafi",
    "aliasType": "TITLE"
  },
  {
    "characterId": "char:pak-sastro",
    "alias": "Pak Sastro",
    "aliasType": "TITLE"
  },
  {
    "characterId": "char:bu-laila",
    "alias": "Bu Laila",
    "aliasType": "TITLE"
  }
]

const secrets: CanonSnapshot['secrets'] = [
  {
    "id": "secret:bilik-arsip-anak-hilang",
    "description": "Bilik Ketujuh adalah ruang arsip identitas anak-anak yang pernah disembunyikan dari daftar resmi pesantren.",
    "revealGateChapter": 6,
    "revealed": false
  },
  {
    "id": "secret:daftar-nama-laila",
    "description": "Laila, ibu Naya, menyusun daftar nama santri yang dipindahkan diam-diam sebelum ia meninggal.",
    "revealGateChapter": 10,
    "revealed": false
  },
  {
    "id": "secret:ayah-naya-hidup",
    "description": "Ayah Naya masih hidup dengan identitas Arman setelah dipaksa menandatangani pengakuan palsu.",
    "revealGateChapter": 16,
    "revealed": false
  },
  {
    "id": "secret:marwah-saudari-laila",
    "description": "Marwah adalah saudari tiri Laila dan ikut membuat keputusan yang memisahkan Naya dari ayahnya.",
    "revealGateChapter": 21,
    "revealed": false
  },
  {
    "id": "secret:kunci-peti-wakaf",
    "description": "Kunci hitam membuka peti wakaf berisi bukti pengalihan tanah pesantren secara ilegal.",
    "revealGateChapter": 24,
    "revealed": false
  },
  {
    "id": "secret:hamid-menutup-perjanjian",
    "description": "Hamid menutup perjanjian palsu karena takut pesantren runtuh dan para santri kehilangan tempat belajar.",
    "revealGateChapter": 32,
    "revealed": false
  },
  {
    "id": "secret:rekaman-bilik-ketujuh",
    "description": "Rekaman di Bilik Ketujuh membuktikan Jamal dan dewan wakaf menekan Laila pada malam terakhirnya.",
    "revealGateChapter": 44,
    "revealed": false
  },
  {
    "id": "secret:pengakuan-terakhir",
    "description": "Pengakuan terakhir Marwah menunjukkan bahwa Laila dibunuh secara sosial, bukan hanya disingkirkan dari keluarga.",
    "revealGateChapter": 45,
    "revealed": false
  },
  {
    "id": "secret:nama-yang-kembali",
    "description": "Nama Naya dan Laila dipulihkan dalam daftar wakaf pesantren setelah bukti dibuka di depan publik.",
    "revealGateChapter": 50,
    "revealed": false
  }
]

const facts: CanonSnapshot['facts'] = [
  {
    "id": "fact:kunci-hitam",
    "statement": "Naya menemukan kunci hitam di ambang Bilik Ketujuh pada malam kepulangannya.",
    "subjectCharacterId": "char:naya",
    "establishedChapter": 1,
    "salience": 0.95,
    "loadBearing": true,
    "paidOff": false,
    "storyId": "premium:bilik-ketujuh-50"
  },
  {
    "id": "fact:larangan-bilik",
    "statement": "Bilik Ketujuh dilarang dibuka sejak kematian Laila.",
    "subjectCharacterId": "char:ustazah-marwah",
    "establishedChapter": 1,
    "salience": 0.9,
    "loadBearing": true,
    "paidOff": false,
    "storyId": "premium:bilik-ketujuh-50"
  },
  {
    "id": "fact:foto-laila",
    "statement": "Foto Laila masih tergantung di lorong asrama meski namanya jarang disebut.",
    "subjectCharacterId": "char:naya",
    "establishedChapter": 1,
    "salience": 0.5,
    "loadBearing": false,
    "paidOff": false,
    "storyId": "premium:bilik-ketujuh-50"
  },
  {
    "id": "fact:hafiz-mengenal-laila",
    "statement": "Hafiz mengenal Laila dan tampak takut saat Naya menyebut Bilik Ketujuh.",
    "subjectCharacterId": "char:hafiz",
    "establishedChapter": 1,
    "salience": 0.75,
    "loadBearing": true,
    "paidOff": false,
    "storyId": "premium:bilik-ketujuh-50"
  },
  {
    "id": "fact:catatan-anak-hilang",
    "statement": "Ada catatan anak-anak yang keluar dari pesantren tanpa surat pindah resmi.",
    "subjectCharacterId": null,
    "establishedChapter": 6,
    "salience": 0.9,
    "loadBearing": true,
    "paidOff": false,
    "storyId": "premium:bilik-ketujuh-50"
  },
  {
    "id": "fact:daftar-laila",
    "statement": "Laila menyimpan daftar nama santri yang dipindahkan diam-diam.",
    "subjectCharacterId": "char:bu-laila",
    "establishedChapter": 10,
    "salience": 0.9,
    "loadBearing": true,
    "paidOff": false,
    "storyId": "premium:bilik-ketujuh-50"
  },
  {
    "id": "fact:arman-adalah-ayah",
    "statement": "Arman adalah ayah Naya yang memakai nama baru.",
    "subjectCharacterId": "char:arman",
    "establishedChapter": 16,
    "salience": 0.95,
    "loadBearing": true,
    "paidOff": false,
    "storyId": "premium:bilik-ketujuh-50"
  },
  {
    "id": "fact:kunci-peti",
    "statement": "Kunci hitam cocok dengan peti wakaf peninggalan pendiri pesantren.",
    "subjectCharacterId": "char:naya",
    "establishedChapter": 24,
    "salience": 0.95,
    "loadBearing": true,
    "paidOff": false,
    "storyId": "premium:bilik-ketujuh-50"
  },
  {
    "id": "fact:rekaman-laila",
    "statement": "Rekaman di Bilik Ketujuh menyimpan suara Laila pada malam terakhirnya.",
    "subjectCharacterId": "char:bu-laila",
    "establishedChapter": 44,
    "salience": 1.0,
    "loadBearing": true,
    "paidOff": false,
    "storyId": "premium:bilik-ketujuh-50"
  }
]

const knowledge: CanonSnapshot['knowledge'] = [
  {
    "characterId": "char:naya",
    "factId": "fact:kunci-hitam",
    "knownFromChapter": 1
  },
  {
    "characterId": "char:naya",
    "factId": "fact:larangan-bilik",
    "knownFromChapter": 1
  },
  {
    "characterId": "char:ustazah-marwah",
    "factId": "fact:larangan-bilik",
    "knownFromChapter": 1
  },
  {
    "characterId": "char:hafiz",
    "factId": "fact:hafiz-mengenal-laila",
    "knownFromChapter": 1
  },
  {
    "characterId": "char:naya",
    "factId": "fact:catatan-anak-hilang",
    "knownFromChapter": 6
  },
  {
    "characterId": "char:bu-rukmini",
    "factId": "fact:catatan-anak-hilang",
    "knownFromChapter": 7
  },
  {
    "characterId": "char:naya",
    "factId": "fact:daftar-laila",
    "knownFromChapter": 10
  },
  {
    "characterId": "char:arman",
    "factId": "fact:arman-adalah-ayah",
    "knownFromChapter": 16
  },
  {
    "characterId": "char:naya",
    "factId": "fact:arman-adalah-ayah",
    "knownFromChapter": 16
  },
  {
    "characterId": "char:naya",
    "factId": "fact:kunci-peti",
    "knownFromChapter": 24
  },
  {
    "characterId": "char:nadine",
    "factId": "fact:rekaman-laila",
    "knownFromChapter": 44
  },
  {
    "characterId": "char:naya",
    "factId": "fact:rekaman-laila",
    "knownFromChapter": 44
  }
]

const threads: CanonSnapshot['threads'] = [
  {
    "id": "thread:bilik-ketujuh",
    "title": "Misteri Bilik Ketujuh",
    "status": "OPEN",
    "openedChapter": 1,
    "lastTouchedChapter": 50,
    "payoffWindow": 50,
    "isMainMystery": true
  },
  {
    "id": "thread:kematian-laila",
    "title": "Kematian dan penghapusan nama Laila",
    "status": "OPEN",
    "openedChapter": 1,
    "lastTouchedChapter": 50,
    "payoffWindow": 45,
    "isMainMystery": true
  },
  {
    "id": "thread:kunci-wakaf",
    "title": "Kunci hitam dan tanah wakaf",
    "status": "DEVELOPING",
    "openedChapter": 1,
    "lastTouchedChapter": 48,
    "payoffWindow": 48,
    "isMainMystery": true
  },
  {
    "id": "thread:loyalitas-hafiz",
    "title": "Apakah Hafiz penolong atau pengkhianat",
    "status": "DEVELOPING",
    "openedChapter": 1,
    "lastTouchedChapter": 40,
    "payoffWindow": 40,
    "isMainMystery": false
  },
  {
    "id": "thread:keluarga-naya",
    "title": "Keluarga Naya yang dipisahkan rahasia",
    "status": "DEVELOPING",
    "openedChapter": 13,
    "lastTouchedChapter": 50,
    "payoffWindow": 50,
    "isMainMystery": false
  }
]

const voiceSheets: CanonSnapshot['voiceSheets'] = [
  {
    "characterId": "char:naya",
    "register": "emosional, tajam, mudah dibaca",
    "speechHabits": [
      "bertanya langsung",
      "mengulang kata kunci saat panik"
    ],
    "forbiddenWords": [
      "anjir",
      "gue"
    ],
    "sampleLines": [
      "Aku pulang bukan untuk diam, Ustazah. Aku cuma ingin tahu kenapa nama Ibu dihapus."
    ]
  },
  {
    "characterId": "char:ustazah-marwah",
    "register": "tenang, resmi, menekan",
    "speechHabits": [
      "kalimat pendek",
      "menghindari pengakuan langsung"
    ],
    "forbiddenWords": [],
    "sampleLines": [
      "Tidak semua pintu dibuka untuk menyelamatkan orang. Ada pintu yang ditutup agar orang lain tetap hidup."
    ]
  },
  {
    "characterId": "char:hafiz",
    "register": "lembut, gelisah, banyak jeda",
    "speechHabits": [
      "memanggil Naya dengan nama kecil",
      "menahan informasi"
    ],
    "forbiddenWords": [],
    "sampleLines": [
      "Nay, kalau kamu masuk terlalu jauh, mereka tidak hanya mengambil arsip. Mereka bisa mengambil hidupmu."
    ]
  },
  {
    "characterId": "char:arman",
    "register": "rendah, tertahan, penuh rasa bersalah",
    "speechHabits": [
      "menjawab pendek",
      "menyebut Laila saat kehilangan kendali"
    ],
    "forbiddenWords": [],
    "sampleLines": [
      "Ayah tidak mati, Naya. Ayah hanya dibuat tidak berhak pulang."
    ]
  }
]

const actRollups: CanonSnapshot['actRollups'] = [
  {
    "actNumber": 1,
    "summary": "Act 1: act 1 pulang dan pintu terlarang dari Bab 1 sampai 6.",
    "stateDelta": {
      "act1_done": true
    },
    "coversFromChapter": 1,
    "coversToChapter": 6
  },
  {
    "actNumber": 2,
    "summary": "Act 2: act 2 jejak laila dari Bab 7 sampai 12.",
    "stateDelta": {
      "act2_done": true
    },
    "coversFromChapter": 7,
    "coversToChapter": 12
  },
  {
    "actNumber": 3,
    "summary": "Act 3: act 3 keluarga yang dipisahkan dari Bab 13 sampai 19.",
    "stateDelta": {
      "act3_done": true
    },
    "coversFromChapter": 13,
    "coversToChapter": 19
  },
  {
    "actNumber": 4,
    "summary": "Act 4: act 4 wakaf dan peti hitam dari Bab 20 sampai 25.",
    "stateDelta": {
      "act4_done": true
    },
    "coversFromChapter": 20,
    "coversToChapter": 25
  },
  {
    "actNumber": 5,
    "summary": "Act 5: act 5 bukti dari luar dari Bab 26 sampai 32.",
    "stateDelta": {
      "act5_done": true
    },
    "coversFromChapter": 26,
    "coversToChapter": 32
  },
  {
    "actNumber": 6,
    "summary": "Act 6: act 6 jaringan dewan dari Bab 33 sampai 39.",
    "stateDelta": {
      "act6_done": true
    },
    "coversFromChapter": 33,
    "coversToChapter": 39
  },
  {
    "actNumber": 7,
    "summary": "Act 7: act 7 rekaman dan pengakuan dari Bab 40 sampai 45.",
    "stateDelta": {
      "act7_done": true
    },
    "coversFromChapter": 40,
    "coversToChapter": 45
  },
  {
    "actNumber": 8,
    "summary": "Act 8: act 8 pemulihan nama dari Bab 46 sampai 50.",
    "stateDelta": {
      "act8_done": true
    },
    "coversFromChapter": 46,
    "coversToChapter": 50
  }
]

const chapterSpecs = [
  {
    "chapterNumber": 1,
    "title": "Kunci di Ambang Bilik",
    "phase": "ACT_1_PULANG_DAN_PINTU_TERLARANG",
    "chapterGoal": "Menggerakkan konflik Bilik Ketujuh melalui kunci hitam di depan pintu Bilik Ketujuh dan tekanan utama: Marwah melarang Naya menyentuh pintu.",
    "mandatoryBeats": [
      "kunci hitam di depan pintu Bilik Ketujuh",
      "Marwah melarang Naya menyentuh pintu",
      "Hafiz memberi isyarat agar Naya menyembunyikan kunci",
      "suara langkah berhenti di balik pintu yang seharusnya kosong"
    ],
    "cast": [
      "char:naya",
      "char:ustazah-marwah",
      "char:hafiz"
    ],
    "threadIds": [
      "thread:bilik-ketujuh",
      "thread:kematian-laila"
    ],
    "paragraphs": [
      "Lorong asrama setelah magrib tidak pernah terasa benar bagi Naya. Setiap sudutnya seperti menyimpan napas orang yang menunggu dipanggil, sementara kunci hitam di depan pintu Bilik Ketujuh terletak di hadapannya dengan tenang yang nyaris mengejek. Naya mencoba mengingat pesan ibunya: jangan takut pada pintu, takutlah pada orang yang menyuruhmu tidak bertanya. Tetapi pesan itu dulu hanya terdengar seperti nasihat untuk anak kecil yang sering kehilangan sandal di masjid. Sekarang, di usia yang memaksa dirinya terlihat dewasa, kalimat itu berubah menjadi pisau. Ia berdiri terlalu lama, sampai suara sandal dari arah belakang membuat tengkuknya menegang.",
      "Marwah melarang Naya menyentuh pintu. Kalimat itu datang tidak selalu dengan teriakan; justru semakin pelan diucapkan, semakin jelas ancamannya. Naya tahu ada orang-orang yang menguasai tempat ini bukan karena mereka benar, melainkan karena semua orang sudah terbiasa menunduk. Ia menatap wajah Marwah, mencari celah yang bisa dibaca, tetapi yang ia temukan hanya kegelisahan yang disembunyikan di balik sikap biasa. Di pesantren, kebohongan tidak memakai pakaian hitam. Ia memakai senyum ustazah, kitab yang ditutup mendadak, dan aturan yang baru disebut setelah seseorang hampir menemukan jawaban.",
      "Hafiz memberi isyarat agar Naya menyembunyikan kunci. Bantuan itu kecil, hampir tidak pantas disebut pertolongan, namun bagi Naya yang mulai kehabisan tempat berpijak, hal kecil bisa terasa seperti tangan di tepi sumur. Ia menyimpan napas, mendengar bunyi malam, dan membiarkan dirinya membaca ulang semua kejadian sejak pulang. Kenapa semua orang tahu nama ibunya, tetapi tidak seorang pun berani mengucapkannya dengan wajar? Kenapa setiap arsip tentang Laila selalu punya bekas sobekan? Hafiz pernah berkata bahwa beberapa keluarga tidak runtuh karena miskin, melainkan karena terlalu lama menyimpan malu milik orang lain.",
      "Petunjuk tentang kunci hitam di depan pintu Bilik Ketujuh membuat Naya sadar bahwa misteri ini tidak berdiri sendiri. Ada tanah wakaf, nama anak-anak yang dipindahkan, para pengurus yang takut kehilangan muka, dan keluarga yang dibiarkan patah agar bangunan pesantren tetap terlihat kokoh. Malam itu cerita memberinya simpang yang tidak sopan: membongkar sekarang, mengikuti aturan yang mungkin busuk, atau menyelamatkan bukti dengan cara yang membuatnya tampak bersalah. Pilihan itu tidak pernah benar-benar bersih. Jalan pertama bisa menghancurkan orang yang masih ingin ia percaya. Jalan kedua bisa menjadikannya alat para pembohong. Jalan ketiga bisa membuatnya kehilangan akses pada semua pintu yang baru mulai terbuka. Namun diam jelas bukan pilihan; diam adalah bahasa yang selama ini dipakai untuk mengubur Laila.",
      "Ketika Naya menyentuh bukti itu, foto Laila seperti menatap dari dinding. Dadanya terasa seperti dipenuhi air yang tidak menemukan jalan keluar. Ia marah pada ibunya karena meninggalkan teka-teki, marah pada ayah yang entah hidup atau mati, marah pada Marwah yang selalu berbicara seolah luka orang lain adalah urusan administrasi. Tetapi paling dalam, Naya marah pada dirinya sendiri karena masih ingin seseorang berkata bahwa semua ini salah paham. Anak yang kehilangan ibu kadang tidak mencari kebenaran dulu; ia mencari satu orang dewasa yang bersedia mengaku telah gagal melindunginya.",
      "Dialog yang terjadi setelah itu pendek, tetapi menancap. 'Kamu tidak paham akibatnya,' kata suara yang menahan panik. Naya menjawab pelan, 'Mungkin. Tapi kalian terlalu lama memakai kata akibat untuk menutup kata dosa.' Ruangan mendadak sempit. Marwah memalingkan muka, seolah kalimat itu mengenai bagian dirinya yang paling ia sembunyikan. Di luar, suara santri mengaji terdengar jauh, bersih, hampir tidak cocok dengan kebusukan yang pelan-pelan muncul di balik dinding. Naya mendadak paham mengapa ibunya dulu selalu memilih duduk di belakang, dekat pintu keluar.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Makin malam, tekanan makin rapi. Ada yang mengunci pintu, ada yang memindahkan map, ada yang mengirim pesan tanpa nama. Naya mulai membedakan takut yang melumpuhkan dan takut yang memberi tenaga. Ia mencatat urutan kejadian dalam kepala: siapa datang lebih dulu, siapa terlalu cepat tahu, siapa pura-pura kaget, siapa menyebut nama Laila dengan suara seperti meminta ampun. Jika suatu hari ia harus berdiri di depan semua orang, ia tidak boleh hanya membawa tangis. Ia harus membawa urutan, tanggal, suara, dan bukti yang tidak bisa dipelintir menjadi cerita anak durhaka.",
      "Menjelang akhir babak itu, suara langkah berhenti di balik pintu yang seharusnya kosong. Naya tidak langsung bergerak. Tubuhnya ingin lari, tetapi sesuatu di dalam dirinya justru menjadi tenang, seperti orang yang akhirnya melihat bentuk musuh setelah lama dipukul dari gelap. Ia menggenggam bukti yang tersisa, menatap lorong, lalu berbisik pada nama ibunya tanpa suara. Besok mereka mungkin menuduhnya. Besok ia mungkin terusir. Besok orang-orang yang terlihat saleh bisa menunjukkan wajah asli. Namun malam ini satu hal pasti: pintu yang pernah ditutup untuk Laila mulai terbuka untuk Naya."
    ],
    "wordCount": 873,
    "sceneCount": 4,
    "reveals": [],
    "newNamedCharacters": [],
    "proposedStateDelta": {
      "chapter1_progress": true,
      "tension": true,
      "choice_chapter_1": true
    },
    "dialogue": [
      {
        "characterId": "char:naya",
        "text": "Aku tidak pulang untuk jadi anak baik di depan kebohongan."
      },
      {
        "characterId": "char:ustazah-marwah",
        "text": "Kalau kamu terus membuka pintu itu, tidak semua orang bisa diselamatkan."
      }
    ],
    "emotionBeats": [
      {
        "characterId": "char:naya",
        "targetCharacterId": "char:ustazah-marwah",
        "valence": "cold"
      }
    ]
  },
  {
    "chapterNumber": 2,
    "title": "Gerbang yang Terkunci dari Dalam",
    "phase": "ACT_1_PULANG_DAN_PINTU_TERLARANG",
    "chapterGoal": "Menggerakkan konflik Bilik Ketujuh melalui rantai gerbang terkunci dari sisi dalam dan tekanan utama: Kyai Hamid meminta Naya pulang setelah subuh.",
    "mandatoryBeats": [
      "rantai gerbang terkunci dari sisi dalam",
      "Kyai Hamid meminta Naya pulang setelah subuh",
      "Hafiz mengantar Naya ke koperasi yang gelap",
      "lampu pos ronda menyala sendiri"
    ],
    "cast": [
      "char:naya",
      "char:ustazah-marwah",
      "char:hafiz",
      "char:kyai-hamid"
    ],
    "threadIds": [
      "thread:bilik-ketujuh",
      "thread:kematian-laila"
    ],
    "paragraphs": [
      "Gerbang pesantren yang berkarat tidak pernah terasa benar bagi Naya. Setiap sudutnya seperti menyimpan napas orang yang menunggu dipanggil, sementara rantai gerbang terkunci dari sisi dalam terletak di hadapannya dengan tenang yang nyaris mengejek. Naya mencoba mengingat pesan ibunya: jangan takut pada pintu, takutlah pada orang yang menyuruhmu tidak bertanya. Tetapi pesan itu dulu hanya terdengar seperti nasihat untuk anak kecil yang sering kehilangan sandal di masjid. Sekarang, di usia yang memaksa dirinya terlihat dewasa, kalimat itu berubah menjadi pisau. Ia berdiri terlalu lama, sampai suara sandal dari arah belakang membuat tengkuknya menegang.",
      "Kyai Hamid meminta Naya pulang setelah subuh. Kalimat itu datang tidak selalu dengan teriakan; justru semakin pelan diucapkan, semakin jelas ancamannya. Naya tahu ada orang-orang yang menguasai tempat ini bukan karena mereka benar, melainkan karena semua orang sudah terbiasa menunduk. Ia menatap wajah Marwah, mencari celah yang bisa dibaca, tetapi yang ia temukan hanya kegelisahan yang disembunyikan di balik sikap biasa. Di pesantren, kebohongan tidak memakai pakaian hitam. Ia memakai senyum ustazah, kitab yang ditutup mendadak, dan aturan yang baru disebut setelah seseorang hampir menemukan jawaban.",
      "Hafiz mengantar Naya ke koperasi yang gelap. Bantuan itu kecil, hampir tidak pantas disebut pertolongan, namun bagi Naya yang mulai kehabisan tempat berpijak, hal kecil bisa terasa seperti tangan di tepi sumur. Ia menyimpan napas, mendengar bunyi malam, dan membiarkan dirinya membaca ulang semua kejadian sejak pulang. Kenapa semua orang tahu nama ibunya, tetapi tidak seorang pun berani mengucapkannya dengan wajar? Kenapa setiap arsip tentang Laila selalu punya bekas sobekan? Hafiz pernah berkata bahwa beberapa keluarga tidak runtuh karena miskin, melainkan karena terlalu lama menyimpan malu milik orang lain.",
      "Petunjuk tentang rantai gerbang terkunci dari sisi dalam membuat Naya sadar bahwa misteri ini tidak berdiri sendiri. Ada tanah wakaf, nama anak-anak yang dipindahkan, para pengurus yang takut kehilangan muka, dan keluarga yang dibiarkan patah agar bangunan pesantren tetap terlihat kokoh. Ia ingat tiga jalan yang sejak awal membayanginya: menggali sendiri sampai kebenaran telanjang, patuh sebentar untuk memancing pengakuan, atau keluar dari pagar agar bukti tidak ikut dikubur. Pilihan itu tidak pernah benar-benar bersih. Jalan pertama bisa menghancurkan orang yang masih ingin ia percaya. Jalan kedua bisa menjadikannya alat para pembohong. Jalan ketiga bisa membuatnya kehilangan akses pada semua pintu yang baru mulai terbuka. Namun diam jelas bukan pilihan; diam adalah bahasa yang selama ini dipakai untuk mengubur Laila.",
      "Ketika Naya menyentuh bukti itu, nama Laila tidak muncul di buku tamu. Dadanya terasa seperti dipenuhi air yang tidak menemukan jalan keluar. Ia marah pada ibunya karena meninggalkan teka-teki, marah pada ayah yang entah hidup atau mati, marah pada Marwah yang selalu berbicara seolah luka orang lain adalah urusan administrasi. Tetapi paling dalam, Naya marah pada dirinya sendiri karena masih ingin seseorang berkata bahwa semua ini salah paham. Anak yang kehilangan ibu kadang tidak mencari kebenaran dulu; ia mencari satu orang dewasa yang bersedia mengaku telah gagal melindunginya.",
      "Dialog yang terjadi setelah itu pendek, tetapi menancap. 'Kamu tidak paham akibatnya,' kata suara yang menahan panik. Naya menjawab pelan, 'Mungkin. Tapi kalian terlalu lama memakai kata akibat untuk menutup kata dosa.' Ruangan mendadak sempit. Marwah memalingkan muka, seolah kalimat itu mengenai bagian dirinya yang paling ia sembunyikan. Di luar, suara santri mengaji terdengar jauh, bersih, hampir tidak cocok dengan kebusukan yang pelan-pelan muncul di balik dinding. Naya mendadak paham mengapa ibunya dulu selalu memilih duduk di belakang, dekat pintu keluar.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Makin malam, tekanan makin rapi. Ada yang mengunci pintu, ada yang memindahkan map, ada yang mengirim pesan tanpa nama. Naya mulai membedakan takut yang melumpuhkan dan takut yang memberi tenaga. Ia mencatat urutan kejadian dalam kepala: siapa datang lebih dulu, siapa terlalu cepat tahu, siapa pura-pura kaget, siapa menyebut nama Laila dengan suara seperti meminta ampun. Jika suatu hari ia harus berdiri di depan semua orang, ia tidak boleh hanya membawa tangis. Ia harus membawa urutan, tanggal, suara, dan bukti yang tidak bisa dipelintir menjadi cerita anak durhaka.",
      "Menjelang akhir babak itu, lampu pos ronda menyala sendiri. Naya tidak langsung bergerak. Tubuhnya ingin lari, tetapi sesuatu di dalam dirinya justru menjadi tenang, seperti orang yang akhirnya melihat bentuk musuh setelah lama dipukul dari gelap. Ia menggenggam bukti yang tersisa, menatap lorong, lalu berbisik pada nama ibunya tanpa suara. Besok mereka mungkin menuduhnya. Besok ia mungkin terusir. Besok orang-orang yang terlihat saleh bisa menunjukkan wajah asli. Namun malam ini satu hal pasti: pintu yang pernah ditutup untuk Laila mulai terbuka untuk Naya."
    ],
    "wordCount": 873,
    "sceneCount": 4,
    "reveals": [],
    "newNamedCharacters": [
      "char:kyai-hamid"
    ],
    "proposedStateDelta": {
      "chapter2_progress": true,
      "tension": true
    },
    "dialogue": [
      {
        "characterId": "char:naya",
        "text": "Aku tidak pulang untuk jadi anak baik di depan kebohongan."
      },
      {
        "characterId": "char:ustazah-marwah",
        "text": "Kalau kamu terus membuka pintu itu, tidak semua orang bisa diselamatkan."
      }
    ],
    "emotionBeats": [
      {
        "characterId": "char:naya",
        "targetCharacterId": "char:ustazah-marwah",
        "valence": "cold"
      }
    ]
  },
  {
    "chapterNumber": 3,
    "title": "Salma Membawa Bekas Luka",
    "phase": "ACT_1_PULANG_DAN_PINTU_TERLARANG",
    "chapterGoal": "Menggerakkan konflik Bilik Ketujuh melalui bekas luka di pergelangan Salma dan tekanan utama: Salma takut keluarganya diseret.",
    "mandatoryBeats": [
      "bekas luka di pergelangan Salma",
      "Salma takut keluarganya diseret",
      "Naya membaca sobekan jadwal piket lama",
      "Salma berkata ada satu nama yang tidak boleh disebut"
    ],
    "cast": [
      "char:naya",
      "char:salma",
      "char:ustazah-marwah"
    ],
    "threadIds": [
      "thread:kematian-laila"
    ],
    "paragraphs": [
      "Dapur santri yang masih hangat tidak pernah terasa benar bagi Naya. Setiap sudutnya seperti menyimpan napas orang yang menunggu dipanggil, sementara bekas luka di pergelangan Salma terletak di hadapannya dengan tenang yang nyaris mengejek. Naya mencoba mengingat pesan ibunya: jangan takut pada pintu, takutlah pada orang yang menyuruhmu tidak bertanya. Tetapi pesan itu dulu hanya terdengar seperti nasihat untuk anak kecil yang sering kehilangan sandal di masjid. Sekarang, di usia yang memaksa dirinya terlihat dewasa, kalimat itu berubah menjadi pisau. Ia berdiri terlalu lama, sampai suara sandal dari arah belakang membuat tengkuknya menegang.",
      "Salma takut keluarganya diseret. Kalimat itu datang tidak selalu dengan teriakan; justru semakin pelan diucapkan, semakin jelas ancamannya. Naya tahu ada orang-orang yang menguasai tempat ini bukan karena mereka benar, melainkan karena semua orang sudah terbiasa menunduk. Ia menatap wajah Salma, mencari celah yang bisa dibaca, tetapi yang ia temukan hanya kegelisahan yang disembunyikan di balik sikap biasa. Di pesantren, kebohongan tidak memakai pakaian hitam. Ia memakai senyum ustazah, kitab yang ditutup mendadak, dan aturan yang baru disebut setelah seseorang hampir menemukan jawaban.",
      "Naya membaca sobekan jadwal piket lama. Bantuan itu kecil, hampir tidak pantas disebut pertolongan, namun bagi Naya yang mulai kehabisan tempat berpijak, hal kecil bisa terasa seperti tangan di tepi sumur. Ia menyimpan napas, mendengar bunyi malam, dan membiarkan dirinya membaca ulang semua kejadian sejak pulang. Kenapa semua orang tahu nama ibunya, tetapi tidak seorang pun berani mengucapkannya dengan wajar? Kenapa setiap arsip tentang Laila selalu punya bekas sobekan? Marwah pernah berkata bahwa beberapa keluarga tidak runtuh karena miskin, melainkan karena terlalu lama menyimpan malu milik orang lain.",
      "Petunjuk tentang bekas luka di pergelangan Salma membuat Naya sadar bahwa misteri ini tidak berdiri sendiri. Ada tanah wakaf, nama anak-anak yang dipindahkan, para pengurus yang takut kehilangan muka, dan keluarga yang dibiarkan patah agar bangunan pesantren tetap terlihat kokoh. Ia ingat tiga jalan yang sejak awal membayanginya: menggali sendiri sampai kebenaran telanjang, patuh sebentar untuk memancing pengakuan, atau keluar dari pagar agar bukti tidak ikut dikubur. Pilihan itu tidak pernah benar-benar bersih. Jalan pertama bisa menghancurkan orang yang masih ingin ia percaya. Jalan kedua bisa menjadikannya alat para pembohong. Jalan ketiga bisa membuatnya kehilangan akses pada semua pintu yang baru mulai terbuka. Namun diam jelas bukan pilihan; diam adalah bahasa yang selama ini dipakai untuk mengubur Laila.",
      "Ketika Naya menyentuh bukti itu, ingatan kecil tentang ibu yang menunggu di tangga. Dadanya terasa seperti dipenuhi air yang tidak menemukan jalan keluar. Ia marah pada ibunya karena meninggalkan teka-teki, marah pada ayah yang entah hidup atau mati, marah pada Marwah yang selalu berbicara seolah luka orang lain adalah urusan administrasi. Tetapi paling dalam, Naya marah pada dirinya sendiri karena masih ingin seseorang berkata bahwa semua ini salah paham. Anak yang kehilangan ibu kadang tidak mencari kebenaran dulu; ia mencari satu orang dewasa yang bersedia mengaku telah gagal melindunginya.",
      "Dialog yang terjadi setelah itu pendek, tetapi menancap. 'Kamu tidak paham akibatnya,' kata suara yang menahan panik. Naya menjawab pelan, 'Mungkin. Tapi kalian terlalu lama memakai kata akibat untuk menutup kata dosa.' Ruangan mendadak sempit. Salma memalingkan muka, seolah kalimat itu mengenai bagian dirinya yang paling ia sembunyikan. Di luar, suara santri mengaji terdengar jauh, bersih, hampir tidak cocok dengan kebusukan yang pelan-pelan muncul di balik dinding. Naya mendadak paham mengapa ibunya dulu selalu memilih duduk di belakang, dekat pintu keluar.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Makin malam, tekanan makin rapi. Ada yang mengunci pintu, ada yang memindahkan map, ada yang mengirim pesan tanpa nama. Naya mulai membedakan takut yang melumpuhkan dan takut yang memberi tenaga. Ia mencatat urutan kejadian dalam kepala: siapa datang lebih dulu, siapa terlalu cepat tahu, siapa pura-pura kaget, siapa menyebut nama Laila dengan suara seperti meminta ampun. Jika suatu hari ia harus berdiri di depan semua orang, ia tidak boleh hanya membawa tangis. Ia harus membawa urutan, tanggal, suara, dan bukti yang tidak bisa dipelintir menjadi cerita anak durhaka.",
      "Menjelang akhir babak itu, Salma berkata ada satu nama yang tidak boleh disebut. Naya tidak langsung bergerak. Tubuhnya ingin lari, tetapi sesuatu di dalam dirinya justru menjadi tenang, seperti orang yang akhirnya melihat bentuk musuh setelah lama dipukul dari gelap. Ia menggenggam bukti yang tersisa, menatap lorong, lalu berbisik pada nama ibunya tanpa suara. Besok mereka mungkin menuduhnya. Besok ia mungkin terusir. Besok orang-orang yang terlihat saleh bisa menunjukkan wajah asli. Namun malam ini satu hal pasti: pintu yang pernah ditutup untuk Laila mulai terbuka untuk Naya."
    ],
    "wordCount": 873,
    "sceneCount": 4,
    "reveals": [],
    "newNamedCharacters": [
      "char:salma"
    ],
    "proposedStateDelta": {
      "chapter3_progress": true,
      "tension": true
    },
    "dialogue": [
      {
        "characterId": "char:naya",
        "text": "Aku tidak pulang untuk jadi anak baik di depan kebohongan."
      },
      {
        "characterId": "char:salma",
        "text": "Kalau kamu terus membuka pintu itu, tidak semua orang bisa diselamatkan."
      }
    ],
    "emotionBeats": [
      {
        "characterId": "char:naya",
        "targetCharacterId": "char:salma",
        "valence": "cold"
      }
    ]
  },
  {
    "chapterNumber": 4,
    "title": "Koperasi Setelah Isya",
    "phase": "ACT_1_PULANG_DAN_PINTU_TERLARANG",
    "chapterGoal": "Menggerakkan konflik Bilik Ketujuh melalui laci kas berisi kertas karbon lama dan tekanan utama: Hafiz menyangkal pernah dekat dengan Laila.",
    "mandatoryBeats": [
      "laci kas berisi kertas karbon lama",
      "Hafiz menyangkal pernah dekat dengan Laila",
      "Marwah mengirim santri penjaga ke halaman",
      "Naya menemukan nomor kamar yang dicoret tujuh kali"
    ],
    "cast": [
      "char:naya",
      "char:hafiz",
      "char:ustazah-marwah"
    ],
    "threadIds": [
      "thread:loyalitas-hafiz",
      "thread:bilik-ketujuh"
    ],
    "paragraphs": [
      "Koperasi pesantren yang tutup separuh tidak pernah terasa benar bagi Naya. Setiap sudutnya seperti menyimpan napas orang yang menunggu dipanggil, sementara laci kas berisi kertas karbon lama terletak di hadapannya dengan tenang yang nyaris mengejek. Naya mencoba mengingat pesan ibunya: jangan takut pada pintu, takutlah pada orang yang menyuruhmu tidak bertanya. Tetapi pesan itu dulu hanya terdengar seperti nasihat untuk anak kecil yang sering kehilangan sandal di masjid. Sekarang, di usia yang memaksa dirinya terlihat dewasa, kalimat itu berubah menjadi pisau. Ia berdiri terlalu lama, sampai suara sandal dari arah belakang membuat tengkuknya menegang.",
      "Hafiz menyangkal pernah dekat dengan Laila. Kalimat itu datang tidak selalu dengan teriakan; justru semakin pelan diucapkan, semakin jelas ancamannya. Naya tahu ada orang-orang yang menguasai tempat ini bukan karena mereka benar, melainkan karena semua orang sudah terbiasa menunduk. Ia menatap wajah Hafiz, mencari celah yang bisa dibaca, tetapi yang ia temukan hanya kegelisahan yang disembunyikan di balik sikap biasa. Di pesantren, kebohongan tidak memakai pakaian hitam. Ia memakai senyum ustazah, kitab yang ditutup mendadak, dan aturan yang baru disebut setelah seseorang hampir menemukan jawaban.",
      "Marwah mengirim santri penjaga ke halaman. Bantuan itu kecil, hampir tidak pantas disebut pertolongan, namun bagi Naya yang mulai kehabisan tempat berpijak, hal kecil bisa terasa seperti tangan di tepi sumur. Ia menyimpan napas, mendengar bunyi malam, dan membiarkan dirinya membaca ulang semua kejadian sejak pulang. Kenapa semua orang tahu nama ibunya, tetapi tidak seorang pun berani mengucapkannya dengan wajar? Kenapa setiap arsip tentang Laila selalu punya bekas sobekan? Marwah pernah berkata bahwa beberapa keluarga tidak runtuh karena miskin, melainkan karena terlalu lama menyimpan malu milik orang lain.",
      "Petunjuk tentang laci kas berisi kertas karbon lama membuat Naya sadar bahwa misteri ini tidak berdiri sendiri. Ada tanah wakaf, nama anak-anak yang dipindahkan, para pengurus yang takut kehilangan muka, dan keluarga yang dibiarkan patah agar bangunan pesantren tetap terlihat kokoh. Ia ingat tiga jalan yang sejak awal membayanginya: menggali sendiri sampai kebenaran telanjang, patuh sebentar untuk memancing pengakuan, atau keluar dari pagar agar bukti tidak ikut dikubur. Pilihan itu tidak pernah benar-benar bersih. Jalan pertama bisa menghancurkan orang yang masih ingin ia percaya. Jalan kedua bisa menjadikannya alat para pembohong. Jalan ketiga bisa membuatnya kehilangan akses pada semua pintu yang baru mulai terbuka. Namun diam jelas bukan pilihan; diam adalah bahasa yang selama ini dipakai untuk mengubur Laila.",
      "Ketika Naya menyentuh bukti itu, bau minyak tanah dari gudang belakang. Dadanya terasa seperti dipenuhi air yang tidak menemukan jalan keluar. Ia marah pada ibunya karena meninggalkan teka-teki, marah pada ayah yang entah hidup atau mati, marah pada Marwah yang selalu berbicara seolah luka orang lain adalah urusan administrasi. Tetapi paling dalam, Naya marah pada dirinya sendiri karena masih ingin seseorang berkata bahwa semua ini salah paham. Anak yang kehilangan ibu kadang tidak mencari kebenaran dulu; ia mencari satu orang dewasa yang bersedia mengaku telah gagal melindunginya.",
      "Dialog yang terjadi setelah itu pendek, tetapi menancap. 'Kamu tidak paham akibatnya,' kata suara yang menahan panik. Naya menjawab pelan, 'Mungkin. Tapi kalian terlalu lama memakai kata akibat untuk menutup kata dosa.' Ruangan mendadak sempit. Hafiz memalingkan muka, seolah kalimat itu mengenai bagian dirinya yang paling ia sembunyikan. Di luar, suara santri mengaji terdengar jauh, bersih, hampir tidak cocok dengan kebusukan yang pelan-pelan muncul di balik dinding. Naya mendadak paham mengapa ibunya dulu selalu memilih duduk di belakang, dekat pintu keluar.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Makin malam, tekanan makin rapi. Ada yang mengunci pintu, ada yang memindahkan map, ada yang mengirim pesan tanpa nama. Naya mulai membedakan takut yang melumpuhkan dan takut yang memberi tenaga. Ia mencatat urutan kejadian dalam kepala: siapa datang lebih dulu, siapa terlalu cepat tahu, siapa pura-pura kaget, siapa menyebut nama Laila dengan suara seperti meminta ampun. Jika suatu hari ia harus berdiri di depan semua orang, ia tidak boleh hanya membawa tangis. Ia harus membawa urutan, tanggal, suara, dan bukti yang tidak bisa dipelintir menjadi cerita anak durhaka.",
      "Menjelang akhir babak itu, Naya menemukan nomor kamar yang dicoret tujuh kali. Naya tidak langsung bergerak. Tubuhnya ingin lari, tetapi sesuatu di dalam dirinya justru menjadi tenang, seperti orang yang akhirnya melihat bentuk musuh setelah lama dipukul dari gelap. Ia menggenggam bukti yang tersisa, menatap lorong, lalu berbisik pada nama ibunya tanpa suara. Besok mereka mungkin menuduhnya. Besok ia mungkin terusir. Besok orang-orang yang terlihat saleh bisa menunjukkan wajah asli. Namun malam ini satu hal pasti: pintu yang pernah ditutup untuk Laila mulai terbuka untuk Naya."
    ],
    "wordCount": 874,
    "sceneCount": 4,
    "reveals": [],
    "newNamedCharacters": [],
    "proposedStateDelta": {
      "chapter4_progress": true,
      "tension": true
    },
    "dialogue": [
      {
        "characterId": "char:naya",
        "text": "Aku tidak pulang untuk jadi anak baik di depan kebohongan."
      },
      {
        "characterId": "char:hafiz",
        "text": "Kalau kamu terus membuka pintu itu, tidak semua orang bisa diselamatkan."
      }
    ],
    "emotionBeats": [
      {
        "characterId": "char:naya",
        "targetCharacterId": "char:hafiz",
        "valence": "cold"
      }
    ]
  },
  {
    "chapterNumber": 5,
    "title": "Nama yang Dihapus",
    "phase": "ACT_1_PULANG_DAN_PINTU_TERLARANG",
    "chapterGoal": "Menggerakkan konflik Bilik Ketujuh melalui buku induk dengan halaman sobek dan tekanan utama: Kyai Hamid menyebut arsip lama sebagai fitnah.",
    "mandatoryBeats": [
      "buku induk dengan halaman sobek",
      "Kyai Hamid menyebut arsip lama sebagai fitnah",
      "Salma menyalin kode berkas ke telapak tangan",
      "stempel pesantren jatuh dari rak tanpa tersentuh"
    ],
    "cast": [
      "char:naya",
      "char:salma",
      "char:kyai-hamid"
    ],
    "threadIds": [
      "thread:kematian-laila",
      "thread:bilik-ketujuh"
    ],
    "paragraphs": [
      "Ruang administrasi yang lembap tidak pernah terasa benar bagi Naya. Setiap sudutnya seperti menyimpan napas orang yang menunggu dipanggil, sementara buku induk dengan halaman sobek terletak di hadapannya dengan tenang yang nyaris mengejek. Naya mencoba mengingat pesan ibunya: jangan takut pada pintu, takutlah pada orang yang menyuruhmu tidak bertanya. Tetapi pesan itu dulu hanya terdengar seperti nasihat untuk anak kecil yang sering kehilangan sandal di masjid. Sekarang, di usia yang memaksa dirinya terlihat dewasa, kalimat itu berubah menjadi pisau. Ia berdiri terlalu lama, sampai suara sandal dari arah belakang membuat tengkuknya menegang.",
      "Kyai Hamid menyebut arsip lama sebagai fitnah. Kalimat itu datang tidak selalu dengan teriakan; justru semakin pelan diucapkan, semakin jelas ancamannya. Naya tahu ada orang-orang yang menguasai tempat ini bukan karena mereka benar, melainkan karena semua orang sudah terbiasa menunduk. Ia menatap wajah Salma, mencari celah yang bisa dibaca, tetapi yang ia temukan hanya kegelisahan yang disembunyikan di balik sikap biasa. Di pesantren, kebohongan tidak memakai pakaian hitam. Ia memakai senyum ustazah, kitab yang ditutup mendadak, dan aturan yang baru disebut setelah seseorang hampir menemukan jawaban.",
      "Salma menyalin kode berkas ke telapak tangan. Bantuan itu kecil, hampir tidak pantas disebut pertolongan, namun bagi Naya yang mulai kehabisan tempat berpijak, hal kecil bisa terasa seperti tangan di tepi sumur. Ia menyimpan napas, mendengar bunyi malam, dan membiarkan dirinya membaca ulang semua kejadian sejak pulang. Kenapa semua orang tahu nama ibunya, tetapi tidak seorang pun berani mengucapkannya dengan wajar? Kenapa setiap arsip tentang Laila selalu punya bekas sobekan? Hamid pernah berkata bahwa beberapa keluarga tidak runtuh karena miskin, melainkan karena terlalu lama menyimpan malu milik orang lain.",
      "Petunjuk tentang buku induk dengan halaman sobek membuat Naya sadar bahwa misteri ini tidak berdiri sendiri. Ada tanah wakaf, nama anak-anak yang dipindahkan, para pengurus yang takut kehilangan muka, dan keluarga yang dibiarkan patah agar bangunan pesantren tetap terlihat kokoh. Ia ingat tiga jalan yang sejak awal membayanginya: menggali sendiri sampai kebenaran telanjang, patuh sebentar untuk memancing pengakuan, atau keluar dari pagar agar bukti tidak ikut dikubur. Pilihan itu tidak pernah benar-benar bersih. Jalan pertama bisa menghancurkan orang yang masih ingin ia percaya. Jalan kedua bisa menjadikannya alat para pembohong. Jalan ketiga bisa membuatnya kehilangan akses pada semua pintu yang baru mulai terbuka. Namun diam jelas bukan pilihan; diam adalah bahasa yang selama ini dipakai untuk mengubur Laila.",
      "Ketika Naya menyentuh bukti itu, rasa marah Naya berubah jadi tekad. Dadanya terasa seperti dipenuhi air yang tidak menemukan jalan keluar. Ia marah pada ibunya karena meninggalkan teka-teki, marah pada ayah yang entah hidup atau mati, marah pada Marwah yang selalu berbicara seolah luka orang lain adalah urusan administrasi. Tetapi paling dalam, Naya marah pada dirinya sendiri karena masih ingin seseorang berkata bahwa semua ini salah paham. Anak yang kehilangan ibu kadang tidak mencari kebenaran dulu; ia mencari satu orang dewasa yang bersedia mengaku telah gagal melindunginya.",
      "Dialog yang terjadi setelah itu pendek, tetapi menancap. 'Kamu tidak paham akibatnya,' kata suara yang menahan panik. Naya menjawab pelan, 'Mungkin. Tapi kalian terlalu lama memakai kata akibat untuk menutup kata dosa.' Ruangan mendadak sempit. Salma memalingkan muka, seolah kalimat itu mengenai bagian dirinya yang paling ia sembunyikan. Di luar, suara santri mengaji terdengar jauh, bersih, hampir tidak cocok dengan kebusukan yang pelan-pelan muncul di balik dinding. Naya mendadak paham mengapa ibunya dulu selalu memilih duduk di belakang, dekat pintu keluar.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Makin malam, tekanan makin rapi. Ada yang mengunci pintu, ada yang memindahkan map, ada yang mengirim pesan tanpa nama. Naya mulai membedakan takut yang melumpuhkan dan takut yang memberi tenaga. Ia mencatat urutan kejadian dalam kepala: siapa datang lebih dulu, siapa terlalu cepat tahu, siapa pura-pura kaget, siapa menyebut nama Laila dengan suara seperti meminta ampun. Jika suatu hari ia harus berdiri di depan semua orang, ia tidak boleh hanya membawa tangis. Ia harus membawa urutan, tanggal, suara, dan bukti yang tidak bisa dipelintir menjadi cerita anak durhaka.",
      "Menjelang akhir babak itu, stempel pesantren jatuh dari rak tanpa tersentuh. Naya tidak langsung bergerak. Tubuhnya ingin lari, tetapi sesuatu di dalam dirinya justru menjadi tenang, seperti orang yang akhirnya melihat bentuk musuh setelah lama dipukul dari gelap. Ia menggenggam bukti yang tersisa, menatap lorong, lalu berbisik pada nama ibunya tanpa suara. Besok mereka mungkin menuduhnya. Besok ia mungkin terusir. Besok orang-orang yang terlihat saleh bisa menunjukkan wajah asli. Namun malam ini satu hal pasti: pintu yang pernah ditutup untuk Laila mulai terbuka untuk Naya."
    ],
    "wordCount": 872,
    "sceneCount": 4,
    "reveals": [],
    "newNamedCharacters": [],
    "proposedStateDelta": {
      "chapter5_progress": true,
      "tension": true
    },
    "dialogue": [
      {
        "characterId": "char:naya",
        "text": "Aku tidak pulang untuk jadi anak baik di depan kebohongan."
      },
      {
        "characterId": "char:salma",
        "text": "Kalau kamu terus membuka pintu itu, tidak semua orang bisa diselamatkan."
      }
    ],
    "emotionBeats": [
      {
        "characterId": "char:naya",
        "targetCharacterId": "char:salma",
        "valence": "cold"
      }
    ]
  },
  {
    "chapterNumber": 6,
    "title": "Arsip Anak yang Hilang",
    "phase": "ACT_1_PULANG_DAN_PINTU_TERLARANG",
    "chapterGoal": "Menggerakkan konflik Bilik Ketujuh melalui rak arsip berlabel nama anak-anak hilang dan tekanan utama: Marwah menangkap Naya tepat saat pintu terbuka.",
    "mandatoryBeats": [
      "rak arsip berlabel nama anak-anak hilang",
      "Marwah menangkap Naya tepat saat pintu terbuka",
      "Hafiz mematikan sekering agar Naya bisa membaca",
      "satu map bertuliskan nama Naya masih basah"
    ],
    "cast": [
      "char:naya",
      "char:ustazah-marwah",
      "char:hafiz"
    ],
    "threadIds": [
      "thread:bilik-ketujuh",
      "thread:kunci-wakaf"
    ],
    "paragraphs": [
      "Depan bilik ketujuh saat hujan deras tidak pernah terasa benar bagi Naya. Setiap sudutnya seperti menyimpan napas orang yang menunggu dipanggil, sementara rak arsip berlabel nama anak-anak hilang terletak di hadapannya dengan tenang yang nyaris mengejek. Naya mencoba mengingat pesan ibunya: jangan takut pada pintu, takutlah pada orang yang menyuruhmu tidak bertanya. Tetapi pesan itu dulu hanya terdengar seperti nasihat untuk anak kecil yang sering kehilangan sandal di masjid. Sekarang, di usia yang memaksa dirinya terlihat dewasa, kalimat itu berubah menjadi pisau. Ia berdiri terlalu lama, sampai suara sandal dari arah belakang membuat tengkuknya menegang.",
      "Marwah menangkap Naya tepat saat pintu terbuka. Kalimat itu datang tidak selalu dengan teriakan; justru semakin pelan diucapkan, semakin jelas ancamannya. Naya tahu ada orang-orang yang menguasai tempat ini bukan karena mereka benar, melainkan karena semua orang sudah terbiasa menunduk. Ia menatap wajah Marwah, mencari celah yang bisa dibaca, tetapi yang ia temukan hanya kegelisahan yang disembunyikan di balik sikap biasa. Di pesantren, kebohongan tidak memakai pakaian hitam. Ia memakai senyum ustazah, kitab yang ditutup mendadak, dan aturan yang baru disebut setelah seseorang hampir menemukan jawaban.",
      "Hafiz mematikan sekering agar Naya bisa membaca. Bantuan itu kecil, hampir tidak pantas disebut pertolongan, namun bagi Naya yang mulai kehabisan tempat berpijak, hal kecil bisa terasa seperti tangan di tepi sumur. Ia menyimpan napas, mendengar bunyi malam, dan membiarkan dirinya membaca ulang semua kejadian sejak pulang. Kenapa semua orang tahu nama ibunya, tetapi tidak seorang pun berani mengucapkannya dengan wajar? Kenapa setiap arsip tentang Laila selalu punya bekas sobekan? Hafiz pernah berkata bahwa beberapa keluarga tidak runtuh karena miskin, melainkan karena terlalu lama menyimpan malu milik orang lain.",
      "Petunjuk tentang rak arsip berlabel nama anak-anak hilang membuat Naya sadar bahwa misteri ini tidak berdiri sendiri. Ada tanah wakaf, nama anak-anak yang dipindahkan, para pengurus yang takut kehilangan muka, dan keluarga yang dibiarkan patah agar bangunan pesantren tetap terlihat kokoh. Malam itu cerita memberinya simpang yang tidak sopan: membongkar sekarang, mengikuti aturan yang mungkin busuk, atau menyelamatkan bukti dengan cara yang membuatnya tampak bersalah. Pilihan itu tidak pernah benar-benar bersih. Jalan pertama bisa menghancurkan orang yang masih ingin ia percaya. Jalan kedua bisa menjadikannya alat para pembohong. Jalan ketiga bisa membuatnya kehilangan akses pada semua pintu yang baru mulai terbuka. Namun diam jelas bukan pilihan; diam adalah bahasa yang selama ini dipakai untuk mengubur Laila.",
      "Ketika Naya menyentuh bukti itu, daftar itu membuat Naya sadar ibunya bukan gila. Dadanya terasa seperti dipenuhi air yang tidak menemukan jalan keluar. Ia marah pada ibunya karena meninggalkan teka-teki, marah pada ayah yang entah hidup atau mati, marah pada Marwah yang selalu berbicara seolah luka orang lain adalah urusan administrasi. Tetapi paling dalam, Naya marah pada dirinya sendiri karena masih ingin seseorang berkata bahwa semua ini salah paham. Anak yang kehilangan ibu kadang tidak mencari kebenaran dulu; ia mencari satu orang dewasa yang bersedia mengaku telah gagal melindunginya.",
      "Dialog yang terjadi setelah itu pendek, tetapi menancap. 'Kamu tidak paham akibatnya,' kata suara yang menahan panik. Naya menjawab pelan, 'Mungkin. Tapi kalian terlalu lama memakai kata akibat untuk menutup kata dosa.' Ruangan mendadak sempit. Marwah memalingkan muka, seolah kalimat itu mengenai bagian dirinya yang paling ia sembunyikan. Di luar, suara santri mengaji terdengar jauh, bersih, hampir tidak cocok dengan kebusukan yang pelan-pelan muncul di balik dinding. Naya mendadak paham mengapa ibunya dulu selalu memilih duduk di belakang, dekat pintu keluar.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Makin malam, tekanan makin rapi. Ada yang mengunci pintu, ada yang memindahkan map, ada yang mengirim pesan tanpa nama. Naya mulai membedakan takut yang melumpuhkan dan takut yang memberi tenaga. Ia mencatat urutan kejadian dalam kepala: siapa datang lebih dulu, siapa terlalu cepat tahu, siapa pura-pura kaget, siapa menyebut nama Laila dengan suara seperti meminta ampun. Jika suatu hari ia harus berdiri di depan semua orang, ia tidak boleh hanya membawa tangis. Ia harus membawa urutan, tanggal, suara, dan bukti yang tidak bisa dipelintir menjadi cerita anak durhaka. Yang terbuka bukan sekadar petunjuk, melainkan rahasia yang mengubah cara Naya membaca semua babak sebelumnya.",
      "Menjelang akhir babak itu, satu map bertuliskan nama Naya masih basah. Naya tidak langsung bergerak. Tubuhnya ingin lari, tetapi sesuatu di dalam dirinya justru menjadi tenang, seperti orang yang akhirnya melihat bentuk musuh setelah lama dipukul dari gelap. Ia menggenggam bukti yang tersisa, menatap lorong, lalu berbisik pada nama ibunya tanpa suara. Besok mereka mungkin menuduhnya. Besok ia mungkin terusir. Besok orang-orang yang terlihat saleh bisa menunjukkan wajah asli. Namun malam ini satu hal pasti: pintu yang pernah ditutup untuk Laila mulai terbuka untuk Naya."
    ],
    "wordCount": 890,
    "sceneCount": 4,
    "reveals": [
      "secret:bilik-arsip-anak-hilang"
    ],
    "newNamedCharacters": [],
    "proposedStateDelta": {
      "chapter6_progress": true,
      "tension": true,
      "choice_chapter_6": true,
      "revealed_bilik_arsip_anak_hilang": true
    },
    "dialogue": [
      {
        "characterId": "char:naya",
        "text": "Aku tidak pulang untuk jadi anak baik di depan kebohongan."
      },
      {
        "characterId": "char:ustazah-marwah",
        "text": "Kalau kamu terus membuka pintu itu, tidak semua orang bisa diselamatkan."
      }
    ],
    "emotionBeats": [
      {
        "characterId": "char:naya",
        "targetCharacterId": "char:ustazah-marwah",
        "valence": "cold"
      }
    ]
  },
  {
    "chapterNumber": 7,
    "title": "Rukmini dan Buku Penerimaan",
    "phase": "ACT_2_JEJAK_LAILA",
    "chapterGoal": "Menggerakkan konflik Bilik Ketujuh melalui buku penerimaan santri tahun lama dan tekanan utama: Rukmini menolak bicara sebelum melihat kunci.",
    "mandatoryBeats": [
      "buku penerimaan santri tahun lama",
      "Rukmini menolak bicara sebelum melihat kunci",
      "Salma menjaga jalan sambil pura-pura membeli obat",
      "Rukmini menyebut malam ketika Laila tidak pulang"
    ],
    "cast": [
      "char:naya",
      "char:salma",
      "char:bu-rukmini"
    ],
    "threadIds": [
      "thread:kematian-laila"
    ],
    "paragraphs": [
      "Rumah kecil arsiparis di belakang masjid tidak pernah terasa benar bagi Naya. Setiap sudutnya seperti menyimpan napas orang yang menunggu dipanggil, sementara buku penerimaan santri tahun lama terletak di hadapannya dengan tenang yang nyaris mengejek. Naya mencoba mengingat pesan ibunya: jangan takut pada pintu, takutlah pada orang yang menyuruhmu tidak bertanya. Tetapi pesan itu dulu hanya terdengar seperti nasihat untuk anak kecil yang sering kehilangan sandal di masjid. Sekarang, di usia yang memaksa dirinya terlihat dewasa, kalimat itu berubah menjadi pisau. Ia berdiri terlalu lama, sampai suara sandal dari arah belakang membuat tengkuknya menegang.",
      "Rukmini menolak bicara sebelum melihat kunci. Kalimat itu datang tidak selalu dengan teriakan; justru semakin pelan diucapkan, semakin jelas ancamannya. Naya tahu ada orang-orang yang menguasai tempat ini bukan karena mereka benar, melainkan karena semua orang sudah terbiasa menunduk. Ia menatap wajah Salma, mencari celah yang bisa dibaca, tetapi yang ia temukan hanya kegelisahan yang disembunyikan di balik sikap biasa. Di pesantren, kebohongan tidak memakai pakaian hitam. Ia memakai senyum ustazah, kitab yang ditutup mendadak, dan aturan yang baru disebut setelah seseorang hampir menemukan jawaban.",
      "Salma menjaga jalan sambil pura-pura membeli obat. Bantuan itu kecil, hampir tidak pantas disebut pertolongan, namun bagi Naya yang mulai kehabisan tempat berpijak, hal kecil bisa terasa seperti tangan di tepi sumur. Ia menyimpan napas, mendengar bunyi malam, dan membiarkan dirinya membaca ulang semua kejadian sejak pulang. Kenapa semua orang tahu nama ibunya, tetapi tidak seorang pun berani mengucapkannya dengan wajar? Kenapa setiap arsip tentang Laila selalu punya bekas sobekan? Rukmini pernah berkata bahwa beberapa keluarga tidak runtuh karena miskin, melainkan karena terlalu lama menyimpan malu milik orang lain.",
      "Petunjuk tentang buku penerimaan santri tahun lama membuat Naya sadar bahwa misteri ini tidak berdiri sendiri. Ada tanah wakaf, nama anak-anak yang dipindahkan, para pengurus yang takut kehilangan muka, dan keluarga yang dibiarkan patah agar bangunan pesantren tetap terlihat kokoh. Ia ingat tiga jalan yang sejak awal membayanginya: menggali sendiri sampai kebenaran telanjang, patuh sebentar untuk memancing pengakuan, atau keluar dari pagar agar bukti tidak ikut dikubur. Pilihan itu tidak pernah benar-benar bersih. Jalan pertama bisa menghancurkan orang yang masih ingin ia percaya. Jalan kedua bisa menjadikannya alat para pembohong. Jalan ketiga bisa membuatnya kehilangan akses pada semua pintu yang baru mulai terbuka. Namun diam jelas bukan pilihan; diam adalah bahasa yang selama ini dipakai untuk mengubur Laila.",
      "Ketika Naya menyentuh bukti itu, penyesalan tua memenuhi ruang sempit itu. Dadanya terasa seperti dipenuhi air yang tidak menemukan jalan keluar. Ia marah pada ibunya karena meninggalkan teka-teki, marah pada ayah yang entah hidup atau mati, marah pada Marwah yang selalu berbicara seolah luka orang lain adalah urusan administrasi. Tetapi paling dalam, Naya marah pada dirinya sendiri karena masih ingin seseorang berkata bahwa semua ini salah paham. Anak yang kehilangan ibu kadang tidak mencari kebenaran dulu; ia mencari satu orang dewasa yang bersedia mengaku telah gagal melindunginya.",
      "Dialog yang terjadi setelah itu pendek, tetapi menancap. 'Kamu tidak paham akibatnya,' kata suara yang menahan panik. Naya menjawab pelan, 'Mungkin. Tapi kalian terlalu lama memakai kata akibat untuk menutup kata dosa.' Ruangan mendadak sempit. Salma memalingkan muka, seolah kalimat itu mengenai bagian dirinya yang paling ia sembunyikan. Di luar, suara santri mengaji terdengar jauh, bersih, hampir tidak cocok dengan kebusukan yang pelan-pelan muncul di balik dinding. Naya mendadak paham mengapa ibunya dulu selalu memilih duduk di belakang, dekat pintu keluar.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Makin malam, tekanan makin rapi. Ada yang mengunci pintu, ada yang memindahkan map, ada yang mengirim pesan tanpa nama. Naya mulai membedakan takut yang melumpuhkan dan takut yang memberi tenaga. Ia mencatat urutan kejadian dalam kepala: siapa datang lebih dulu, siapa terlalu cepat tahu, siapa pura-pura kaget, siapa menyebut nama Laila dengan suara seperti meminta ampun. Jika suatu hari ia harus berdiri di depan semua orang, ia tidak boleh hanya membawa tangis. Ia harus membawa urutan, tanggal, suara, dan bukti yang tidak bisa dipelintir menjadi cerita anak durhaka.",
      "Menjelang akhir babak itu, Rukmini menyebut malam ketika Laila tidak pulang. Naya tidak langsung bergerak. Tubuhnya ingin lari, tetapi sesuatu di dalam dirinya justru menjadi tenang, seperti orang yang akhirnya melihat bentuk musuh setelah lama dipukul dari gelap. Ia menggenggam bukti yang tersisa, menatap lorong, lalu berbisik pada nama ibunya tanpa suara. Besok mereka mungkin menuduhnya. Besok ia mungkin terusir. Besok orang-orang yang terlihat saleh bisa menunjukkan wajah asli. Namun malam ini satu hal pasti: pintu yang pernah ditutup untuk Laila mulai terbuka untuk Naya."
    ],
    "wordCount": 873,
    "sceneCount": 4,
    "reveals": [],
    "newNamedCharacters": [
      "char:bu-rukmini"
    ],
    "proposedStateDelta": {
      "chapter7_progress": true,
      "tension": true
    },
    "dialogue": [
      {
        "characterId": "char:naya",
        "text": "Aku tidak pulang untuk jadi anak baik di depan kebohongan."
      },
      {
        "characterId": "char:salma",
        "text": "Kalau kamu terus membuka pintu itu, tidak semua orang bisa diselamatkan."
      }
    ],
    "emotionBeats": [
      {
        "characterId": "char:naya",
        "targetCharacterId": "char:salma",
        "valence": "cold"
      }
    ]
  },
  {
    "chapterNumber": 8,
    "title": "Foto Tiga Bayangan",
    "phase": "ACT_2_JEJAK_LAILA",
    "chapterGoal": "Menggerakkan konflik Bilik Ketujuh melalui foto Laila bersama dua bayangan laki-laki dan tekanan utama: Hafiz meminta Naya berhenti mengejar masa lalu.",
    "mandatoryBeats": [
      "foto Laila bersama dua bayangan laki-laki",
      "Hafiz meminta Naya berhenti mengejar masa lalu",
      "Rukmini mengenali jas milik dewan wakaf",
      "di belakang foto tertulis tanggal kematian yang berbeda"
    ],
    "cast": [
      "char:naya",
      "char:hafiz",
      "char:bu-rukmini"
    ],
    "threadIds": [
      "thread:kunci-wakaf",
      "thread:loyalitas-hafiz"
    ],
    "paragraphs": [
      "Studio foto tua di pasar desa tidak pernah terasa benar bagi Naya. Setiap sudutnya seperti menyimpan napas orang yang menunggu dipanggil, sementara foto Laila bersama dua bayangan laki-laki terletak di hadapannya dengan tenang yang nyaris mengejek. Naya mencoba mengingat pesan ibunya: jangan takut pada pintu, takutlah pada orang yang menyuruhmu tidak bertanya. Tetapi pesan itu dulu hanya terdengar seperti nasihat untuk anak kecil yang sering kehilangan sandal di masjid. Sekarang, di usia yang memaksa dirinya terlihat dewasa, kalimat itu berubah menjadi pisau. Ia berdiri terlalu lama, sampai suara sandal dari arah belakang membuat tengkuknya menegang.",
      "Hafiz meminta Naya berhenti mengejar masa lalu. Kalimat itu datang tidak selalu dengan teriakan; justru semakin pelan diucapkan, semakin jelas ancamannya. Naya tahu ada orang-orang yang menguasai tempat ini bukan karena mereka benar, melainkan karena semua orang sudah terbiasa menunduk. Ia menatap wajah Hafiz, mencari celah yang bisa dibaca, tetapi yang ia temukan hanya kegelisahan yang disembunyikan di balik sikap biasa. Di pesantren, kebohongan tidak memakai pakaian hitam. Ia memakai senyum ustazah, kitab yang ditutup mendadak, dan aturan yang baru disebut setelah seseorang hampir menemukan jawaban.",
      "Rukmini mengenali jas milik dewan wakaf. Bantuan itu kecil, hampir tidak pantas disebut pertolongan, namun bagi Naya yang mulai kehabisan tempat berpijak, hal kecil bisa terasa seperti tangan di tepi sumur. Ia menyimpan napas, mendengar bunyi malam, dan membiarkan dirinya membaca ulang semua kejadian sejak pulang. Kenapa semua orang tahu nama ibunya, tetapi tidak seorang pun berani mengucapkannya dengan wajar? Kenapa setiap arsip tentang Laila selalu punya bekas sobekan? Rukmini pernah berkata bahwa beberapa keluarga tidak runtuh karena miskin, melainkan karena terlalu lama menyimpan malu milik orang lain.",
      "Petunjuk tentang foto Laila bersama dua bayangan laki-laki membuat Naya sadar bahwa misteri ini tidak berdiri sendiri. Ada tanah wakaf, nama anak-anak yang dipindahkan, para pengurus yang takut kehilangan muka, dan keluarga yang dibiarkan patah agar bangunan pesantren tetap terlihat kokoh. Ia ingat tiga jalan yang sejak awal membayanginya: menggali sendiri sampai kebenaran telanjang, patuh sebentar untuk memancing pengakuan, atau keluar dari pagar agar bukti tidak ikut dikubur. Pilihan itu tidak pernah benar-benar bersih. Jalan pertama bisa menghancurkan orang yang masih ingin ia percaya. Jalan kedua bisa menjadikannya alat para pembohong. Jalan ketiga bisa membuatnya kehilangan akses pada semua pintu yang baru mulai terbuka. Namun diam jelas bukan pilihan; diam adalah bahasa yang selama ini dipakai untuk mengubur Laila.",
      "Ketika Naya menyentuh bukti itu, Naya merasa masa kecilnya dibangun di atas dusta. Dadanya terasa seperti dipenuhi air yang tidak menemukan jalan keluar. Ia marah pada ibunya karena meninggalkan teka-teki, marah pada ayah yang entah hidup atau mati, marah pada Marwah yang selalu berbicara seolah luka orang lain adalah urusan administrasi. Tetapi paling dalam, Naya marah pada dirinya sendiri karena masih ingin seseorang berkata bahwa semua ini salah paham. Anak yang kehilangan ibu kadang tidak mencari kebenaran dulu; ia mencari satu orang dewasa yang bersedia mengaku telah gagal melindunginya.",
      "Dialog yang terjadi setelah itu pendek, tetapi menancap. 'Kamu tidak paham akibatnya,' kata suara yang menahan panik. Naya menjawab pelan, 'Mungkin. Tapi kalian terlalu lama memakai kata akibat untuk menutup kata dosa.' Ruangan mendadak sempit. Hafiz memalingkan muka, seolah kalimat itu mengenai bagian dirinya yang paling ia sembunyikan. Di luar, suara santri mengaji terdengar jauh, bersih, hampir tidak cocok dengan kebusukan yang pelan-pelan muncul di balik dinding. Naya mendadak paham mengapa ibunya dulu selalu memilih duduk di belakang, dekat pintu keluar.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Makin malam, tekanan makin rapi. Ada yang mengunci pintu, ada yang memindahkan map, ada yang mengirim pesan tanpa nama. Naya mulai membedakan takut yang melumpuhkan dan takut yang memberi tenaga. Ia mencatat urutan kejadian dalam kepala: siapa datang lebih dulu, siapa terlalu cepat tahu, siapa pura-pura kaget, siapa menyebut nama Laila dengan suara seperti meminta ampun. Jika suatu hari ia harus berdiri di depan semua orang, ia tidak boleh hanya membawa tangis. Ia harus membawa urutan, tanggal, suara, dan bukti yang tidak bisa dipelintir menjadi cerita anak durhaka.",
      "Menjelang akhir babak itu, di belakang foto tertulis tanggal kematian yang berbeda. Naya tidak langsung bergerak. Tubuhnya ingin lari, tetapi sesuatu di dalam dirinya justru menjadi tenang, seperti orang yang akhirnya melihat bentuk musuh setelah lama dipukul dari gelap. Ia menggenggam bukti yang tersisa, menatap lorong, lalu berbisik pada nama ibunya tanpa suara. Besok mereka mungkin menuduhnya. Besok ia mungkin terusir. Besok orang-orang yang terlihat saleh bisa menunjukkan wajah asli. Namun malam ini satu hal pasti: pintu yang pernah ditutup untuk Laila mulai terbuka untuk Naya."
    ],
    "wordCount": 878,
    "sceneCount": 4,
    "reveals": [],
    "newNamedCharacters": [],
    "proposedStateDelta": {
      "chapter8_progress": true,
      "tension": true
    },
    "dialogue": [
      {
        "characterId": "char:naya",
        "text": "Aku tidak pulang untuk jadi anak baik di depan kebohongan."
      },
      {
        "characterId": "char:hafiz",
        "text": "Kalau kamu terus membuka pintu itu, tidak semua orang bisa diselamatkan."
      }
    ],
    "emotionBeats": [
      {
        "characterId": "char:naya",
        "targetCharacterId": "char:hafiz",
        "valence": "cold"
      }
    ]
  },
  {
    "chapterNumber": 9,
    "title": "Malam Pengakuan Hafiz",
    "phase": "ACT_2_JEJAK_LAILA",
    "chapterGoal": "Menggerakkan konflik Bilik Ketujuh melalui surat kecil dari Laila untuk Hafiz dan tekanan utama: Hafiz mengaku pernah membawa Laila ke gerbang malam itu.",
    "mandatoryBeats": [
      "surat kecil dari Laila untuk Hafiz",
      "Hafiz mengaku pernah membawa Laila ke gerbang malam itu",
      "Marwah berdiri di halaman seolah sudah tahu",
      "surat itu berakhir dengan kalimat jaga anakku"
    ],
    "cast": [
      "char:naya",
      "char:hafiz",
      "char:ustazah-marwah"
    ],
    "threadIds": [
      "thread:loyalitas-hafiz",
      "thread:kematian-laila"
    ],
    "paragraphs": [
      "Atap koperasi menghadap menara air tidak pernah terasa benar bagi Naya. Setiap sudutnya seperti menyimpan napas orang yang menunggu dipanggil, sementara surat kecil dari Laila untuk Hafiz terletak di hadapannya dengan tenang yang nyaris mengejek. Naya mencoba mengingat pesan ibunya: jangan takut pada pintu, takutlah pada orang yang menyuruhmu tidak bertanya. Tetapi pesan itu dulu hanya terdengar seperti nasihat untuk anak kecil yang sering kehilangan sandal di masjid. Sekarang, di usia yang memaksa dirinya terlihat dewasa, kalimat itu berubah menjadi pisau. Ia berdiri terlalu lama, sampai suara sandal dari arah belakang membuat tengkuknya menegang.",
      "Hafiz mengaku pernah membawa Laila ke gerbang malam itu. Kalimat itu datang tidak selalu dengan teriakan; justru semakin pelan diucapkan, semakin jelas ancamannya. Naya tahu ada orang-orang yang menguasai tempat ini bukan karena mereka benar, melainkan karena semua orang sudah terbiasa menunduk. Ia menatap wajah Hafiz, mencari celah yang bisa dibaca, tetapi yang ia temukan hanya kegelisahan yang disembunyikan di balik sikap biasa. Di pesantren, kebohongan tidak memakai pakaian hitam. Ia memakai senyum ustazah, kitab yang ditutup mendadak, dan aturan yang baru disebut setelah seseorang hampir menemukan jawaban.",
      "Marwah berdiri di halaman seolah sudah tahu. Bantuan itu kecil, hampir tidak pantas disebut pertolongan, namun bagi Naya yang mulai kehabisan tempat berpijak, hal kecil bisa terasa seperti tangan di tepi sumur. Ia menyimpan napas, mendengar bunyi malam, dan membiarkan dirinya membaca ulang semua kejadian sejak pulang. Kenapa semua orang tahu nama ibunya, tetapi tidak seorang pun berani mengucapkannya dengan wajar? Kenapa setiap arsip tentang Laila selalu punya bekas sobekan? Marwah pernah berkata bahwa beberapa keluarga tidak runtuh karena miskin, melainkan karena terlalu lama menyimpan malu milik orang lain.",
      "Petunjuk tentang surat kecil dari Laila untuk Hafiz membuat Naya sadar bahwa misteri ini tidak berdiri sendiri. Ada tanah wakaf, nama anak-anak yang dipindahkan, para pengurus yang takut kehilangan muka, dan keluarga yang dibiarkan patah agar bangunan pesantren tetap terlihat kokoh. Ia ingat tiga jalan yang sejak awal membayanginya: menggali sendiri sampai kebenaran telanjang, patuh sebentar untuk memancing pengakuan, atau keluar dari pagar agar bukti tidak ikut dikubur. Pilihan itu tidak pernah benar-benar bersih. Jalan pertama bisa menghancurkan orang yang masih ingin ia percaya. Jalan kedua bisa menjadikannya alat para pembohong. Jalan ketiga bisa membuatnya kehilangan akses pada semua pintu yang baru mulai terbuka. Namun diam jelas bukan pilihan; diam adalah bahasa yang selama ini dipakai untuk mengubur Laila.",
      "Ketika Naya menyentuh bukti itu, Naya ingin percaya tetapi takut dikhianati lagi. Dadanya terasa seperti dipenuhi air yang tidak menemukan jalan keluar. Ia marah pada ibunya karena meninggalkan teka-teki, marah pada ayah yang entah hidup atau mati, marah pada Marwah yang selalu berbicara seolah luka orang lain adalah urusan administrasi. Tetapi paling dalam, Naya marah pada dirinya sendiri karena masih ingin seseorang berkata bahwa semua ini salah paham. Anak yang kehilangan ibu kadang tidak mencari kebenaran dulu; ia mencari satu orang dewasa yang bersedia mengaku telah gagal melindunginya.",
      "Dialog yang terjadi setelah itu pendek, tetapi menancap. 'Kamu tidak paham akibatnya,' kata suara yang menahan panik. Naya menjawab pelan, 'Mungkin. Tapi kalian terlalu lama memakai kata akibat untuk menutup kata dosa.' Ruangan mendadak sempit. Hafiz memalingkan muka, seolah kalimat itu mengenai bagian dirinya yang paling ia sembunyikan. Di luar, suara santri mengaji terdengar jauh, bersih, hampir tidak cocok dengan kebusukan yang pelan-pelan muncul di balik dinding. Naya mendadak paham mengapa ibunya dulu selalu memilih duduk di belakang, dekat pintu keluar.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Makin malam, tekanan makin rapi. Ada yang mengunci pintu, ada yang memindahkan map, ada yang mengirim pesan tanpa nama. Naya mulai membedakan takut yang melumpuhkan dan takut yang memberi tenaga. Ia mencatat urutan kejadian dalam kepala: siapa datang lebih dulu, siapa terlalu cepat tahu, siapa pura-pura kaget, siapa menyebut nama Laila dengan suara seperti meminta ampun. Jika suatu hari ia harus berdiri di depan semua orang, ia tidak boleh hanya membawa tangis. Ia harus membawa urutan, tanggal, suara, dan bukti yang tidak bisa dipelintir menjadi cerita anak durhaka.",
      "Menjelang akhir babak itu, surat itu berakhir dengan kalimat jaga anakku. Naya tidak langsung bergerak. Tubuhnya ingin lari, tetapi sesuatu di dalam dirinya justru menjadi tenang, seperti orang yang akhirnya melihat bentuk musuh setelah lama dipukul dari gelap. Ia menggenggam bukti yang tersisa, menatap lorong, lalu berbisik pada nama ibunya tanpa suara. Besok mereka mungkin menuduhnya. Besok ia mungkin terusir. Besok orang-orang yang terlihat saleh bisa menunjukkan wajah asli. Namun malam ini satu hal pasti: pintu yang pernah ditutup untuk Laila mulai terbuka untuk Naya."
    ],
    "wordCount": 878,
    "sceneCount": 4,
    "reveals": [],
    "newNamedCharacters": [],
    "proposedStateDelta": {
      "chapter9_progress": true,
      "tension": true
    },
    "dialogue": [
      {
        "characterId": "char:naya",
        "text": "Aku tidak pulang untuk jadi anak baik di depan kebohongan."
      },
      {
        "characterId": "char:hafiz",
        "text": "Kalau kamu terus membuka pintu itu, tidak semua orang bisa diselamatkan."
      }
    ],
    "emotionBeats": [
      {
        "characterId": "char:naya",
        "targetCharacterId": "char:hafiz",
        "valence": "cold"
      }
    ]
  },
  {
    "chapterNumber": 10,
    "title": "Daftar Nama Bu Laila",
    "phase": "ACT_2_JEJAK_LAILA",
    "chapterGoal": "Menggerakkan konflik Bilik Ketujuh melalui daftar nama santri pindahan yang ditulis Laila dan tekanan utama: Kyai Hamid menyebut daftar itu bisa menghancurkan pesantren.",
    "mandatoryBeats": [
      "daftar nama santri pindahan yang ditulis Laila",
      "Kyai Hamid menyebut daftar itu bisa menghancurkan pesantren",
      "Salma memotret bukti dengan tangan gemetar",
      "satu nama dalam daftar adalah nama ayah Naya"
    ],
    "cast": [
      "char:naya",
      "char:salma",
      "char:kyai-hamid"
    ],
    "threadIds": [
      "thread:kematian-laila",
      "thread:kunci-wakaf"
    ],
    "paragraphs": [
      "Kolong panggung aula pesantren tidak pernah terasa benar bagi Naya. Setiap sudutnya seperti menyimpan napas orang yang menunggu dipanggil, sementara daftar nama santri pindahan yang ditulis Laila terletak di hadapannya dengan tenang yang nyaris mengejek. Naya mencoba mengingat pesan ibunya: jangan takut pada pintu, takutlah pada orang yang menyuruhmu tidak bertanya. Tetapi pesan itu dulu hanya terdengar seperti nasihat untuk anak kecil yang sering kehilangan sandal di masjid. Sekarang, di usia yang memaksa dirinya terlihat dewasa, kalimat itu berubah menjadi pisau. Ia berdiri terlalu lama, sampai suara sandal dari arah belakang membuat tengkuknya menegang.",
      "Kyai Hamid menyebut daftar itu bisa menghancurkan pesantren. Kalimat itu datang tidak selalu dengan teriakan; justru semakin pelan diucapkan, semakin jelas ancamannya. Naya tahu ada orang-orang yang menguasai tempat ini bukan karena mereka benar, melainkan karena semua orang sudah terbiasa menunduk. Ia menatap wajah Salma, mencari celah yang bisa dibaca, tetapi yang ia temukan hanya kegelisahan yang disembunyikan di balik sikap biasa. Di pesantren, kebohongan tidak memakai pakaian hitam. Ia memakai senyum ustazah, kitab yang ditutup mendadak, dan aturan yang baru disebut setelah seseorang hampir menemukan jawaban.",
      "Salma memotret bukti dengan tangan gemetar. Bantuan itu kecil, hampir tidak pantas disebut pertolongan, namun bagi Naya yang mulai kehabisan tempat berpijak, hal kecil bisa terasa seperti tangan di tepi sumur. Ia menyimpan napas, mendengar bunyi malam, dan membiarkan dirinya membaca ulang semua kejadian sejak pulang. Kenapa semua orang tahu nama ibunya, tetapi tidak seorang pun berani mengucapkannya dengan wajar? Kenapa setiap arsip tentang Laila selalu punya bekas sobekan? Hamid pernah berkata bahwa beberapa keluarga tidak runtuh karena miskin, melainkan karena terlalu lama menyimpan malu milik orang lain.",
      "Petunjuk tentang daftar nama santri pindahan yang ditulis Laila membuat Naya sadar bahwa misteri ini tidak berdiri sendiri. Ada tanah wakaf, nama anak-anak yang dipindahkan, para pengurus yang takut kehilangan muka, dan keluarga yang dibiarkan patah agar bangunan pesantren tetap terlihat kokoh. Ia ingat tiga jalan yang sejak awal membayanginya: menggali sendiri sampai kebenaran telanjang, patuh sebentar untuk memancing pengakuan, atau keluar dari pagar agar bukti tidak ikut dikubur. Pilihan itu tidak pernah benar-benar bersih. Jalan pertama bisa menghancurkan orang yang masih ingin ia percaya. Jalan kedua bisa menjadikannya alat para pembohong. Jalan ketiga bisa membuatnya kehilangan akses pada semua pintu yang baru mulai terbuka. Namun diam jelas bukan pilihan; diam adalah bahasa yang selama ini dipakai untuk mengubur Laila.",
      "Ketika Naya menyentuh bukti itu, nama ibu Naya berdiri di tengah noda tinta. Dadanya terasa seperti dipenuhi air yang tidak menemukan jalan keluar. Ia marah pada ibunya karena meninggalkan teka-teki, marah pada ayah yang entah hidup atau mati, marah pada Marwah yang selalu berbicara seolah luka orang lain adalah urusan administrasi. Tetapi paling dalam, Naya marah pada dirinya sendiri karena masih ingin seseorang berkata bahwa semua ini salah paham. Anak yang kehilangan ibu kadang tidak mencari kebenaran dulu; ia mencari satu orang dewasa yang bersedia mengaku telah gagal melindunginya.",
      "Dialog yang terjadi setelah itu pendek, tetapi menancap. 'Kamu tidak paham akibatnya,' kata suara yang menahan panik. Naya menjawab pelan, 'Mungkin. Tapi kalian terlalu lama memakai kata akibat untuk menutup kata dosa.' Ruangan mendadak sempit. Salma memalingkan muka, seolah kalimat itu mengenai bagian dirinya yang paling ia sembunyikan. Di luar, suara santri mengaji terdengar jauh, bersih, hampir tidak cocok dengan kebusukan yang pelan-pelan muncul di balik dinding. Naya mendadak paham mengapa ibunya dulu selalu memilih duduk di belakang, dekat pintu keluar.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Makin malam, tekanan makin rapi. Ada yang mengunci pintu, ada yang memindahkan map, ada yang mengirim pesan tanpa nama. Naya mulai membedakan takut yang melumpuhkan dan takut yang memberi tenaga. Ia mencatat urutan kejadian dalam kepala: siapa datang lebih dulu, siapa terlalu cepat tahu, siapa pura-pura kaget, siapa menyebut nama Laila dengan suara seperti meminta ampun. Jika suatu hari ia harus berdiri di depan semua orang, ia tidak boleh hanya membawa tangis. Ia harus membawa urutan, tanggal, suara, dan bukti yang tidak bisa dipelintir menjadi cerita anak durhaka. Yang terbuka bukan sekadar petunjuk, melainkan rahasia yang mengubah cara Naya membaca semua babak sebelumnya.",
      "Menjelang akhir babak itu, satu nama dalam daftar adalah nama ayah Naya. Naya tidak langsung bergerak. Tubuhnya ingin lari, tetapi sesuatu di dalam dirinya justru menjadi tenang, seperti orang yang akhirnya melihat bentuk musuh setelah lama dipukul dari gelap. Ia menggenggam bukti yang tersisa, menatap lorong, lalu berbisik pada nama ibunya tanpa suara. Besok mereka mungkin menuduhnya. Besok ia mungkin terusir. Besok orang-orang yang terlihat saleh bisa menunjukkan wajah asli. Namun malam ini satu hal pasti: pintu yang pernah ditutup untuk Laila mulai terbuka untuk Naya."
    ],
    "wordCount": 821,
    "sceneCount": 4,
    "reveals": [
      "secret:daftar-nama-laila"
    ],
    "newNamedCharacters": [],
    "proposedStateDelta": {
      "chapter10_progress": true,
      "tension": true,
      "revealed_daftar_nama_laila": true
    },
    "dialogue": [
      {
        "characterId": "char:naya",
        "text": "Aku tidak pulang untuk jadi anak baik di depan kebohongan."
      },
      {
        "characterId": "char:salma",
        "text": "Kalau kamu terus membuka pintu itu, tidak semua orang bisa diselamatkan."
      }
    ],
    "emotionBeats": [
      {
        "characterId": "char:naya",
        "targetCharacterId": "char:salma",
        "valence": "cold"
      }
    ]
  },
  {
    "chapterNumber": 11,
    "title": "Sajadah Bernoda Tanah",
    "phase": "ACT_2_JEJAK_LAILA",
    "chapterGoal": "Menggerakkan konflik Bilik Ketujuh melalui sajadah lama dengan tanah merah mengering dan tekanan utama: Marwah berkata ibadah tidak boleh dicampur dendam.",
    "mandatoryBeats": [
      "sajadah lama dengan tanah merah mengering",
      "Marwah berkata ibadah tidak boleh dicampur dendam",
      "Naya menyelipkan sobekan benang ke saku",
      "tanah itu sama dengan tanah makam kosong di belakang pesantren"
    ],
    "cast": [
      "char:naya",
      "char:ustazah-marwah",
      "char:salma"
    ],
    "threadIds": [
      "thread:kematian-laila"
    ],
    "paragraphs": [
      "Mushala putri yang ditutup untuk renovasi tidak pernah terasa benar bagi Naya. Setiap sudutnya seperti menyimpan napas orang yang menunggu dipanggil, sementara sajadah lama dengan tanah merah mengering terletak di hadapannya dengan tenang yang nyaris mengejek. Naya mencoba mengingat pesan ibunya: jangan takut pada pintu, takutlah pada orang yang menyuruhmu tidak bertanya. Tetapi pesan itu dulu hanya terdengar seperti nasihat untuk anak kecil yang sering kehilangan sandal di masjid. Sekarang, di usia yang memaksa dirinya terlihat dewasa, kalimat itu berubah menjadi pisau. Ia berdiri terlalu lama, sampai suara sandal dari arah belakang membuat tengkuknya menegang.",
      "Marwah berkata ibadah tidak boleh dicampur dendam. Kalimat itu datang tidak selalu dengan teriakan; justru semakin pelan diucapkan, semakin jelas ancamannya. Naya tahu ada orang-orang yang menguasai tempat ini bukan karena mereka benar, melainkan karena semua orang sudah terbiasa menunduk. Ia menatap wajah Marwah, mencari celah yang bisa dibaca, tetapi yang ia temukan hanya kegelisahan yang disembunyikan di balik sikap biasa. Di pesantren, kebohongan tidak memakai pakaian hitam. Ia memakai senyum ustazah, kitab yang ditutup mendadak, dan aturan yang baru disebut setelah seseorang hampir menemukan jawaban.",
      "Naya menyelipkan sobekan benang ke saku. Bantuan itu kecil, hampir tidak pantas disebut pertolongan, namun bagi Naya yang mulai kehabisan tempat berpijak, hal kecil bisa terasa seperti tangan di tepi sumur. Ia menyimpan napas, mendengar bunyi malam, dan membiarkan dirinya membaca ulang semua kejadian sejak pulang. Kenapa semua orang tahu nama ibunya, tetapi tidak seorang pun berani mengucapkannya dengan wajar? Kenapa setiap arsip tentang Laila selalu punya bekas sobekan? Salma pernah berkata bahwa beberapa keluarga tidak runtuh karena miskin, melainkan karena terlalu lama menyimpan malu milik orang lain.",
      "Petunjuk tentang sajadah lama dengan tanah merah mengering membuat Naya sadar bahwa misteri ini tidak berdiri sendiri. Ada tanah wakaf, nama anak-anak yang dipindahkan, para pengurus yang takut kehilangan muka, dan keluarga yang dibiarkan patah agar bangunan pesantren tetap terlihat kokoh. Ia ingat tiga jalan yang sejak awal membayanginya: menggali sendiri sampai kebenaran telanjang, patuh sebentar untuk memancing pengakuan, atau keluar dari pagar agar bukti tidak ikut dikubur. Pilihan itu tidak pernah benar-benar bersih. Jalan pertama bisa menghancurkan orang yang masih ingin ia percaya. Jalan kedua bisa menjadikannya alat para pembohong. Jalan ketiga bisa membuatnya kehilangan akses pada semua pintu yang baru mulai terbuka. Namun diam jelas bukan pilihan; diam adalah bahasa yang selama ini dipakai untuk mengubur Laila.",
      "Ketika Naya menyentuh bukti itu, doa Naya tidak lagi meminta tenang tetapi keberanian. Dadanya terasa seperti dipenuhi air yang tidak menemukan jalan keluar. Ia marah pada ibunya karena meninggalkan teka-teki, marah pada ayah yang entah hidup atau mati, marah pada Marwah yang selalu berbicara seolah luka orang lain adalah urusan administrasi. Tetapi paling dalam, Naya marah pada dirinya sendiri karena masih ingin seseorang berkata bahwa semua ini salah paham. Anak yang kehilangan ibu kadang tidak mencari kebenaran dulu; ia mencari satu orang dewasa yang bersedia mengaku telah gagal melindunginya.",
      "Dialog yang terjadi setelah itu pendek, tetapi menancap. 'Kamu tidak paham akibatnya,' kata suara yang menahan panik. Naya menjawab pelan, 'Mungkin. Tapi kalian terlalu lama memakai kata akibat untuk menutup kata dosa.' Ruangan mendadak sempit. Marwah memalingkan muka, seolah kalimat itu mengenai bagian dirinya yang paling ia sembunyikan. Di luar, suara santri mengaji terdengar jauh, bersih, hampir tidak cocok dengan kebusukan yang pelan-pelan muncul di balik dinding. Naya mendadak paham mengapa ibunya dulu selalu memilih duduk di belakang, dekat pintu keluar.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Makin malam, tekanan makin rapi. Ada yang mengunci pintu, ada yang memindahkan map, ada yang mengirim pesan tanpa nama. Naya mulai membedakan takut yang melumpuhkan dan takut yang memberi tenaga. Ia mencatat urutan kejadian dalam kepala: siapa datang lebih dulu, siapa terlalu cepat tahu, siapa pura-pura kaget, siapa menyebut nama Laila dengan suara seperti meminta ampun. Jika suatu hari ia harus berdiri di depan semua orang, ia tidak boleh hanya membawa tangis. Ia harus membawa urutan, tanggal, suara, dan bukti yang tidak bisa dipelintir menjadi cerita anak durhaka.",
      "Menjelang akhir babak itu, tanah itu sama dengan tanah makam kosong di belakang pesantren. Naya tidak langsung bergerak. Tubuhnya ingin lari, tetapi sesuatu di dalam dirinya justru menjadi tenang, seperti orang yang akhirnya melihat bentuk musuh setelah lama dipukul dari gelap. Ia menggenggam bukti yang tersisa, menatap lorong, lalu berbisik pada nama ibunya tanpa suara. Besok mereka mungkin menuduhnya. Besok ia mungkin terusir. Besok orang-orang yang terlihat saleh bisa menunjukkan wajah asli. Namun malam ini satu hal pasti: pintu yang pernah ditutup untuk Laila mulai terbuka untuk Naya."
    ],
    "wordCount": 880,
    "sceneCount": 4,
    "reveals": [],
    "newNamedCharacters": [],
    "proposedStateDelta": {
      "chapter11_progress": true,
      "tension": true
    },
    "dialogue": [
      {
        "characterId": "char:naya",
        "text": "Aku tidak pulang untuk jadi anak baik di depan kebohongan."
      },
      {
        "characterId": "char:ustazah-marwah",
        "text": "Kalau kamu terus membuka pintu itu, tidak semua orang bisa diselamatkan."
      }
    ],
    "emotionBeats": [
      {
        "characterId": "char:naya",
        "targetCharacterId": "char:ustazah-marwah",
        "valence": "cold"
      }
    ]
  },
  {
    "chapterNumber": 12,
    "title": "Surat dari Kamar Santri Lama",
    "phase": "ACT_2_JEJAK_LAILA",
    "chapterGoal": "Menggerakkan konflik Bilik Ketujuh melalui surat tanpa amplop di balik papan kasur dan tekanan utama: Hafiz mengaku menyembunyikan surat atas permintaan Laila.",
    "mandatoryBeats": [
      "surat tanpa amplop di balik papan kasur",
      "Hafiz mengaku menyembunyikan surat atas permintaan Laila",
      "Salma mendengar santri senior mencari mereka",
      "surat itu menyebut pria bernama Arman"
    ],
    "cast": [
      "char:naya",
      "char:hafiz",
      "char:salma"
    ],
    "threadIds": [
      "thread:keluarga-naya",
      "thread:loyalitas-hafiz"
    ],
    "paragraphs": [
      "Kamar santri lama nomor tujuh tidak pernah terasa benar bagi Naya. Setiap sudutnya seperti menyimpan napas orang yang menunggu dipanggil, sementara surat tanpa amplop di balik papan kasur terletak di hadapannya dengan tenang yang nyaris mengejek. Naya mencoba mengingat pesan ibunya: jangan takut pada pintu, takutlah pada orang yang menyuruhmu tidak bertanya. Tetapi pesan itu dulu hanya terdengar seperti nasihat untuk anak kecil yang sering kehilangan sandal di masjid. Sekarang, di usia yang memaksa dirinya terlihat dewasa, kalimat itu berubah menjadi pisau. Ia berdiri terlalu lama, sampai suara sandal dari arah belakang membuat tengkuknya menegang.",
      "Hafiz mengaku menyembunyikan surat atas permintaan Laila. Kalimat itu datang tidak selalu dengan teriakan; justru semakin pelan diucapkan, semakin jelas ancamannya. Naya tahu ada orang-orang yang menguasai tempat ini bukan karena mereka benar, melainkan karena semua orang sudah terbiasa menunduk. Ia menatap wajah Hafiz, mencari celah yang bisa dibaca, tetapi yang ia temukan hanya kegelisahan yang disembunyikan di balik sikap biasa. Di pesantren, kebohongan tidak memakai pakaian hitam. Ia memakai senyum ustazah, kitab yang ditutup mendadak, dan aturan yang baru disebut setelah seseorang hampir menemukan jawaban.",
      "Salma mendengar santri senior mencari mereka. Bantuan itu kecil, hampir tidak pantas disebut pertolongan, namun bagi Naya yang mulai kehabisan tempat berpijak, hal kecil bisa terasa seperti tangan di tepi sumur. Ia menyimpan napas, mendengar bunyi malam, dan membiarkan dirinya membaca ulang semua kejadian sejak pulang. Kenapa semua orang tahu nama ibunya, tetapi tidak seorang pun berani mengucapkannya dengan wajar? Kenapa setiap arsip tentang Laila selalu punya bekas sobekan? Salma pernah berkata bahwa beberapa keluarga tidak runtuh karena miskin, melainkan karena terlalu lama menyimpan malu milik orang lain.",
      "Petunjuk tentang surat tanpa amplop di balik papan kasur membuat Naya sadar bahwa misteri ini tidak berdiri sendiri. Ada tanah wakaf, nama anak-anak yang dipindahkan, para pengurus yang takut kehilangan muka, dan keluarga yang dibiarkan patah agar bangunan pesantren tetap terlihat kokoh. Ia ingat tiga jalan yang sejak awal membayanginya: menggali sendiri sampai kebenaran telanjang, patuh sebentar untuk memancing pengakuan, atau keluar dari pagar agar bukti tidak ikut dikubur. Pilihan itu tidak pernah benar-benar bersih. Jalan pertama bisa menghancurkan orang yang masih ingin ia percaya. Jalan kedua bisa menjadikannya alat para pembohong. Jalan ketiga bisa membuatnya kehilangan akses pada semua pintu yang baru mulai terbuka. Namun diam jelas bukan pilihan; diam adalah bahasa yang selama ini dipakai untuk mengubur Laila.",
      "Ketika Naya menyentuh bukti itu, Naya membaca panggilan ibu yang terlalu hidup. Dadanya terasa seperti dipenuhi air yang tidak menemukan jalan keluar. Ia marah pada ibunya karena meninggalkan teka-teki, marah pada ayah yang entah hidup atau mati, marah pada Marwah yang selalu berbicara seolah luka orang lain adalah urusan administrasi. Tetapi paling dalam, Naya marah pada dirinya sendiri karena masih ingin seseorang berkata bahwa semua ini salah paham. Anak yang kehilangan ibu kadang tidak mencari kebenaran dulu; ia mencari satu orang dewasa yang bersedia mengaku telah gagal melindunginya.",
      "Dialog yang terjadi setelah itu pendek, tetapi menancap. 'Kamu tidak paham akibatnya,' kata suara yang menahan panik. Naya menjawab pelan, 'Mungkin. Tapi kalian terlalu lama memakai kata akibat untuk menutup kata dosa.' Ruangan mendadak sempit. Hafiz memalingkan muka, seolah kalimat itu mengenai bagian dirinya yang paling ia sembunyikan. Di luar, suara santri mengaji terdengar jauh, bersih, hampir tidak cocok dengan kebusukan yang pelan-pelan muncul di balik dinding. Naya mendadak paham mengapa ibunya dulu selalu memilih duduk di belakang, dekat pintu keluar.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Makin malam, tekanan makin rapi. Ada yang mengunci pintu, ada yang memindahkan map, ada yang mengirim pesan tanpa nama. Naya mulai membedakan takut yang melumpuhkan dan takut yang memberi tenaga. Ia mencatat urutan kejadian dalam kepala: siapa datang lebih dulu, siapa terlalu cepat tahu, siapa pura-pura kaget, siapa menyebut nama Laila dengan suara seperti meminta ampun. Jika suatu hari ia harus berdiri di depan semua orang, ia tidak boleh hanya membawa tangis. Ia harus membawa urutan, tanggal, suara, dan bukti yang tidak bisa dipelintir menjadi cerita anak durhaka.",
      "Menjelang akhir babak itu, surat itu menyebut pria bernama Arman. Naya tidak langsung bergerak. Tubuhnya ingin lari, tetapi sesuatu di dalam dirinya justru menjadi tenang, seperti orang yang akhirnya melihat bentuk musuh setelah lama dipukul dari gelap. Ia menggenggam bukti yang tersisa, menatap lorong, lalu berbisik pada nama ibunya tanpa suara. Besok mereka mungkin menuduhnya. Besok ia mungkin terusir. Besok orang-orang yang terlihat saleh bisa menunjukkan wajah asli. Namun malam ini satu hal pasti: pintu yang pernah ditutup untuk Laila mulai terbuka untuk Naya."
    ],
    "wordCount": 876,
    "sceneCount": 4,
    "reveals": [],
    "newNamedCharacters": [],
    "proposedStateDelta": {
      "chapter12_progress": true,
      "tension": true
    },
    "dialogue": [
      {
        "characterId": "char:naya",
        "text": "Aku tidak pulang untuk jadi anak baik di depan kebohongan."
      },
      {
        "characterId": "char:hafiz",
        "text": "Kalau kamu terus membuka pintu itu, tidak semua orang bisa diselamatkan."
      }
    ],
    "emotionBeats": [
      {
        "characterId": "char:naya",
        "targetCharacterId": "char:hafiz",
        "valence": "cold"
      }
    ]
  },
  {
    "chapterNumber": 13,
    "title": "Tukang Kebun Bernama Arman",
    "phase": "ACT_3_KELUARGA_YANG_DIPISAHKAN",
    "chapterGoal": "Menggerakkan konflik Bilik Ketujuh melalui cangkul tua bertanda inisial ayah Naya dan tekanan utama: Arman pura-pura tidak mengenal nama Laila.",
    "mandatoryBeats": [
      "cangkul tua bertanda inisial ayah Naya",
      "Arman pura-pura tidak mengenal nama Laila",
      "Hafiz menahan Naya agar tidak menuduh langsung",
      "Arman menyimpan cincin ayah yang hilang dari pemakaman"
    ],
    "cast": [
      "char:naya",
      "char:hafiz",
      "char:arman"
    ],
    "threadIds": [
      "thread:keluarga-naya"
    ],
    "paragraphs": [
      "Kebun mangga di sisi makam tua tidak pernah terasa benar bagi Naya. Setiap sudutnya seperti menyimpan napas orang yang menunggu dipanggil, sementara cangkul tua bertanda inisial ayah Naya terletak di hadapannya dengan tenang yang nyaris mengejek. Naya mencoba mengingat pesan ibunya: jangan takut pada pintu, takutlah pada orang yang menyuruhmu tidak bertanya. Tetapi pesan itu dulu hanya terdengar seperti nasihat untuk anak kecil yang sering kehilangan sandal di masjid. Sekarang, di usia yang memaksa dirinya terlihat dewasa, kalimat itu berubah menjadi pisau. Ia berdiri terlalu lama, sampai suara sandal dari arah belakang membuat tengkuknya menegang.",
      "Arman pura-pura tidak mengenal nama Laila. Kalimat itu datang tidak selalu dengan teriakan; justru semakin pelan diucapkan, semakin jelas ancamannya. Naya tahu ada orang-orang yang menguasai tempat ini bukan karena mereka benar, melainkan karena semua orang sudah terbiasa menunduk. Ia menatap wajah Hafiz, mencari celah yang bisa dibaca, tetapi yang ia temukan hanya kegelisahan yang disembunyikan di balik sikap biasa. Di pesantren, kebohongan tidak memakai pakaian hitam. Ia memakai senyum ustazah, kitab yang ditutup mendadak, dan aturan yang baru disebut setelah seseorang hampir menemukan jawaban.",
      "Hafiz menahan Naya agar tidak menuduh langsung. Bantuan itu kecil, hampir tidak pantas disebut pertolongan, namun bagi Naya yang mulai kehabisan tempat berpijak, hal kecil bisa terasa seperti tangan di tepi sumur. Ia menyimpan napas, mendengar bunyi malam, dan membiarkan dirinya membaca ulang semua kejadian sejak pulang. Kenapa semua orang tahu nama ibunya, tetapi tidak seorang pun berani mengucapkannya dengan wajar? Kenapa setiap arsip tentang Laila selalu punya bekas sobekan? Arman pernah berkata bahwa beberapa keluarga tidak runtuh karena miskin, melainkan karena terlalu lama menyimpan malu milik orang lain.",
      "Petunjuk tentang cangkul tua bertanda inisial ayah Naya membuat Naya sadar bahwa misteri ini tidak berdiri sendiri. Ada tanah wakaf, nama anak-anak yang dipindahkan, para pengurus yang takut kehilangan muka, dan keluarga yang dibiarkan patah agar bangunan pesantren tetap terlihat kokoh. Ia ingat tiga jalan yang sejak awal membayanginya: menggali sendiri sampai kebenaran telanjang, patuh sebentar untuk memancing pengakuan, atau keluar dari pagar agar bukti tidak ikut dikubur. Pilihan itu tidak pernah benar-benar bersih. Jalan pertama bisa menghancurkan orang yang masih ingin ia percaya. Jalan kedua bisa menjadikannya alat para pembohong. Jalan ketiga bisa membuatnya kehilangan akses pada semua pintu yang baru mulai terbuka. Namun diam jelas bukan pilihan; diam adalah bahasa yang selama ini dipakai untuk mengubur Laila.",
      "Ketika Naya menyentuh bukti itu, rasa kehilangan Naya berubah menjadi curiga. Dadanya terasa seperti dipenuhi air yang tidak menemukan jalan keluar. Ia marah pada ibunya karena meninggalkan teka-teki, marah pada ayah yang entah hidup atau mati, marah pada Marwah yang selalu berbicara seolah luka orang lain adalah urusan administrasi. Tetapi paling dalam, Naya marah pada dirinya sendiri karena masih ingin seseorang berkata bahwa semua ini salah paham. Anak yang kehilangan ibu kadang tidak mencari kebenaran dulu; ia mencari satu orang dewasa yang bersedia mengaku telah gagal melindunginya.",
      "Dialog yang terjadi setelah itu pendek, tetapi menancap. 'Kamu tidak paham akibatnya,' kata suara yang menahan panik. Naya menjawab pelan, 'Mungkin. Tapi kalian terlalu lama memakai kata akibat untuk menutup kata dosa.' Ruangan mendadak sempit. Hafiz memalingkan muka, seolah kalimat itu mengenai bagian dirinya yang paling ia sembunyikan. Di luar, suara santri mengaji terdengar jauh, bersih, hampir tidak cocok dengan kebusukan yang pelan-pelan muncul di balik dinding. Naya mendadak paham mengapa ibunya dulu selalu memilih duduk di belakang, dekat pintu keluar.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Makin malam, tekanan makin rapi. Ada yang mengunci pintu, ada yang memindahkan map, ada yang mengirim pesan tanpa nama. Naya mulai membedakan takut yang melumpuhkan dan takut yang memberi tenaga. Ia mencatat urutan kejadian dalam kepala: siapa datang lebih dulu, siapa terlalu cepat tahu, siapa pura-pura kaget, siapa menyebut nama Laila dengan suara seperti meminta ampun. Jika suatu hari ia harus berdiri di depan semua orang, ia tidak boleh hanya membawa tangis. Ia harus membawa urutan, tanggal, suara, dan bukti yang tidak bisa dipelintir menjadi cerita anak durhaka.",
      "Menjelang akhir babak itu, Arman menyimpan cincin ayah yang hilang dari pemakaman. Naya tidak langsung bergerak. Tubuhnya ingin lari, tetapi sesuatu di dalam dirinya justru menjadi tenang, seperti orang yang akhirnya melihat bentuk musuh setelah lama dipukul dari gelap. Ia menggenggam bukti yang tersisa, menatap lorong, lalu berbisik pada nama ibunya tanpa suara. Besok mereka mungkin menuduhnya. Besok ia mungkin terusir. Besok orang-orang yang terlihat saleh bisa menunjukkan wajah asli. Namun malam ini satu hal pasti: pintu yang pernah ditutup untuk Laila mulai terbuka untuk Naya."
    ],
    "wordCount": 876,
    "sceneCount": 4,
    "reveals": [],
    "newNamedCharacters": [
      "char:arman"
    ],
    "proposedStateDelta": {
      "chapter13_progress": true,
      "tension": true
    },
    "dialogue": [
      {
        "characterId": "char:naya",
        "text": "Aku tidak pulang untuk jadi anak baik di depan kebohongan."
      },
      {
        "characterId": "char:hafiz",
        "text": "Kalau kamu terus membuka pintu itu, tidak semua orang bisa diselamatkan."
      }
    ],
    "emotionBeats": [
      {
        "characterId": "char:naya",
        "targetCharacterId": "char:hafiz",
        "valence": "cold"
      }
    ]
  },
  {
    "chapterNumber": 14,
    "title": "Pilihan di Bawah Menara Air",
    "phase": "ACT_3_KELUARGA_YANG_DIPISAHKAN",
    "chapterGoal": "Menggerakkan konflik Bilik Ketujuh melalui cincin ayah yang tergenggam di tangan Arman dan tekanan utama: Marwah meminta Naya memilih diam atau kehilangan semua.",
    "mandatoryBeats": [
      "cincin ayah yang tergenggam di tangan Arman",
      "Marwah meminta Naya memilih diam atau kehilangan semua",
      "Salma menawarkan jalur kabur lewat dapur umum",
      "sirene pesantren berbunyi sebelum Naya menjawab"
    ],
    "cast": [
      "char:naya",
      "char:ustazah-marwah",
      "char:salma",
      "char:arman"
    ],
    "threadIds": [
      "thread:keluarga-naya",
      "thread:bilik-ketujuh"
    ],
    "paragraphs": [
      "Bawah menara air setelah tengah malam tidak pernah terasa benar bagi Naya. Setiap sudutnya seperti menyimpan napas orang yang menunggu dipanggil, sementara cincin ayah yang tergenggam di tangan Arman terletak di hadapannya dengan tenang yang nyaris mengejek. Naya mencoba mengingat pesan ibunya: jangan takut pada pintu, takutlah pada orang yang menyuruhmu tidak bertanya. Tetapi pesan itu dulu hanya terdengar seperti nasihat untuk anak kecil yang sering kehilangan sandal di masjid. Sekarang, di usia yang memaksa dirinya terlihat dewasa, kalimat itu berubah menjadi pisau. Ia berdiri terlalu lama, sampai suara sandal dari arah belakang membuat tengkuknya menegang.",
      "Marwah meminta Naya memilih diam atau kehilangan semua. Kalimat itu datang tidak selalu dengan teriakan; justru semakin pelan diucapkan, semakin jelas ancamannya. Naya tahu ada orang-orang yang menguasai tempat ini bukan karena mereka benar, melainkan karena semua orang sudah terbiasa menunduk. Ia menatap wajah Marwah, mencari celah yang bisa dibaca, tetapi yang ia temukan hanya kegelisahan yang disembunyikan di balik sikap biasa. Di pesantren, kebohongan tidak memakai pakaian hitam. Ia memakai senyum ustazah, kitab yang ditutup mendadak, dan aturan yang baru disebut setelah seseorang hampir menemukan jawaban.",
      "Salma menawarkan jalur kabur lewat dapur umum. Bantuan itu kecil, hampir tidak pantas disebut pertolongan, namun bagi Naya yang mulai kehabisan tempat berpijak, hal kecil bisa terasa seperti tangan di tepi sumur. Ia menyimpan napas, mendengar bunyi malam, dan membiarkan dirinya membaca ulang semua kejadian sejak pulang. Kenapa semua orang tahu nama ibunya, tetapi tidak seorang pun berani mengucapkannya dengan wajar? Kenapa setiap arsip tentang Laila selalu punya bekas sobekan? Salma pernah berkata bahwa beberapa keluarga tidak runtuh karena miskin, melainkan karena terlalu lama menyimpan malu milik orang lain.",
      "Petunjuk tentang cincin ayah yang tergenggam di tangan Arman membuat Naya sadar bahwa misteri ini tidak berdiri sendiri. Ada tanah wakaf, nama anak-anak yang dipindahkan, para pengurus yang takut kehilangan muka, dan keluarga yang dibiarkan patah agar bangunan pesantren tetap terlihat kokoh. Malam itu cerita memberinya simpang yang tidak sopan: membongkar sekarang, mengikuti aturan yang mungkin busuk, atau menyelamatkan bukti dengan cara yang membuatnya tampak bersalah. Pilihan itu tidak pernah benar-benar bersih. Jalan pertama bisa menghancurkan orang yang masih ingin ia percaya. Jalan kedua bisa menjadikannya alat para pembohong. Jalan ketiga bisa membuatnya kehilangan akses pada semua pintu yang baru mulai terbuka. Namun diam jelas bukan pilihan; diam adalah bahasa yang selama ini dipakai untuk mengubur Laila.",
      "Ketika Naya menyentuh bukti itu, Naya sadar pilihan kecil bisa menghancurkan orang lain. Dadanya terasa seperti dipenuhi air yang tidak menemukan jalan keluar. Ia marah pada ibunya karena meninggalkan teka-teki, marah pada ayah yang entah hidup atau mati, marah pada Marwah yang selalu berbicara seolah luka orang lain adalah urusan administrasi. Tetapi paling dalam, Naya marah pada dirinya sendiri karena masih ingin seseorang berkata bahwa semua ini salah paham. Anak yang kehilangan ibu kadang tidak mencari kebenaran dulu; ia mencari satu orang dewasa yang bersedia mengaku telah gagal melindunginya.",
      "Dialog yang terjadi setelah itu pendek, tetapi menancap. 'Kamu tidak paham akibatnya,' kata suara yang menahan panik. Naya menjawab pelan, 'Mungkin. Tapi kalian terlalu lama memakai kata akibat untuk menutup kata dosa.' Ruangan mendadak sempit. Marwah memalingkan muka, seolah kalimat itu mengenai bagian dirinya yang paling ia sembunyikan. Di luar, suara santri mengaji terdengar jauh, bersih, hampir tidak cocok dengan kebusukan yang pelan-pelan muncul di balik dinding. Naya mendadak paham mengapa ibunya dulu selalu memilih duduk di belakang, dekat pintu keluar.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Makin malam, tekanan makin rapi. Ada yang mengunci pintu, ada yang memindahkan map, ada yang mengirim pesan tanpa nama. Naya mulai membedakan takut yang melumpuhkan dan takut yang memberi tenaga. Ia mencatat urutan kejadian dalam kepala: siapa datang lebih dulu, siapa terlalu cepat tahu, siapa pura-pura kaget, siapa menyebut nama Laila dengan suara seperti meminta ampun. Jika suatu hari ia harus berdiri di depan semua orang, ia tidak boleh hanya membawa tangis. Ia harus membawa urutan, tanggal, suara, dan bukti yang tidak bisa dipelintir menjadi cerita anak durhaka.",
      "Menjelang akhir babak itu, sirene pesantren berbunyi sebelum Naya menjawab. Naya tidak langsung bergerak. Tubuhnya ingin lari, tetapi sesuatu di dalam dirinya justru menjadi tenang, seperti orang yang akhirnya melihat bentuk musuh setelah lama dipukul dari gelap. Ia menggenggam bukti yang tersisa, menatap lorong, lalu berbisik pada nama ibunya tanpa suara. Besok mereka mungkin menuduhnya. Besok ia mungkin terusir. Besok orang-orang yang terlihat saleh bisa menunjukkan wajah asli. Namun malam ini satu hal pasti: pintu yang pernah ditutup untuk Laila mulai terbuka untuk Naya."
    ],
    "wordCount": 877,
    "sceneCount": 4,
    "reveals": [],
    "newNamedCharacters": [],
    "proposedStateDelta": {
      "chapter14_progress": true,
      "tension": true,
      "choice_chapter_14": true
    },
    "dialogue": [
      {
        "characterId": "char:naya",
        "text": "Aku tidak pulang untuk jadi anak baik di depan kebohongan."
      },
      {
        "characterId": "char:ustazah-marwah",
        "text": "Kalau kamu terus membuka pintu itu, tidak semua orang bisa diselamatkan."
      }
    ],
    "emotionBeats": [
      {
        "characterId": "char:naya",
        "targetCharacterId": "char:ustazah-marwah",
        "valence": "cold"
      }
    ]
  },
  {
    "chapterNumber": 15,
    "title": "Kamar Perawatan Lama",
    "phase": "ACT_3_KELUARGA_YANG_DIPISAHKAN",
    "chapterGoal": "Menggerakkan konflik Bilik Ketujuh melalui catatan medis yang tidak pernah masuk klinik dan tekanan utama: Kyai Hamid menyatakan Laila sakit dan berbahaya.",
    "mandatoryBeats": [
      "catatan medis yang tidak pernah masuk klinik",
      "Kyai Hamid menyatakan Laila sakit dan berbahaya",
      "Rukmini menunjukkan paraf palsu di bawah diagnosis",
      "catatan itu ditandatangani orang bernama Arman Mahendra"
    ],
    "cast": [
      "char:naya",
      "char:kyai-hamid",
      "char:bu-rukmini",
      "char:arman"
    ],
    "threadIds": [
      "thread:kematian-laila",
      "thread:keluarga-naya"
    ],
    "paragraphs": [
      "Bangunan perawatan lama yang berdebu tidak pernah terasa benar bagi Naya. Setiap sudutnya seperti menyimpan napas orang yang menunggu dipanggil, sementara catatan medis yang tidak pernah masuk klinik terletak di hadapannya dengan tenang yang nyaris mengejek. Naya mencoba mengingat pesan ibunya: jangan takut pada pintu, takutlah pada orang yang menyuruhmu tidak bertanya. Tetapi pesan itu dulu hanya terdengar seperti nasihat untuk anak kecil yang sering kehilangan sandal di masjid. Sekarang, di usia yang memaksa dirinya terlihat dewasa, kalimat itu berubah menjadi pisau. Ia berdiri terlalu lama, sampai suara sandal dari arah belakang membuat tengkuknya menegang.",
      "Kyai Hamid menyatakan Laila sakit dan berbahaya. Kalimat itu datang tidak selalu dengan teriakan; justru semakin pelan diucapkan, semakin jelas ancamannya. Naya tahu ada orang-orang yang menguasai tempat ini bukan karena mereka benar, melainkan karena semua orang sudah terbiasa menunduk. Ia menatap wajah Hamid, mencari celah yang bisa dibaca, tetapi yang ia temukan hanya kegelisahan yang disembunyikan di balik sikap biasa. Di pesantren, kebohongan tidak memakai pakaian hitam. Ia memakai senyum ustazah, kitab yang ditutup mendadak, dan aturan yang baru disebut setelah seseorang hampir menemukan jawaban.",
      "Rukmini menunjukkan paraf palsu di bawah diagnosis. Bantuan itu kecil, hampir tidak pantas disebut pertolongan, namun bagi Naya yang mulai kehabisan tempat berpijak, hal kecil bisa terasa seperti tangan di tepi sumur. Ia menyimpan napas, mendengar bunyi malam, dan membiarkan dirinya membaca ulang semua kejadian sejak pulang. Kenapa semua orang tahu nama ibunya, tetapi tidak seorang pun berani mengucapkannya dengan wajar? Kenapa setiap arsip tentang Laila selalu punya bekas sobekan? Rukmini pernah berkata bahwa beberapa keluarga tidak runtuh karena miskin, melainkan karena terlalu lama menyimpan malu milik orang lain.",
      "Petunjuk tentang catatan medis yang tidak pernah masuk klinik membuat Naya sadar bahwa misteri ini tidak berdiri sendiri. Ada tanah wakaf, nama anak-anak yang dipindahkan, para pengurus yang takut kehilangan muka, dan keluarga yang dibiarkan patah agar bangunan pesantren tetap terlihat kokoh. Ia ingat tiga jalan yang sejak awal membayanginya: menggali sendiri sampai kebenaran telanjang, patuh sebentar untuk memancing pengakuan, atau keluar dari pagar agar bukti tidak ikut dikubur. Pilihan itu tidak pernah benar-benar bersih. Jalan pertama bisa menghancurkan orang yang masih ingin ia percaya. Jalan kedua bisa menjadikannya alat para pembohong. Jalan ketiga bisa membuatnya kehilangan akses pada semua pintu yang baru mulai terbuka. Namun diam jelas bukan pilihan; diam adalah bahasa yang selama ini dipakai untuk mengubur Laila.",
      "Ketika Naya menyentuh bukti itu, Naya gemetar antara marah dan iba. Dadanya terasa seperti dipenuhi air yang tidak menemukan jalan keluar. Ia marah pada ibunya karena meninggalkan teka-teki, marah pada ayah yang entah hidup atau mati, marah pada Marwah yang selalu berbicara seolah luka orang lain adalah urusan administrasi. Tetapi paling dalam, Naya marah pada dirinya sendiri karena masih ingin seseorang berkata bahwa semua ini salah paham. Anak yang kehilangan ibu kadang tidak mencari kebenaran dulu; ia mencari satu orang dewasa yang bersedia mengaku telah gagal melindunginya.",
      "Dialog yang terjadi setelah itu pendek, tetapi menancap. 'Kamu tidak paham akibatnya,' kata suara yang menahan panik. Naya menjawab pelan, 'Mungkin. Tapi kalian terlalu lama memakai kata akibat untuk menutup kata dosa.' Ruangan mendadak sempit. Hamid memalingkan muka, seolah kalimat itu mengenai bagian dirinya yang paling ia sembunyikan. Di luar, suara santri mengaji terdengar jauh, bersih, hampir tidak cocok dengan kebusukan yang pelan-pelan muncul di balik dinding. Naya mendadak paham mengapa ibunya dulu selalu memilih duduk di belakang, dekat pintu keluar.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Makin malam, tekanan makin rapi. Ada yang mengunci pintu, ada yang memindahkan map, ada yang mengirim pesan tanpa nama. Naya mulai membedakan takut yang melumpuhkan dan takut yang memberi tenaga. Ia mencatat urutan kejadian dalam kepala: siapa datang lebih dulu, siapa terlalu cepat tahu, siapa pura-pura kaget, siapa menyebut nama Laila dengan suara seperti meminta ampun. Jika suatu hari ia harus berdiri di depan semua orang, ia tidak boleh hanya membawa tangis. Ia harus membawa urutan, tanggal, suara, dan bukti yang tidak bisa dipelintir menjadi cerita anak durhaka.",
      "Menjelang akhir babak itu, catatan itu ditandatangani orang bernama Arman Mahendra. Naya tidak langsung bergerak. Tubuhnya ingin lari, tetapi sesuatu di dalam dirinya justru menjadi tenang, seperti orang yang akhirnya melihat bentuk musuh setelah lama dipukul dari gelap. Ia menggenggam bukti yang tersisa, menatap lorong, lalu berbisik pada nama ibunya tanpa suara. Besok mereka mungkin menuduhnya. Besok ia mungkin terusir. Besok orang-orang yang terlihat saleh bisa menunjukkan wajah asli. Namun malam ini satu hal pasti: pintu yang pernah ditutup untuk Laila mulai terbuka untuk Naya."
    ],
    "wordCount": 877,
    "sceneCount": 4,
    "reveals": [],
    "newNamedCharacters": [],
    "proposedStateDelta": {
      "chapter15_progress": true,
      "tension": true
    },
    "dialogue": [
      {
        "characterId": "char:naya",
        "text": "Aku tidak pulang untuk jadi anak baik di depan kebohongan."
      },
      {
        "characterId": "char:kyai-hamid",
        "text": "Kalau kamu terus membuka pintu itu, tidak semua orang bisa diselamatkan."
      }
    ],
    "emotionBeats": [
      {
        "characterId": "char:naya",
        "targetCharacterId": "char:kyai-hamid",
        "valence": "cold"
      }
    ]
  },
  {
    "chapterNumber": 16,
    "title": "Ayah di Balik Nama Palsu",
    "phase": "ACT_3_KELUARGA_YANG_DIPISAHKAN",
    "chapterGoal": "Menggerakkan konflik Bilik Ketujuh melalui pengakuan Arman bahwa ia ayah Naya dan tekanan utama: Marwah datang membawa dua santri penjaga.",
    "mandatoryBeats": [
      "pengakuan Arman bahwa ia ayah Naya",
      "Marwah datang membawa dua santri penjaga",
      "Hafiz berdiri di depan Naya untuk pertama kalinya",
      "Arman berkata Laila mati setelah menolak menandatangani wakaf palsu"
    ],
    "cast": [
      "char:naya",
      "char:arman",
      "char:ustazah-marwah",
      "char:hafiz"
    ],
    "threadIds": [
      "thread:keluarga-naya",
      "thread:kunci-wakaf"
    ],
    "paragraphs": [
      "Kebun mangga saat azan subuh tidak pernah terasa benar bagi Naya. Setiap sudutnya seperti menyimpan napas orang yang menunggu dipanggil, sementara pengakuan Arman bahwa ia ayah Naya terletak di hadapannya dengan tenang yang nyaris mengejek. Naya mencoba mengingat pesan ibunya: jangan takut pada pintu, takutlah pada orang yang menyuruhmu tidak bertanya. Tetapi pesan itu dulu hanya terdengar seperti nasihat untuk anak kecil yang sering kehilangan sandal di masjid. Sekarang, di usia yang memaksa dirinya terlihat dewasa, kalimat itu berubah menjadi pisau. Ia berdiri terlalu lama, sampai suara sandal dari arah belakang membuat tengkuknya menegang.",
      "Marwah datang membawa dua santri penjaga. Kalimat itu datang tidak selalu dengan teriakan; justru semakin pelan diucapkan, semakin jelas ancamannya. Naya tahu ada orang-orang yang menguasai tempat ini bukan karena mereka benar, melainkan karena semua orang sudah terbiasa menunduk. Ia menatap wajah Arman, mencari celah yang bisa dibaca, tetapi yang ia temukan hanya kegelisahan yang disembunyikan di balik sikap biasa. Di pesantren, kebohongan tidak memakai pakaian hitam. Ia memakai senyum ustazah, kitab yang ditutup mendadak, dan aturan yang baru disebut setelah seseorang hampir menemukan jawaban.",
      "Hafiz berdiri di depan Naya untuk pertama kalinya. Bantuan itu kecil, hampir tidak pantas disebut pertolongan, namun bagi Naya yang mulai kehabisan tempat berpijak, hal kecil bisa terasa seperti tangan di tepi sumur. Ia menyimpan napas, mendengar bunyi malam, dan membiarkan dirinya membaca ulang semua kejadian sejak pulang. Kenapa semua orang tahu nama ibunya, tetapi tidak seorang pun berani mengucapkannya dengan wajar? Kenapa setiap arsip tentang Laila selalu punya bekas sobekan? Marwah pernah berkata bahwa beberapa keluarga tidak runtuh karena miskin, melainkan karena terlalu lama menyimpan malu milik orang lain.",
      "Petunjuk tentang pengakuan Arman bahwa ia ayah Naya membuat Naya sadar bahwa misteri ini tidak berdiri sendiri. Ada tanah wakaf, nama anak-anak yang dipindahkan, para pengurus yang takut kehilangan muka, dan keluarga yang dibiarkan patah agar bangunan pesantren tetap terlihat kokoh. Ia ingat tiga jalan yang sejak awal membayanginya: menggali sendiri sampai kebenaran telanjang, patuh sebentar untuk memancing pengakuan, atau keluar dari pagar agar bukti tidak ikut dikubur. Pilihan itu tidak pernah benar-benar bersih. Jalan pertama bisa menghancurkan orang yang masih ingin ia percaya. Jalan kedua bisa menjadikannya alat para pembohong. Jalan ketiga bisa membuatnya kehilangan akses pada semua pintu yang baru mulai terbuka. Namun diam jelas bukan pilihan; diam adalah bahasa yang selama ini dipakai untuk mengubur Laila.",
      "Ketika Naya menyentuh bukti itu, Naya tidak tahu harus memeluk atau menampar masa lalu. Dadanya terasa seperti dipenuhi air yang tidak menemukan jalan keluar. Ia marah pada ibunya karena meninggalkan teka-teki, marah pada ayah yang entah hidup atau mati, marah pada Marwah yang selalu berbicara seolah luka orang lain adalah urusan administrasi. Tetapi paling dalam, Naya marah pada dirinya sendiri karena masih ingin seseorang berkata bahwa semua ini salah paham. Anak yang kehilangan ibu kadang tidak mencari kebenaran dulu; ia mencari satu orang dewasa yang bersedia mengaku telah gagal melindunginya.",
      "Dialog yang terjadi setelah itu pendek, tetapi menancap. 'Kamu tidak paham akibatnya,' kata suara yang menahan panik. Naya menjawab pelan, 'Mungkin. Tapi kalian terlalu lama memakai kata akibat untuk menutup kata dosa.' Ruangan mendadak sempit. Arman memalingkan muka, seolah kalimat itu mengenai bagian dirinya yang paling ia sembunyikan. Di luar, suara santri mengaji terdengar jauh, bersih, hampir tidak cocok dengan kebusukan yang pelan-pelan muncul di balik dinding. Naya mendadak paham mengapa ibunya dulu selalu memilih duduk di belakang, dekat pintu keluar.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Makin malam, tekanan makin rapi. Ada yang mengunci pintu, ada yang memindahkan map, ada yang mengirim pesan tanpa nama. Naya mulai membedakan takut yang melumpuhkan dan takut yang memberi tenaga. Ia mencatat urutan kejadian dalam kepala: siapa datang lebih dulu, siapa terlalu cepat tahu, siapa pura-pura kaget, siapa menyebut nama Laila dengan suara seperti meminta ampun. Jika suatu hari ia harus berdiri di depan semua orang, ia tidak boleh hanya membawa tangis. Ia harus membawa urutan, tanggal, suara, dan bukti yang tidak bisa dipelintir menjadi cerita anak durhaka. Yang terbuka bukan sekadar petunjuk, melainkan rahasia yang mengubah cara Naya membaca semua babak sebelumnya.",
      "Menjelang akhir babak itu, Arman berkata Laila mati setelah menolak menandatangani wakaf palsu. Naya tidak langsung bergerak. Tubuhnya ingin lari, tetapi sesuatu di dalam dirinya justru menjadi tenang, seperti orang yang akhirnya melihat bentuk musuh setelah lama dipukul dari gelap. Ia menggenggam bukti yang tersisa, menatap lorong, lalu berbisik pada nama ibunya tanpa suara. Besok mereka mungkin menuduhnya. Besok ia mungkin terusir. Besok orang-orang yang terlihat saleh bisa menunjukkan wajah asli. Namun malam ini satu hal pasti: pintu yang pernah ditutup untuk Laila mulai terbuka untuk Naya."
    ],
    "wordCount": 822,
    "sceneCount": 4,
    "reveals": [
      "secret:ayah-naya-hidup"
    ],
    "newNamedCharacters": [],
    "proposedStateDelta": {
      "chapter16_progress": true,
      "tension": true,
      "revealed_ayah_naya_hidup": true
    },
    "dialogue": [
      {
        "characterId": "char:naya",
        "text": "Aku tidak pulang untuk jadi anak baik di depan kebohongan."
      },
      {
        "characterId": "char:arman",
        "text": "Kalau kamu terus membuka pintu itu, tidak semua orang bisa diselamatkan."
      }
    ],
    "emotionBeats": [
      {
        "characterId": "char:naya",
        "targetCharacterId": "char:arman",
        "valence": "cold"
      }
    ]
  },
  {
    "chapterNumber": 17,
    "title": "Perjanjian yang Ditandatangani Paksa",
    "phase": "ACT_3_KELUARGA_YANG_DIPISAHKAN",
    "chapterGoal": "Menggerakkan konflik Bilik Ketujuh melalui lembar perjanjian yang disimpan di botol obat dan tekanan utama: Arman mengakui ia dipaksa pergi demi keselamatan Naya.",
    "mandatoryBeats": [
      "lembar perjanjian yang disimpan di botol obat",
      "Arman mengakui ia dipaksa pergi demi keselamatan Naya",
      "Naya menuntut kenapa ayahnya tidak melawan lebih cepat",
      "suara motor Jamal berhenti di depan rumah"
    ],
    "cast": [
      "char:naya",
      "char:arman",
      "char:hafiz"
    ],
    "threadIds": [
      "thread:kunci-wakaf",
      "thread:keluarga-naya"
    ],
    "paragraphs": [
      "Rumah penjaga makam dekat sawah tidak pernah terasa benar bagi Naya. Setiap sudutnya seperti menyimpan napas orang yang menunggu dipanggil, sementara lembar perjanjian yang disimpan di botol obat terletak di hadapannya dengan tenang yang nyaris mengejek. Naya mencoba mengingat pesan ibunya: jangan takut pada pintu, takutlah pada orang yang menyuruhmu tidak bertanya. Tetapi pesan itu dulu hanya terdengar seperti nasihat untuk anak kecil yang sering kehilangan sandal di masjid. Sekarang, di usia yang memaksa dirinya terlihat dewasa, kalimat itu berubah menjadi pisau. Ia berdiri terlalu lama, sampai suara sandal dari arah belakang membuat tengkuknya menegang.",
      "Arman mengakui ia dipaksa pergi demi keselamatan Naya. Kalimat itu datang tidak selalu dengan teriakan; justru semakin pelan diucapkan, semakin jelas ancamannya. Naya tahu ada orang-orang yang menguasai tempat ini bukan karena mereka benar, melainkan karena semua orang sudah terbiasa menunduk. Ia menatap wajah Arman, mencari celah yang bisa dibaca, tetapi yang ia temukan hanya kegelisahan yang disembunyikan di balik sikap biasa. Di pesantren, kebohongan tidak memakai pakaian hitam. Ia memakai senyum ustazah, kitab yang ditutup mendadak, dan aturan yang baru disebut setelah seseorang hampir menemukan jawaban.",
      "Naya menuntut kenapa ayahnya tidak melawan lebih cepat. Bantuan itu kecil, hampir tidak pantas disebut pertolongan, namun bagi Naya yang mulai kehabisan tempat berpijak, hal kecil bisa terasa seperti tangan di tepi sumur. Ia menyimpan napas, mendengar bunyi malam, dan membiarkan dirinya membaca ulang semua kejadian sejak pulang. Kenapa semua orang tahu nama ibunya, tetapi tidak seorang pun berani mengucapkannya dengan wajar? Kenapa setiap arsip tentang Laila selalu punya bekas sobekan? Hafiz pernah berkata bahwa beberapa keluarga tidak runtuh karena miskin, melainkan karena terlalu lama menyimpan malu milik orang lain.",
      "Petunjuk tentang lembar perjanjian yang disimpan di botol obat membuat Naya sadar bahwa misteri ini tidak berdiri sendiri. Ada tanah wakaf, nama anak-anak yang dipindahkan, para pengurus yang takut kehilangan muka, dan keluarga yang dibiarkan patah agar bangunan pesantren tetap terlihat kokoh. Ia ingat tiga jalan yang sejak awal membayanginya: menggali sendiri sampai kebenaran telanjang, patuh sebentar untuk memancing pengakuan, atau keluar dari pagar agar bukti tidak ikut dikubur. Pilihan itu tidak pernah benar-benar bersih. Jalan pertama bisa menghancurkan orang yang masih ingin ia percaya. Jalan kedua bisa menjadikannya alat para pembohong. Jalan ketiga bisa membuatnya kehilangan akses pada semua pintu yang baru mulai terbuka. Namun diam jelas bukan pilihan; diam adalah bahasa yang selama ini dipakai untuk mengubur Laila.",
      "Ketika Naya menyentuh bukti itu, rindu yang tertunda terasa lebih pahit dari benci. Dadanya terasa seperti dipenuhi air yang tidak menemukan jalan keluar. Ia marah pada ibunya karena meninggalkan teka-teki, marah pada ayah yang entah hidup atau mati, marah pada Marwah yang selalu berbicara seolah luka orang lain adalah urusan administrasi. Tetapi paling dalam, Naya marah pada dirinya sendiri karena masih ingin seseorang berkata bahwa semua ini salah paham. Anak yang kehilangan ibu kadang tidak mencari kebenaran dulu; ia mencari satu orang dewasa yang bersedia mengaku telah gagal melindunginya.",
      "Dialog yang terjadi setelah itu pendek, tetapi menancap. 'Kamu tidak paham akibatnya,' kata suara yang menahan panik. Naya menjawab pelan, 'Mungkin. Tapi kalian terlalu lama memakai kata akibat untuk menutup kata dosa.' Ruangan mendadak sempit. Arman memalingkan muka, seolah kalimat itu mengenai bagian dirinya yang paling ia sembunyikan. Di luar, suara santri mengaji terdengar jauh, bersih, hampir tidak cocok dengan kebusukan yang pelan-pelan muncul di balik dinding. Naya mendadak paham mengapa ibunya dulu selalu memilih duduk di belakang, dekat pintu keluar.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Makin malam, tekanan makin rapi. Ada yang mengunci pintu, ada yang memindahkan map, ada yang mengirim pesan tanpa nama. Naya mulai membedakan takut yang melumpuhkan dan takut yang memberi tenaga. Ia mencatat urutan kejadian dalam kepala: siapa datang lebih dulu, siapa terlalu cepat tahu, siapa pura-pura kaget, siapa menyebut nama Laila dengan suara seperti meminta ampun. Jika suatu hari ia harus berdiri di depan semua orang, ia tidak boleh hanya membawa tangis. Ia harus membawa urutan, tanggal, suara, dan bukti yang tidak bisa dipelintir menjadi cerita anak durhaka.",
      "Menjelang akhir babak itu, suara motor Jamal berhenti di depan rumah. Naya tidak langsung bergerak. Tubuhnya ingin lari, tetapi sesuatu di dalam dirinya justru menjadi tenang, seperti orang yang akhirnya melihat bentuk musuh setelah lama dipukul dari gelap. Ia menggenggam bukti yang tersisa, menatap lorong, lalu berbisik pada nama ibunya tanpa suara. Besok mereka mungkin menuduhnya. Besok ia mungkin terusir. Besok orang-orang yang terlihat saleh bisa menunjukkan wajah asli. Namun malam ini satu hal pasti: pintu yang pernah ditutup untuk Laila mulai terbuka untuk Naya."
    ],
    "wordCount": 881,
    "sceneCount": 4,
    "reveals": [],
    "newNamedCharacters": [],
    "proposedStateDelta": {
      "chapter17_progress": true,
      "tension": true
    },
    "dialogue": [
      {
        "characterId": "char:naya",
        "text": "Aku tidak pulang untuk jadi anak baik di depan kebohongan."
      },
      {
        "characterId": "char:arman",
        "text": "Kalau kamu terus membuka pintu itu, tidak semua orang bisa diselamatkan."
      }
    ],
    "emotionBeats": [
      {
        "characterId": "char:naya",
        "targetCharacterId": "char:arman",
        "valence": "cold"
      }
    ]
  },
  {
    "chapterNumber": 18,
    "title": "Broker Tanah dari Kota",
    "phase": "ACT_3_KELUARGA_YANG_DIPISAHKAN",
    "chapterGoal": "Menggerakkan konflik Bilik Ketujuh melalui map penawaran tanah dari Jamal dan tekanan utama: Jamal menawarkan uang agar Naya pergi dari desa.",
    "mandatoryBeats": [
      "map penawaran tanah dari Jamal",
      "Jamal menawarkan uang agar Naya pergi dari desa",
      "Marwah tidak membantah saat Jamal menyebut dewan wakaf",
      "Jamal menyebut peti wakaf yang hanya bisa dibuka kunci hitam"
    ],
    "cast": [
      "char:naya",
      "char:jamal",
      "char:ustazah-marwah"
    ],
    "threadIds": [
      "thread:kunci-wakaf"
    ],
    "paragraphs": [
      "Teras rumah wakaf yang retak tidak pernah terasa benar bagi Naya. Setiap sudutnya seperti menyimpan napas orang yang menunggu dipanggil, sementara map penawaran tanah dari Jamal terletak di hadapannya dengan tenang yang nyaris mengejek. Naya mencoba mengingat pesan ibunya: jangan takut pada pintu, takutlah pada orang yang menyuruhmu tidak bertanya. Tetapi pesan itu dulu hanya terdengar seperti nasihat untuk anak kecil yang sering kehilangan sandal di masjid. Sekarang, di usia yang memaksa dirinya terlihat dewasa, kalimat itu berubah menjadi pisau. Ia berdiri terlalu lama, sampai suara sandal dari arah belakang membuat tengkuknya menegang.",
      "Jamal menawarkan uang agar Naya pergi dari desa. Kalimat itu datang tidak selalu dengan teriakan; justru semakin pelan diucapkan, semakin jelas ancamannya. Naya tahu ada orang-orang yang menguasai tempat ini bukan karena mereka benar, melainkan karena semua orang sudah terbiasa menunduk. Ia menatap wajah Jamal, mencari celah yang bisa dibaca, tetapi yang ia temukan hanya kegelisahan yang disembunyikan di balik sikap biasa. Di pesantren, kebohongan tidak memakai pakaian hitam. Ia memakai senyum ustazah, kitab yang ditutup mendadak, dan aturan yang baru disebut setelah seseorang hampir menemukan jawaban.",
      "Marwah tidak membantah saat Jamal menyebut dewan wakaf. Bantuan itu kecil, hampir tidak pantas disebut pertolongan, namun bagi Naya yang mulai kehabisan tempat berpijak, hal kecil bisa terasa seperti tangan di tepi sumur. Ia menyimpan napas, mendengar bunyi malam, dan membiarkan dirinya membaca ulang semua kejadian sejak pulang. Kenapa semua orang tahu nama ibunya, tetapi tidak seorang pun berani mengucapkannya dengan wajar? Kenapa setiap arsip tentang Laila selalu punya bekas sobekan? Marwah pernah berkata bahwa beberapa keluarga tidak runtuh karena miskin, melainkan karena terlalu lama menyimpan malu milik orang lain.",
      "Petunjuk tentang map penawaran tanah dari Jamal membuat Naya sadar bahwa misteri ini tidak berdiri sendiri. Ada tanah wakaf, nama anak-anak yang dipindahkan, para pengurus yang takut kehilangan muka, dan keluarga yang dibiarkan patah agar bangunan pesantren tetap terlihat kokoh. Ia ingat tiga jalan yang sejak awal membayanginya: menggali sendiri sampai kebenaran telanjang, patuh sebentar untuk memancing pengakuan, atau keluar dari pagar agar bukti tidak ikut dikubur. Pilihan itu tidak pernah benar-benar bersih. Jalan pertama bisa menghancurkan orang yang masih ingin ia percaya. Jalan kedua bisa menjadikannya alat para pembohong. Jalan ketiga bisa membuatnya kehilangan akses pada semua pintu yang baru mulai terbuka. Namun diam jelas bukan pilihan; diam adalah bahasa yang selama ini dipakai untuk mengubur Laila.",
      "Ketika Naya menyentuh bukti itu, harga diri Naya diinjak dengan angka yang dingin. Dadanya terasa seperti dipenuhi air yang tidak menemukan jalan keluar. Ia marah pada ibunya karena meninggalkan teka-teki, marah pada ayah yang entah hidup atau mati, marah pada Marwah yang selalu berbicara seolah luka orang lain adalah urusan administrasi. Tetapi paling dalam, Naya marah pada dirinya sendiri karena masih ingin seseorang berkata bahwa semua ini salah paham. Anak yang kehilangan ibu kadang tidak mencari kebenaran dulu; ia mencari satu orang dewasa yang bersedia mengaku telah gagal melindunginya.",
      "Dialog yang terjadi setelah itu pendek, tetapi menancap. 'Kamu tidak paham akibatnya,' kata suara yang menahan panik. Naya menjawab pelan, 'Mungkin. Tapi kalian terlalu lama memakai kata akibat untuk menutup kata dosa.' Ruangan mendadak sempit. Jamal memalingkan muka, seolah kalimat itu mengenai bagian dirinya yang paling ia sembunyikan. Di luar, suara santri mengaji terdengar jauh, bersih, hampir tidak cocok dengan kebusukan yang pelan-pelan muncul di balik dinding. Naya mendadak paham mengapa ibunya dulu selalu memilih duduk di belakang, dekat pintu keluar.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Makin malam, tekanan makin rapi. Ada yang mengunci pintu, ada yang memindahkan map, ada yang mengirim pesan tanpa nama. Naya mulai membedakan takut yang melumpuhkan dan takut yang memberi tenaga. Ia mencatat urutan kejadian dalam kepala: siapa datang lebih dulu, siapa terlalu cepat tahu, siapa pura-pura kaget, siapa menyebut nama Laila dengan suara seperti meminta ampun. Jika suatu hari ia harus berdiri di depan semua orang, ia tidak boleh hanya membawa tangis. Ia harus membawa urutan, tanggal, suara, dan bukti yang tidak bisa dipelintir menjadi cerita anak durhaka.",
      "Menjelang akhir babak itu, Jamal menyebut peti wakaf yang hanya bisa dibuka kunci hitam. Naya tidak langsung bergerak. Tubuhnya ingin lari, tetapi sesuatu di dalam dirinya justru menjadi tenang, seperti orang yang akhirnya melihat bentuk musuh setelah lama dipukul dari gelap. Ia menggenggam bukti yang tersisa, menatap lorong, lalu berbisik pada nama ibunya tanpa suara. Besok mereka mungkin menuduhnya. Besok ia mungkin terusir. Besok orang-orang yang terlihat saleh bisa menunjukkan wajah asli. Namun malam ini satu hal pasti: pintu yang pernah ditutup untuk Laila mulai terbuka untuk Naya."
    ],
    "wordCount": 880,
    "sceneCount": 4,
    "reveals": [],
    "newNamedCharacters": [
      "char:jamal"
    ],
    "proposedStateDelta": {
      "chapter18_progress": true,
      "tension": true
    },
    "dialogue": [
      {
        "characterId": "char:naya",
        "text": "Aku tidak pulang untuk jadi anak baik di depan kebohongan."
      },
      {
        "characterId": "char:jamal",
        "text": "Kalau kamu terus membuka pintu itu, tidak semua orang bisa diselamatkan."
      }
    ],
    "emotionBeats": [
      {
        "characterId": "char:naya",
        "targetCharacterId": "char:jamal",
        "valence": "cold"
      }
    ]
  },
  {
    "chapterNumber": 19,
    "title": "Fitnah yang Disiapkan",
    "phase": "ACT_3_KELUARGA_YANG_DIPISAHKAN",
    "chapterGoal": "Menggerakkan konflik Bilik Ketujuh melalui selebaran tuduhan bahwa Naya mencuri arsip dan tekanan utama: Kyai Hamid memerintahkan penggeledahan kamar.",
    "mandatoryBeats": [
      "selebaran tuduhan bahwa Naya mencuri arsip",
      "Kyai Hamid memerintahkan penggeledahan kamar",
      "Salma menyembunyikan salinan daftar di bawah mukena",
      "selebaran terakhir memakai tulisan tangan Laila yang dipalsukan"
    ],
    "cast": [
      "char:naya",
      "char:kyai-hamid",
      "char:salma"
    ],
    "threadIds": [
      "thread:kematian-laila",
      "thread:kunci-wakaf"
    ],
    "paragraphs": [
      "Halaman pesantren penuh bisik santri tidak pernah terasa benar bagi Naya. Setiap sudutnya seperti menyimpan napas orang yang menunggu dipanggil, sementara selebaran tuduhan bahwa Naya mencuri arsip terletak di hadapannya dengan tenang yang nyaris mengejek. Naya mencoba mengingat pesan ibunya: jangan takut pada pintu, takutlah pada orang yang menyuruhmu tidak bertanya. Tetapi pesan itu dulu hanya terdengar seperti nasihat untuk anak kecil yang sering kehilangan sandal di masjid. Sekarang, di usia yang memaksa dirinya terlihat dewasa, kalimat itu berubah menjadi pisau. Ia berdiri terlalu lama, sampai suara sandal dari arah belakang membuat tengkuknya menegang.",
      "Kyai Hamid memerintahkan penggeledahan kamar. Kalimat itu datang tidak selalu dengan teriakan; justru semakin pelan diucapkan, semakin jelas ancamannya. Naya tahu ada orang-orang yang menguasai tempat ini bukan karena mereka benar, melainkan karena semua orang sudah terbiasa menunduk. Ia menatap wajah Hamid, mencari celah yang bisa dibaca, tetapi yang ia temukan hanya kegelisahan yang disembunyikan di balik sikap biasa. Di pesantren, kebohongan tidak memakai pakaian hitam. Ia memakai senyum ustazah, kitab yang ditutup mendadak, dan aturan yang baru disebut setelah seseorang hampir menemukan jawaban.",
      "Salma menyembunyikan salinan daftar di bawah mukena. Bantuan itu kecil, hampir tidak pantas disebut pertolongan, namun bagi Naya yang mulai kehabisan tempat berpijak, hal kecil bisa terasa seperti tangan di tepi sumur. Ia menyimpan napas, mendengar bunyi malam, dan membiarkan dirinya membaca ulang semua kejadian sejak pulang. Kenapa semua orang tahu nama ibunya, tetapi tidak seorang pun berani mengucapkannya dengan wajar? Kenapa setiap arsip tentang Laila selalu punya bekas sobekan? Salma pernah berkata bahwa beberapa keluarga tidak runtuh karena miskin, melainkan karena terlalu lama menyimpan malu milik orang lain.",
      "Petunjuk tentang selebaran tuduhan bahwa Naya mencuri arsip membuat Naya sadar bahwa misteri ini tidak berdiri sendiri. Ada tanah wakaf, nama anak-anak yang dipindahkan, para pengurus yang takut kehilangan muka, dan keluarga yang dibiarkan patah agar bangunan pesantren tetap terlihat kokoh. Ia ingat tiga jalan yang sejak awal membayanginya: menggali sendiri sampai kebenaran telanjang, patuh sebentar untuk memancing pengakuan, atau keluar dari pagar agar bukti tidak ikut dikubur. Pilihan itu tidak pernah benar-benar bersih. Jalan pertama bisa menghancurkan orang yang masih ingin ia percaya. Jalan kedua bisa menjadikannya alat para pembohong. Jalan ketiga bisa membuatnya kehilangan akses pada semua pintu yang baru mulai terbuka. Namun diam jelas bukan pilihan; diam adalah bahasa yang selama ini dipakai untuk mengubur Laila.",
      "Ketika Naya menyentuh bukti itu, Naya tahu kebenaran tidak otomatis membuat orang percaya. Dadanya terasa seperti dipenuhi air yang tidak menemukan jalan keluar. Ia marah pada ibunya karena meninggalkan teka-teki, marah pada ayah yang entah hidup atau mati, marah pada Marwah yang selalu berbicara seolah luka orang lain adalah urusan administrasi. Tetapi paling dalam, Naya marah pada dirinya sendiri karena masih ingin seseorang berkata bahwa semua ini salah paham. Anak yang kehilangan ibu kadang tidak mencari kebenaran dulu; ia mencari satu orang dewasa yang bersedia mengaku telah gagal melindunginya.",
      "Dialog yang terjadi setelah itu pendek, tetapi menancap. 'Kamu tidak paham akibatnya,' kata suara yang menahan panik. Naya menjawab pelan, 'Mungkin. Tapi kalian terlalu lama memakai kata akibat untuk menutup kata dosa.' Ruangan mendadak sempit. Hamid memalingkan muka, seolah kalimat itu mengenai bagian dirinya yang paling ia sembunyikan. Di luar, suara santri mengaji terdengar jauh, bersih, hampir tidak cocok dengan kebusukan yang pelan-pelan muncul di balik dinding. Naya mendadak paham mengapa ibunya dulu selalu memilih duduk di belakang, dekat pintu keluar.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Makin malam, tekanan makin rapi. Ada yang mengunci pintu, ada yang memindahkan map, ada yang mengirim pesan tanpa nama. Naya mulai membedakan takut yang melumpuhkan dan takut yang memberi tenaga. Ia mencatat urutan kejadian dalam kepala: siapa datang lebih dulu, siapa terlalu cepat tahu, siapa pura-pura kaget, siapa menyebut nama Laila dengan suara seperti meminta ampun. Jika suatu hari ia harus berdiri di depan semua orang, ia tidak boleh hanya membawa tangis. Ia harus membawa urutan, tanggal, suara, dan bukti yang tidak bisa dipelintir menjadi cerita anak durhaka.",
      "Menjelang akhir babak itu, selebaran terakhir memakai tulisan tangan Laila yang dipalsukan. Naya tidak langsung bergerak. Tubuhnya ingin lari, tetapi sesuatu di dalam dirinya justru menjadi tenang, seperti orang yang akhirnya melihat bentuk musuh setelah lama dipukul dari gelap. Ia menggenggam bukti yang tersisa, menatap lorong, lalu berbisik pada nama ibunya tanpa suara. Besok mereka mungkin menuduhnya. Besok ia mungkin terusir. Besok orang-orang yang terlihat saleh bisa menunjukkan wajah asli. Namun malam ini satu hal pasti: pintu yang pernah ditutup untuk Laila mulai terbuka untuk Naya."
    ],
    "wordCount": 876,
    "sceneCount": 4,
    "reveals": [],
    "newNamedCharacters": [],
    "proposedStateDelta": {
      "chapter19_progress": true,
      "tension": true
    },
    "dialogue": [
      {
        "characterId": "char:naya",
        "text": "Aku tidak pulang untuk jadi anak baik di depan kebohongan."
      },
      {
        "characterId": "char:kyai-hamid",
        "text": "Kalau kamu terus membuka pintu itu, tidak semua orang bisa diselamatkan."
      }
    ],
    "emotionBeats": [
      {
        "characterId": "char:naya",
        "targetCharacterId": "char:kyai-hamid",
        "valence": "cold"
      }
    ]
  },
  {
    "chapterNumber": 20,
    "title": "Sidang Asrama",
    "phase": "ACT_4_WAKAF_DAN_PETI_HITAM",
    "chapterGoal": "Menggerakkan konflik Bilik Ketujuh melalui meja panjang tempat santri diminta bersaksi dan tekanan utama: Marwah menekan Naya agar mengaku salah.",
    "mandatoryBeats": [
      "meja panjang tempat santri diminta bersaksi",
      "Marwah menekan Naya agar mengaku salah",
      "Hafiz membawa saksi kecil yang melihat Jamal malam itu",
      "seorang santri menyebut ada rekaman lama di Bilik Ketujuh"
    ],
    "cast": [
      "char:naya",
      "char:ustazah-marwah",
      "char:hafiz",
      "char:kyai-hamid"
    ],
    "threadIds": [
      "thread:bilik-ketujuh",
      "thread:loyalitas-hafiz"
    ],
    "paragraphs": [
      "Aula besar dengan kipas berderit tidak pernah terasa benar bagi Naya. Setiap sudutnya seperti menyimpan napas orang yang menunggu dipanggil, sementara meja panjang tempat santri diminta bersaksi terletak di hadapannya dengan tenang yang nyaris mengejek. Naya mencoba mengingat pesan ibunya: jangan takut pada pintu, takutlah pada orang yang menyuruhmu tidak bertanya. Tetapi pesan itu dulu hanya terdengar seperti nasihat untuk anak kecil yang sering kehilangan sandal di masjid. Sekarang, di usia yang memaksa dirinya terlihat dewasa, kalimat itu berubah menjadi pisau. Ia berdiri terlalu lama, sampai suara sandal dari arah belakang membuat tengkuknya menegang.",
      "Marwah menekan Naya agar mengaku salah. Kalimat itu datang tidak selalu dengan teriakan; justru semakin pelan diucapkan, semakin jelas ancamannya. Naya tahu ada orang-orang yang menguasai tempat ini bukan karena mereka benar, melainkan karena semua orang sudah terbiasa menunduk. Ia menatap wajah Marwah, mencari celah yang bisa dibaca, tetapi yang ia temukan hanya kegelisahan yang disembunyikan di balik sikap biasa. Di pesantren, kebohongan tidak memakai pakaian hitam. Ia memakai senyum ustazah, kitab yang ditutup mendadak, dan aturan yang baru disebut setelah seseorang hampir menemukan jawaban.",
      "Hafiz membawa saksi kecil yang melihat Jamal malam itu. Bantuan itu kecil, hampir tidak pantas disebut pertolongan, namun bagi Naya yang mulai kehabisan tempat berpijak, hal kecil bisa terasa seperti tangan di tepi sumur. Ia menyimpan napas, mendengar bunyi malam, dan membiarkan dirinya membaca ulang semua kejadian sejak pulang. Kenapa semua orang tahu nama ibunya, tetapi tidak seorang pun berani mengucapkannya dengan wajar? Kenapa setiap arsip tentang Laila selalu punya bekas sobekan? Hafiz pernah berkata bahwa beberapa keluarga tidak runtuh karena miskin, melainkan karena terlalu lama menyimpan malu milik orang lain.",
      "Petunjuk tentang meja panjang tempat santri diminta bersaksi membuat Naya sadar bahwa misteri ini tidak berdiri sendiri. Ada tanah wakaf, nama anak-anak yang dipindahkan, para pengurus yang takut kehilangan muka, dan keluarga yang dibiarkan patah agar bangunan pesantren tetap terlihat kokoh. Ia ingat tiga jalan yang sejak awal membayanginya: menggali sendiri sampai kebenaran telanjang, patuh sebentar untuk memancing pengakuan, atau keluar dari pagar agar bukti tidak ikut dikubur. Pilihan itu tidak pernah benar-benar bersih. Jalan pertama bisa menghancurkan orang yang masih ingin ia percaya. Jalan kedua bisa menjadikannya alat para pembohong. Jalan ketiga bisa membuatnya kehilangan akses pada semua pintu yang baru mulai terbuka. Namun diam jelas bukan pilihan; diam adalah bahasa yang selama ini dipakai untuk mengubur Laila.",
      "Ketika Naya menyentuh bukti itu, rasa takut berubah menjadi kemarahan terbuka. Dadanya terasa seperti dipenuhi air yang tidak menemukan jalan keluar. Ia marah pada ibunya karena meninggalkan teka-teki, marah pada ayah yang entah hidup atau mati, marah pada Marwah yang selalu berbicara seolah luka orang lain adalah urusan administrasi. Tetapi paling dalam, Naya marah pada dirinya sendiri karena masih ingin seseorang berkata bahwa semua ini salah paham. Anak yang kehilangan ibu kadang tidak mencari kebenaran dulu; ia mencari satu orang dewasa yang bersedia mengaku telah gagal melindunginya.",
      "Dialog yang terjadi setelah itu pendek, tetapi menancap. 'Kamu tidak paham akibatnya,' kata suara yang menahan panik. Naya menjawab pelan, 'Mungkin. Tapi kalian terlalu lama memakai kata akibat untuk menutup kata dosa.' Ruangan mendadak sempit. Marwah memalingkan muka, seolah kalimat itu mengenai bagian dirinya yang paling ia sembunyikan. Di luar, suara santri mengaji terdengar jauh, bersih, hampir tidak cocok dengan kebusukan yang pelan-pelan muncul di balik dinding. Naya mendadak paham mengapa ibunya dulu selalu memilih duduk di belakang, dekat pintu keluar.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Makin malam, tekanan makin rapi. Ada yang mengunci pintu, ada yang memindahkan map, ada yang mengirim pesan tanpa nama. Naya mulai membedakan takut yang melumpuhkan dan takut yang memberi tenaga. Ia mencatat urutan kejadian dalam kepala: siapa datang lebih dulu, siapa terlalu cepat tahu, siapa pura-pura kaget, siapa menyebut nama Laila dengan suara seperti meminta ampun. Jika suatu hari ia harus berdiri di depan semua orang, ia tidak boleh hanya membawa tangis. Ia harus membawa urutan, tanggal, suara, dan bukti yang tidak bisa dipelintir menjadi cerita anak durhaka.",
      "Menjelang akhir babak itu, seorang santri menyebut ada rekaman lama di Bilik Ketujuh. Naya tidak langsung bergerak. Tubuhnya ingin lari, tetapi sesuatu di dalam dirinya justru menjadi tenang, seperti orang yang akhirnya melihat bentuk musuh setelah lama dipukul dari gelap. Ia menggenggam bukti yang tersisa, menatap lorong, lalu berbisik pada nama ibunya tanpa suara. Besok mereka mungkin menuduhnya. Besok ia mungkin terusir. Besok orang-orang yang terlihat saleh bisa menunjukkan wajah asli. Namun malam ini satu hal pasti: pintu yang pernah ditutup untuk Laila mulai terbuka untuk Naya."
    ],
    "wordCount": 878,
    "sceneCount": 4,
    "reveals": [],
    "newNamedCharacters": [],
    "proposedStateDelta": {
      "chapter20_progress": true,
      "tension": true
    },
    "dialogue": [
      {
        "characterId": "char:naya",
        "text": "Aku tidak pulang untuk jadi anak baik di depan kebohongan."
      },
      {
        "characterId": "char:ustazah-marwah",
        "text": "Kalau kamu terus membuka pintu itu, tidak semua orang bisa diselamatkan."
      }
    ],
    "emotionBeats": [
      {
        "characterId": "char:naya",
        "targetCharacterId": "char:ustazah-marwah",
        "valence": "cold"
      }
    ]
  },
  {
    "chapterNumber": 21,
    "title": "Darah yang Disembunyikan Marwah",
    "phase": "ACT_4_WAKAF_DAN_PETI_HITAM",
    "chapterGoal": "Menggerakkan konflik Bilik Ketujuh melalui akta keluarga yang menyebut Marwah saudari tiri Laila dan tekanan utama: Marwah mengaku membenci sekaligus iri pada Laila.",
    "mandatoryBeats": [
      "akta keluarga yang menyebut Marwah saudari tiri Laila",
      "Marwah mengaku membenci sekaligus iri pada Laila",
      "Arman meminta Naya tidak membiarkan kebencian diwariskan",
      "Marwah berkata ia tahu siapa yang mengunci Laila malam itu"
    ],
    "cast": [
      "char:naya",
      "char:ustazah-marwah",
      "char:arman"
    ],
    "threadIds": [
      "thread:kematian-laila",
      "thread:keluarga-naya"
    ],
    "paragraphs": [
      "Ruang tamu pengasuh selepas sidang tidak pernah terasa benar bagi Naya. Setiap sudutnya seperti menyimpan napas orang yang menunggu dipanggil, sementara akta keluarga yang menyebut Marwah saudari tiri Laila terletak di hadapannya dengan tenang yang nyaris mengejek. Naya mencoba mengingat pesan ibunya: jangan takut pada pintu, takutlah pada orang yang menyuruhmu tidak bertanya. Tetapi pesan itu dulu hanya terdengar seperti nasihat untuk anak kecil yang sering kehilangan sandal di masjid. Sekarang, di usia yang memaksa dirinya terlihat dewasa, kalimat itu berubah menjadi pisau. Ia berdiri terlalu lama, sampai suara sandal dari arah belakang membuat tengkuknya menegang.",
      "Marwah mengaku membenci sekaligus iri pada Laila. Kalimat itu datang tidak selalu dengan teriakan; justru semakin pelan diucapkan, semakin jelas ancamannya. Naya tahu ada orang-orang yang menguasai tempat ini bukan karena mereka benar, melainkan karena semua orang sudah terbiasa menunduk. Ia menatap wajah Marwah, mencari celah yang bisa dibaca, tetapi yang ia temukan hanya kegelisahan yang disembunyikan di balik sikap biasa. Di pesantren, kebohongan tidak memakai pakaian hitam. Ia memakai senyum ustazah, kitab yang ditutup mendadak, dan aturan yang baru disebut setelah seseorang hampir menemukan jawaban.",
      "Arman meminta Naya tidak membiarkan kebencian diwariskan. Bantuan itu kecil, hampir tidak pantas disebut pertolongan, namun bagi Naya yang mulai kehabisan tempat berpijak, hal kecil bisa terasa seperti tangan di tepi sumur. Ia menyimpan napas, mendengar bunyi malam, dan membiarkan dirinya membaca ulang semua kejadian sejak pulang. Kenapa semua orang tahu nama ibunya, tetapi tidak seorang pun berani mengucapkannya dengan wajar? Kenapa setiap arsip tentang Laila selalu punya bekas sobekan? Arman pernah berkata bahwa beberapa keluarga tidak runtuh karena miskin, melainkan karena terlalu lama menyimpan malu milik orang lain.",
      "Petunjuk tentang akta keluarga yang menyebut Marwah saudari tiri Laila membuat Naya sadar bahwa misteri ini tidak berdiri sendiri. Ada tanah wakaf, nama anak-anak yang dipindahkan, para pengurus yang takut kehilangan muka, dan keluarga yang dibiarkan patah agar bangunan pesantren tetap terlihat kokoh. Ia ingat tiga jalan yang sejak awal membayanginya: menggali sendiri sampai kebenaran telanjang, patuh sebentar untuk memancing pengakuan, atau keluar dari pagar agar bukti tidak ikut dikubur. Pilihan itu tidak pernah benar-benar bersih. Jalan pertama bisa menghancurkan orang yang masih ingin ia percaya. Jalan kedua bisa menjadikannya alat para pembohong. Jalan ketiga bisa membuatnya kehilangan akses pada semua pintu yang baru mulai terbuka. Namun diam jelas bukan pilihan; diam adalah bahasa yang selama ini dipakai untuk mengubur Laila.",
      "Ketika Naya menyentuh bukti itu, Naya merasa musuhnya tiba-tiba menjadi manusia yang rusak. Dadanya terasa seperti dipenuhi air yang tidak menemukan jalan keluar. Ia marah pada ibunya karena meninggalkan teka-teki, marah pada ayah yang entah hidup atau mati, marah pada Marwah yang selalu berbicara seolah luka orang lain adalah urusan administrasi. Tetapi paling dalam, Naya marah pada dirinya sendiri karena masih ingin seseorang berkata bahwa semua ini salah paham. Anak yang kehilangan ibu kadang tidak mencari kebenaran dulu; ia mencari satu orang dewasa yang bersedia mengaku telah gagal melindunginya.",
      "Dialog yang terjadi setelah itu pendek, tetapi menancap. 'Kamu tidak paham akibatnya,' kata suara yang menahan panik. Naya menjawab pelan, 'Mungkin. Tapi kalian terlalu lama memakai kata akibat untuk menutup kata dosa.' Ruangan mendadak sempit. Marwah memalingkan muka, seolah kalimat itu mengenai bagian dirinya yang paling ia sembunyikan. Di luar, suara santri mengaji terdengar jauh, bersih, hampir tidak cocok dengan kebusukan yang pelan-pelan muncul di balik dinding. Naya mendadak paham mengapa ibunya dulu selalu memilih duduk di belakang, dekat pintu keluar.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Makin malam, tekanan makin rapi. Ada yang mengunci pintu, ada yang memindahkan map, ada yang mengirim pesan tanpa nama. Naya mulai membedakan takut yang melumpuhkan dan takut yang memberi tenaga. Ia mencatat urutan kejadian dalam kepala: siapa datang lebih dulu, siapa terlalu cepat tahu, siapa pura-pura kaget, siapa menyebut nama Laila dengan suara seperti meminta ampun. Jika suatu hari ia harus berdiri di depan semua orang, ia tidak boleh hanya membawa tangis. Ia harus membawa urutan, tanggal, suara, dan bukti yang tidak bisa dipelintir menjadi cerita anak durhaka. Yang terbuka bukan sekadar petunjuk, melainkan rahasia yang mengubah cara Naya membaca semua babak sebelumnya.",
      "Menjelang akhir babak itu, Marwah berkata ia tahu siapa yang mengunci Laila malam itu. Naya tidak langsung bergerak. Tubuhnya ingin lari, tetapi sesuatu di dalam dirinya justru menjadi tenang, seperti orang yang akhirnya melihat bentuk musuh setelah lama dipukul dari gelap. Ia menggenggam bukti yang tersisa, menatap lorong, lalu berbisik pada nama ibunya tanpa suara. Besok mereka mungkin menuduhnya. Besok ia mungkin terusir. Besok orang-orang yang terlihat saleh bisa menunjukkan wajah asli. Namun malam ini satu hal pasti: pintu yang pernah ditutup untuk Laila mulai terbuka untuk Naya."
    ],
    "wordCount": 826,
    "sceneCount": 4,
    "reveals": [
      "secret:marwah-saudari-laila"
    ],
    "newNamedCharacters": [],
    "proposedStateDelta": {
      "chapter21_progress": true,
      "tension": true,
      "revealed_marwah_saudari_laila": true
    },
    "dialogue": [
      {
        "characterId": "char:naya",
        "text": "Aku tidak pulang untuk jadi anak baik di depan kebohongan."
      },
      {
        "characterId": "char:ustazah-marwah",
        "text": "Kalau kamu terus membuka pintu itu, tidak semua orang bisa diselamatkan."
      }
    ],
    "emotionBeats": [
      {
        "characterId": "char:naya",
        "targetCharacterId": "char:ustazah-marwah",
        "valence": "cold"
      }
    ]
  },
  {
    "chapterNumber": 22,
    "title": "Naya Dikeluarkan Sementara",
    "phase": "ACT_4_WAKAF_DAN_PETI_HITAM",
    "chapterGoal": "Menggerakkan konflik Bilik Ketujuh melalui surat skorsing tanpa kop resmi dan tekanan utama: Kyai Hamid menyuruh Naya pergi sebelum tamu wakaf datang.",
    "mandatoryBeats": [
      "surat skorsing tanpa kop resmi",
      "Kyai Hamid menyuruh Naya pergi sebelum tamu wakaf datang",
      "Salma menangis tetapi menyelipkan kunci motor",
      "di luar gerbang ada anak kecil membawa map bertanda tujuh"
    ],
    "cast": [
      "char:naya",
      "char:kyai-hamid",
      "char:salma"
    ],
    "threadIds": [
      "thread:bilik-ketujuh",
      "thread:kunci-wakaf"
    ],
    "paragraphs": [
      "Teras depan pesantren saat fajar tidak pernah terasa benar bagi Naya. Setiap sudutnya seperti menyimpan napas orang yang menunggu dipanggil, sementara surat skorsing tanpa kop resmi terletak di hadapannya dengan tenang yang nyaris mengejek. Naya mencoba mengingat pesan ibunya: jangan takut pada pintu, takutlah pada orang yang menyuruhmu tidak bertanya. Tetapi pesan itu dulu hanya terdengar seperti nasihat untuk anak kecil yang sering kehilangan sandal di masjid. Sekarang, di usia yang memaksa dirinya terlihat dewasa, kalimat itu berubah menjadi pisau. Ia berdiri terlalu lama, sampai suara sandal dari arah belakang membuat tengkuknya menegang.",
      "Kyai Hamid menyuruh Naya pergi sebelum tamu wakaf datang. Kalimat itu datang tidak selalu dengan teriakan; justru semakin pelan diucapkan, semakin jelas ancamannya. Naya tahu ada orang-orang yang menguasai tempat ini bukan karena mereka benar, melainkan karena semua orang sudah terbiasa menunduk. Ia menatap wajah Hamid, mencari celah yang bisa dibaca, tetapi yang ia temukan hanya kegelisahan yang disembunyikan di balik sikap biasa. Di pesantren, kebohongan tidak memakai pakaian hitam. Ia memakai senyum ustazah, kitab yang ditutup mendadak, dan aturan yang baru disebut setelah seseorang hampir menemukan jawaban.",
      "Salma menangis tetapi menyelipkan kunci motor. Bantuan itu kecil, hampir tidak pantas disebut pertolongan, namun bagi Naya yang mulai kehabisan tempat berpijak, hal kecil bisa terasa seperti tangan di tepi sumur. Ia menyimpan napas, mendengar bunyi malam, dan membiarkan dirinya membaca ulang semua kejadian sejak pulang. Kenapa semua orang tahu nama ibunya, tetapi tidak seorang pun berani mengucapkannya dengan wajar? Kenapa setiap arsip tentang Laila selalu punya bekas sobekan? Salma pernah berkata bahwa beberapa keluarga tidak runtuh karena miskin, melainkan karena terlalu lama menyimpan malu milik orang lain.",
      "Petunjuk tentang surat skorsing tanpa kop resmi membuat Naya sadar bahwa misteri ini tidak berdiri sendiri. Ada tanah wakaf, nama anak-anak yang dipindahkan, para pengurus yang takut kehilangan muka, dan keluarga yang dibiarkan patah agar bangunan pesantren tetap terlihat kokoh. Ia ingat tiga jalan yang sejak awal membayanginya: menggali sendiri sampai kebenaran telanjang, patuh sebentar untuk memancing pengakuan, atau keluar dari pagar agar bukti tidak ikut dikubur. Pilihan itu tidak pernah benar-benar bersih. Jalan pertama bisa menghancurkan orang yang masih ingin ia percaya. Jalan kedua bisa menjadikannya alat para pembohong. Jalan ketiga bisa membuatnya kehilangan akses pada semua pintu yang baru mulai terbuka. Namun diam jelas bukan pilihan; diam adalah bahasa yang selama ini dipakai untuk mengubur Laila.",
      "Ketika Naya menyentuh bukti itu, Naya belajar bahwa terusir tidak sama dengan kalah. Dadanya terasa seperti dipenuhi air yang tidak menemukan jalan keluar. Ia marah pada ibunya karena meninggalkan teka-teki, marah pada ayah yang entah hidup atau mati, marah pada Marwah yang selalu berbicara seolah luka orang lain adalah urusan administrasi. Tetapi paling dalam, Naya marah pada dirinya sendiri karena masih ingin seseorang berkata bahwa semua ini salah paham. Anak yang kehilangan ibu kadang tidak mencari kebenaran dulu; ia mencari satu orang dewasa yang bersedia mengaku telah gagal melindunginya.",
      "Dialog yang terjadi setelah itu pendek, tetapi menancap. 'Kamu tidak paham akibatnya,' kata suara yang menahan panik. Naya menjawab pelan, 'Mungkin. Tapi kalian terlalu lama memakai kata akibat untuk menutup kata dosa.' Ruangan mendadak sempit. Hamid memalingkan muka, seolah kalimat itu mengenai bagian dirinya yang paling ia sembunyikan. Di luar, suara santri mengaji terdengar jauh, bersih, hampir tidak cocok dengan kebusukan yang pelan-pelan muncul di balik dinding. Naya mendadak paham mengapa ibunya dulu selalu memilih duduk di belakang, dekat pintu keluar.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Makin malam, tekanan makin rapi. Ada yang mengunci pintu, ada yang memindahkan map, ada yang mengirim pesan tanpa nama. Naya mulai membedakan takut yang melumpuhkan dan takut yang memberi tenaga. Ia mencatat urutan kejadian dalam kepala: siapa datang lebih dulu, siapa terlalu cepat tahu, siapa pura-pura kaget, siapa menyebut nama Laila dengan suara seperti meminta ampun. Jika suatu hari ia harus berdiri di depan semua orang, ia tidak boleh hanya membawa tangis. Ia harus membawa urutan, tanggal, suara, dan bukti yang tidak bisa dipelintir menjadi cerita anak durhaka.",
      "Menjelang akhir babak itu, di luar gerbang ada anak kecil membawa map bertanda tujuh. Naya tidak langsung bergerak. Tubuhnya ingin lari, tetapi sesuatu di dalam dirinya justru menjadi tenang, seperti orang yang akhirnya melihat bentuk musuh setelah lama dipukul dari gelap. Ia menggenggam bukti yang tersisa, menatap lorong, lalu berbisik pada nama ibunya tanpa suara. Besok mereka mungkin menuduhnya. Besok ia mungkin terusir. Besok orang-orang yang terlihat saleh bisa menunjukkan wajah asli. Namun malam ini satu hal pasti: pintu yang pernah ditutup untuk Laila mulai terbuka untuk Naya."
    ],
    "wordCount": 879,
    "sceneCount": 4,
    "reveals": [],
    "newNamedCharacters": [],
    "proposedStateDelta": {
      "chapter22_progress": true,
      "tension": true
    },
    "dialogue": [
      {
        "characterId": "char:naya",
        "text": "Aku tidak pulang untuk jadi anak baik di depan kebohongan."
      },
      {
        "characterId": "char:kyai-hamid",
        "text": "Kalau kamu terus membuka pintu itu, tidak semua orang bisa diselamatkan."
      }
    ],
    "emotionBeats": [
      {
        "characterId": "char:naya",
        "targetCharacterId": "char:kyai-hamid",
        "valence": "cold"
      }
    ]
  },
  {
    "chapterNumber": 23,
    "title": "Rumah Wakaf di Ujung Desa",
    "phase": "ACT_4_WAKAF_DAN_PETI_HITAM",
    "chapterGoal": "Menggerakkan konflik Bilik Ketujuh melalui papan nama pendiri yang dicabut paksa dan tekanan utama: Hafiz memperingatkan Naya bahwa Jamal punya orang di desa.",
    "mandatoryBeats": [
      "papan nama pendiri yang dicabut paksa",
      "Hafiz memperingatkan Naya bahwa Jamal punya orang di desa",
      "Arman membuka lantai kayu dengan tangan gemetar",
      "di bawah lantai ada denah peti tua"
    ],
    "cast": [
      "char:naya",
      "char:hafiz",
      "char:arman"
    ],
    "threadIds": [
      "thread:kunci-wakaf",
      "thread:keluarga-naya"
    ],
    "paragraphs": [
      "Rumah wakaf yang hampir roboh tidak pernah terasa benar bagi Naya. Setiap sudutnya seperti menyimpan napas orang yang menunggu dipanggil, sementara papan nama pendiri yang dicabut paksa terletak di hadapannya dengan tenang yang nyaris mengejek. Naya mencoba mengingat pesan ibunya: jangan takut pada pintu, takutlah pada orang yang menyuruhmu tidak bertanya. Tetapi pesan itu dulu hanya terdengar seperti nasihat untuk anak kecil yang sering kehilangan sandal di masjid. Sekarang, di usia yang memaksa dirinya terlihat dewasa, kalimat itu berubah menjadi pisau. Ia berdiri terlalu lama, sampai suara sandal dari arah belakang membuat tengkuknya menegang.",
      "Hafiz memperingatkan Naya bahwa Jamal punya orang di desa. Kalimat itu datang tidak selalu dengan teriakan; justru semakin pelan diucapkan, semakin jelas ancamannya. Naya tahu ada orang-orang yang menguasai tempat ini bukan karena mereka benar, melainkan karena semua orang sudah terbiasa menunduk. Ia menatap wajah Hafiz, mencari celah yang bisa dibaca, tetapi yang ia temukan hanya kegelisahan yang disembunyikan di balik sikap biasa. Di pesantren, kebohongan tidak memakai pakaian hitam. Ia memakai senyum ustazah, kitab yang ditutup mendadak, dan aturan yang baru disebut setelah seseorang hampir menemukan jawaban.",
      "Arman membuka lantai kayu dengan tangan gemetar. Bantuan itu kecil, hampir tidak pantas disebut pertolongan, namun bagi Naya yang mulai kehabisan tempat berpijak, hal kecil bisa terasa seperti tangan di tepi sumur. Ia menyimpan napas, mendengar bunyi malam, dan membiarkan dirinya membaca ulang semua kejadian sejak pulang. Kenapa semua orang tahu nama ibunya, tetapi tidak seorang pun berani mengucapkannya dengan wajar? Kenapa setiap arsip tentang Laila selalu punya bekas sobekan? Arman pernah berkata bahwa beberapa keluarga tidak runtuh karena miskin, melainkan karena terlalu lama menyimpan malu milik orang lain.",
      "Petunjuk tentang papan nama pendiri yang dicabut paksa membuat Naya sadar bahwa misteri ini tidak berdiri sendiri. Ada tanah wakaf, nama anak-anak yang dipindahkan, para pengurus yang takut kehilangan muka, dan keluarga yang dibiarkan patah agar bangunan pesantren tetap terlihat kokoh. Ia ingat tiga jalan yang sejak awal membayanginya: menggali sendiri sampai kebenaran telanjang, patuh sebentar untuk memancing pengakuan, atau keluar dari pagar agar bukti tidak ikut dikubur. Pilihan itu tidak pernah benar-benar bersih. Jalan pertama bisa menghancurkan orang yang masih ingin ia percaya. Jalan kedua bisa menjadikannya alat para pembohong. Jalan ketiga bisa membuatnya kehilangan akses pada semua pintu yang baru mulai terbuka. Namun diam jelas bukan pilihan; diam adalah bahasa yang selama ini dipakai untuk mengubur Laila.",
      "Ketika Naya menyentuh bukti itu, Naya melihat masa depan pesantren dipertaruhkan di rumah reyot. Dadanya terasa seperti dipenuhi air yang tidak menemukan jalan keluar. Ia marah pada ibunya karena meninggalkan teka-teki, marah pada ayah yang entah hidup atau mati, marah pada Marwah yang selalu berbicara seolah luka orang lain adalah urusan administrasi. Tetapi paling dalam, Naya marah pada dirinya sendiri karena masih ingin seseorang berkata bahwa semua ini salah paham. Anak yang kehilangan ibu kadang tidak mencari kebenaran dulu; ia mencari satu orang dewasa yang bersedia mengaku telah gagal melindunginya.",
      "Dialog yang terjadi setelah itu pendek, tetapi menancap. 'Kamu tidak paham akibatnya,' kata suara yang menahan panik. Naya menjawab pelan, 'Mungkin. Tapi kalian terlalu lama memakai kata akibat untuk menutup kata dosa.' Ruangan mendadak sempit. Hafiz memalingkan muka, seolah kalimat itu mengenai bagian dirinya yang paling ia sembunyikan. Di luar, suara santri mengaji terdengar jauh, bersih, hampir tidak cocok dengan kebusukan yang pelan-pelan muncul di balik dinding. Naya mendadak paham mengapa ibunya dulu selalu memilih duduk di belakang, dekat pintu keluar.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Makin malam, tekanan makin rapi. Ada yang mengunci pintu, ada yang memindahkan map, ada yang mengirim pesan tanpa nama. Naya mulai membedakan takut yang melumpuhkan dan takut yang memberi tenaga. Ia mencatat urutan kejadian dalam kepala: siapa datang lebih dulu, siapa terlalu cepat tahu, siapa pura-pura kaget, siapa menyebut nama Laila dengan suara seperti meminta ampun. Jika suatu hari ia harus berdiri di depan semua orang, ia tidak boleh hanya membawa tangis. Ia harus membawa urutan, tanggal, suara, dan bukti yang tidak bisa dipelintir menjadi cerita anak durhaka.",
      "Menjelang akhir babak itu, di bawah lantai ada denah peti tua. Naya tidak langsung bergerak. Tubuhnya ingin lari, tetapi sesuatu di dalam dirinya justru menjadi tenang, seperti orang yang akhirnya melihat bentuk musuh setelah lama dipukul dari gelap. Ia menggenggam bukti yang tersisa, menatap lorong, lalu berbisik pada nama ibunya tanpa suara. Besok mereka mungkin menuduhnya. Besok ia mungkin terusir. Besok orang-orang yang terlihat saleh bisa menunjukkan wajah asli. Namun malam ini satu hal pasti: pintu yang pernah ditutup untuk Laila mulai terbuka untuk Naya."
    ],
    "wordCount": 880,
    "sceneCount": 4,
    "reveals": [],
    "newNamedCharacters": [],
    "proposedStateDelta": {
      "chapter23_progress": true,
      "tension": true
    },
    "dialogue": [
      {
        "characterId": "char:naya",
        "text": "Aku tidak pulang untuk jadi anak baik di depan kebohongan."
      },
      {
        "characterId": "char:hafiz",
        "text": "Kalau kamu terus membuka pintu itu, tidak semua orang bisa diselamatkan."
      }
    ],
    "emotionBeats": [
      {
        "characterId": "char:naya",
        "targetCharacterId": "char:hafiz",
        "valence": "cold"
      }
    ]
  },
  {
    "chapterNumber": 24,
    "title": "Peti Wakaf dan Kunci Hitam",
    "phase": "ACT_4_WAKAF_DAN_PETI_HITAM",
    "chapterGoal": "Menggerakkan konflik Bilik Ketujuh melalui peti besi yang terbuka oleh kunci hitam dan tekanan utama: Jamal datang membawa orang sebelum isi peti dipindahkan.",
    "mandatoryBeats": [
      "peti besi yang terbuka oleh kunci hitam",
      "Jamal datang membawa orang sebelum isi peti dipindahkan",
      "Marwah menahan Jamal dengan membaca surat pendiri",
      "di dasar peti ada kaset kecil berlabel malam terakhir"
    ],
    "cast": [
      "char:naya",
      "char:jamal",
      "char:ustazah-marwah",
      "char:arman"
    ],
    "threadIds": [
      "thread:kunci-wakaf",
      "thread:bilik-ketujuh"
    ],
    "paragraphs": [
      "Ruang bawah rumah wakaf tidak pernah terasa benar bagi Naya. Setiap sudutnya seperti menyimpan napas orang yang menunggu dipanggil, sementara peti besi yang terbuka oleh kunci hitam terletak di hadapannya dengan tenang yang nyaris mengejek. Naya mencoba mengingat pesan ibunya: jangan takut pada pintu, takutlah pada orang yang menyuruhmu tidak bertanya. Tetapi pesan itu dulu hanya terdengar seperti nasihat untuk anak kecil yang sering kehilangan sandal di masjid. Sekarang, di usia yang memaksa dirinya terlihat dewasa, kalimat itu berubah menjadi pisau. Ia berdiri terlalu lama, sampai suara sandal dari arah belakang membuat tengkuknya menegang.",
      "Jamal datang membawa orang sebelum isi peti dipindahkan. Kalimat itu datang tidak selalu dengan teriakan; justru semakin pelan diucapkan, semakin jelas ancamannya. Naya tahu ada orang-orang yang menguasai tempat ini bukan karena mereka benar, melainkan karena semua orang sudah terbiasa menunduk. Ia menatap wajah Jamal, mencari celah yang bisa dibaca, tetapi yang ia temukan hanya kegelisahan yang disembunyikan di balik sikap biasa. Di pesantren, kebohongan tidak memakai pakaian hitam. Ia memakai senyum ustazah, kitab yang ditutup mendadak, dan aturan yang baru disebut setelah seseorang hampir menemukan jawaban.",
      "Marwah menahan Jamal dengan membaca surat pendiri. Bantuan itu kecil, hampir tidak pantas disebut pertolongan, namun bagi Naya yang mulai kehabisan tempat berpijak, hal kecil bisa terasa seperti tangan di tepi sumur. Ia menyimpan napas, mendengar bunyi malam, dan membiarkan dirinya membaca ulang semua kejadian sejak pulang. Kenapa semua orang tahu nama ibunya, tetapi tidak seorang pun berani mengucapkannya dengan wajar? Kenapa setiap arsip tentang Laila selalu punya bekas sobekan? Marwah pernah berkata bahwa beberapa keluarga tidak runtuh karena miskin, melainkan karena terlalu lama menyimpan malu milik orang lain.",
      "Petunjuk tentang peti besi yang terbuka oleh kunci hitam membuat Naya sadar bahwa misteri ini tidak berdiri sendiri. Ada tanah wakaf, nama anak-anak yang dipindahkan, para pengurus yang takut kehilangan muka, dan keluarga yang dibiarkan patah agar bangunan pesantren tetap terlihat kokoh. Ia ingat tiga jalan yang sejak awal membayanginya: menggali sendiri sampai kebenaran telanjang, patuh sebentar untuk memancing pengakuan, atau keluar dari pagar agar bukti tidak ikut dikubur. Pilihan itu tidak pernah benar-benar bersih. Jalan pertama bisa menghancurkan orang yang masih ingin ia percaya. Jalan kedua bisa menjadikannya alat para pembohong. Jalan ketiga bisa membuatnya kehilangan akses pada semua pintu yang baru mulai terbuka. Namun diam jelas bukan pilihan; diam adalah bahasa yang selama ini dipakai untuk mengubur Laila.",
      "Ketika Naya menyentuh bukti itu, Naya menemukan bukti bahwa ibunya mati menjaga tanah santri. Dadanya terasa seperti dipenuhi air yang tidak menemukan jalan keluar. Ia marah pada ibunya karena meninggalkan teka-teki, marah pada ayah yang entah hidup atau mati, marah pada Marwah yang selalu berbicara seolah luka orang lain adalah urusan administrasi. Tetapi paling dalam, Naya marah pada dirinya sendiri karena masih ingin seseorang berkata bahwa semua ini salah paham. Anak yang kehilangan ibu kadang tidak mencari kebenaran dulu; ia mencari satu orang dewasa yang bersedia mengaku telah gagal melindunginya.",
      "Dialog yang terjadi setelah itu pendek, tetapi menancap. 'Kamu tidak paham akibatnya,' kata suara yang menahan panik. Naya menjawab pelan, 'Mungkin. Tapi kalian terlalu lama memakai kata akibat untuk menutup kata dosa.' Ruangan mendadak sempit. Jamal memalingkan muka, seolah kalimat itu mengenai bagian dirinya yang paling ia sembunyikan. Di luar, suara santri mengaji terdengar jauh, bersih, hampir tidak cocok dengan kebusukan yang pelan-pelan muncul di balik dinding. Naya mendadak paham mengapa ibunya dulu selalu memilih duduk di belakang, dekat pintu keluar.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Makin malam, tekanan makin rapi. Ada yang mengunci pintu, ada yang memindahkan map, ada yang mengirim pesan tanpa nama. Naya mulai membedakan takut yang melumpuhkan dan takut yang memberi tenaga. Ia mencatat urutan kejadian dalam kepala: siapa datang lebih dulu, siapa terlalu cepat tahu, siapa pura-pura kaget, siapa menyebut nama Laila dengan suara seperti meminta ampun. Jika suatu hari ia harus berdiri di depan semua orang, ia tidak boleh hanya membawa tangis. Ia harus membawa urutan, tanggal, suara, dan bukti yang tidak bisa dipelintir menjadi cerita anak durhaka. Yang terbuka bukan sekadar petunjuk, melainkan rahasia yang mengubah cara Naya membaca semua babak sebelumnya.",
      "Menjelang akhir babak itu, di dasar peti ada kaset kecil berlabel malam terakhir. Naya tidak langsung bergerak. Tubuhnya ingin lari, tetapi sesuatu di dalam dirinya justru menjadi tenang, seperti orang yang akhirnya melihat bentuk musuh setelah lama dipukul dari gelap. Ia menggenggam bukti yang tersisa, menatap lorong, lalu berbisik pada nama ibunya tanpa suara. Besok mereka mungkin menuduhnya. Besok ia mungkin terusir. Besok orang-orang yang terlihat saleh bisa menunjukkan wajah asli. Namun malam ini satu hal pasti: pintu yang pernah ditutup untuk Laila mulai terbuka untuk Naya."
    ],
    "wordCount": 824,
    "sceneCount": 4,
    "reveals": [
      "secret:kunci-peti-wakaf"
    ],
    "newNamedCharacters": [],
    "proposedStateDelta": {
      "chapter24_progress": true,
      "tension": true,
      "revealed_kunci_peti_wakaf": true
    },
    "dialogue": [
      {
        "characterId": "char:naya",
        "text": "Aku tidak pulang untuk jadi anak baik di depan kebohongan."
      },
      {
        "characterId": "char:jamal",
        "text": "Kalau kamu terus membuka pintu itu, tidak semua orang bisa diselamatkan."
      }
    ],
    "emotionBeats": [
      {
        "characterId": "char:naya",
        "targetCharacterId": "char:jamal",
        "valence": "cold"
      }
    ]
  },
  {
    "chapterNumber": 25,
    "title": "Perjanjian Pendiri",
    "phase": "ACT_4_WAKAF_DAN_PETI_HITAM",
    "chapterGoal": "Menggerakkan konflik Bilik Ketujuh melalui naskah wakaf yang ditulis tangan dan tekanan utama: Kyai Hamid mengaku takut pesantren bubar bila skandal dibuka.",
    "mandatoryBeats": [
      "naskah wakaf yang ditulis tangan",
      "Kyai Hamid mengaku takut pesantren bubar bila skandal dibuka",
      "Rukmini menunjukkan stempel asli yang ia sembunyikan",
      "naskah itu menyebut semua arsip harus dibuka di hadapan publik"
    ],
    "cast": [
      "char:naya",
      "char:kyai-hamid",
      "char:bu-rukmini"
    ],
    "threadIds": [
      "thread:kunci-wakaf"
    ],
    "paragraphs": [
      "Masjid tua peninggalan pendiri tidak pernah terasa benar bagi Naya. Setiap sudutnya seperti menyimpan napas orang yang menunggu dipanggil, sementara naskah wakaf yang ditulis tangan terletak di hadapannya dengan tenang yang nyaris mengejek. Naya mencoba mengingat pesan ibunya: jangan takut pada pintu, takutlah pada orang yang menyuruhmu tidak bertanya. Tetapi pesan itu dulu hanya terdengar seperti nasihat untuk anak kecil yang sering kehilangan sandal di masjid. Sekarang, di usia yang memaksa dirinya terlihat dewasa, kalimat itu berubah menjadi pisau. Ia berdiri terlalu lama, sampai suara sandal dari arah belakang membuat tengkuknya menegang.",
      "Kyai Hamid mengaku takut pesantren bubar bila skandal dibuka. Kalimat itu datang tidak selalu dengan teriakan; justru semakin pelan diucapkan, semakin jelas ancamannya. Naya tahu ada orang-orang yang menguasai tempat ini bukan karena mereka benar, melainkan karena semua orang sudah terbiasa menunduk. Ia menatap wajah Hamid, mencari celah yang bisa dibaca, tetapi yang ia temukan hanya kegelisahan yang disembunyikan di balik sikap biasa. Di pesantren, kebohongan tidak memakai pakaian hitam. Ia memakai senyum ustazah, kitab yang ditutup mendadak, dan aturan yang baru disebut setelah seseorang hampir menemukan jawaban.",
      "Rukmini menunjukkan stempel asli yang ia sembunyikan. Bantuan itu kecil, hampir tidak pantas disebut pertolongan, namun bagi Naya yang mulai kehabisan tempat berpijak, hal kecil bisa terasa seperti tangan di tepi sumur. Ia menyimpan napas, mendengar bunyi malam, dan membiarkan dirinya membaca ulang semua kejadian sejak pulang. Kenapa semua orang tahu nama ibunya, tetapi tidak seorang pun berani mengucapkannya dengan wajar? Kenapa setiap arsip tentang Laila selalu punya bekas sobekan? Rukmini pernah berkata bahwa beberapa keluarga tidak runtuh karena miskin, melainkan karena terlalu lama menyimpan malu milik orang lain.",
      "Petunjuk tentang naskah wakaf yang ditulis tangan membuat Naya sadar bahwa misteri ini tidak berdiri sendiri. Ada tanah wakaf, nama anak-anak yang dipindahkan, para pengurus yang takut kehilangan muka, dan keluarga yang dibiarkan patah agar bangunan pesantren tetap terlihat kokoh. Ia ingat tiga jalan yang sejak awal membayanginya: menggali sendiri sampai kebenaran telanjang, patuh sebentar untuk memancing pengakuan, atau keluar dari pagar agar bukti tidak ikut dikubur. Pilihan itu tidak pernah benar-benar bersih. Jalan pertama bisa menghancurkan orang yang masih ingin ia percaya. Jalan kedua bisa menjadikannya alat para pembohong. Jalan ketiga bisa membuatnya kehilangan akses pada semua pintu yang baru mulai terbuka. Namun diam jelas bukan pilihan; diam adalah bahasa yang selama ini dipakai untuk mengubur Laila.",
      "Ketika Naya menyentuh bukti itu, Naya mulai melihat beda antara dosa dan alasan. Dadanya terasa seperti dipenuhi air yang tidak menemukan jalan keluar. Ia marah pada ibunya karena meninggalkan teka-teki, marah pada ayah yang entah hidup atau mati, marah pada Marwah yang selalu berbicara seolah luka orang lain adalah urusan administrasi. Tetapi paling dalam, Naya marah pada dirinya sendiri karena masih ingin seseorang berkata bahwa semua ini salah paham. Anak yang kehilangan ibu kadang tidak mencari kebenaran dulu; ia mencari satu orang dewasa yang bersedia mengaku telah gagal melindunginya.",
      "Dialog yang terjadi setelah itu pendek, tetapi menancap. 'Kamu tidak paham akibatnya,' kata suara yang menahan panik. Naya menjawab pelan, 'Mungkin. Tapi kalian terlalu lama memakai kata akibat untuk menutup kata dosa.' Ruangan mendadak sempit. Hamid memalingkan muka, seolah kalimat itu mengenai bagian dirinya yang paling ia sembunyikan. Di luar, suara santri mengaji terdengar jauh, bersih, hampir tidak cocok dengan kebusukan yang pelan-pelan muncul di balik dinding. Naya mendadak paham mengapa ibunya dulu selalu memilih duduk di belakang, dekat pintu keluar.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Makin malam, tekanan makin rapi. Ada yang mengunci pintu, ada yang memindahkan map, ada yang mengirim pesan tanpa nama. Naya mulai membedakan takut yang melumpuhkan dan takut yang memberi tenaga. Ia mencatat urutan kejadian dalam kepala: siapa datang lebih dulu, siapa terlalu cepat tahu, siapa pura-pura kaget, siapa menyebut nama Laila dengan suara seperti meminta ampun. Jika suatu hari ia harus berdiri di depan semua orang, ia tidak boleh hanya membawa tangis. Ia harus membawa urutan, tanggal, suara, dan bukti yang tidak bisa dipelintir menjadi cerita anak durhaka.",
      "Menjelang akhir babak itu, naskah itu menyebut semua arsip harus dibuka di hadapan publik. Naya tidak langsung bergerak. Tubuhnya ingin lari, tetapi sesuatu di dalam dirinya justru menjadi tenang, seperti orang yang akhirnya melihat bentuk musuh setelah lama dipukul dari gelap. Ia menggenggam bukti yang tersisa, menatap lorong, lalu berbisik pada nama ibunya tanpa suara. Besok mereka mungkin menuduhnya. Besok ia mungkin terusir. Besok orang-orang yang terlihat saleh bisa menunjukkan wajah asli. Namun malam ini satu hal pasti: pintu yang pernah ditutup untuk Laila mulai terbuka untuk Naya."
    ],
    "wordCount": 879,
    "sceneCount": 4,
    "reveals": [],
    "newNamedCharacters": [],
    "proposedStateDelta": {
      "chapter25_progress": true,
      "tension": true
    },
    "dialogue": [
      {
        "characterId": "char:naya",
        "text": "Aku tidak pulang untuk jadi anak baik di depan kebohongan."
      },
      {
        "characterId": "char:kyai-hamid",
        "text": "Kalau kamu terus membuka pintu itu, tidak semua orang bisa diselamatkan."
      }
    ],
    "emotionBeats": [
      {
        "characterId": "char:naya",
        "targetCharacterId": "char:kyai-hamid",
        "valence": "cold"
      }
    ]
  },
  {
    "chapterNumber": 26,
    "title": "Nadine Membawa Kamera",
    "phase": "ACT_5_BUKTI_DARI_LUAR",
    "chapterGoal": "Menggerakkan konflik Bilik Ketujuh melalui kamera kecil milik reporter alumni Nadine dan tekanan utama: Nadine menolak menulis tanpa bukti berlapis.",
    "mandatoryBeats": [
      "kamera kecil milik reporter alumni Nadine",
      "Nadine menolak menulis tanpa bukti berlapis",
      "Hafiz menyerahkan salinan foto tiga bayangan",
      "Nadine mengenali Jamal dari kasus wakaf di kota lain"
    ],
    "cast": [
      "char:naya",
      "char:nadine",
      "char:hafiz"
    ],
    "threadIds": [
      "thread:kunci-wakaf",
      "thread:kematian-laila"
    ],
    "paragraphs": [
      "Warung kopi dekat terminal desa tidak pernah terasa benar bagi Naya. Setiap sudutnya seperti menyimpan napas orang yang menunggu dipanggil, sementara kamera kecil milik reporter alumni Nadine terletak di hadapannya dengan tenang yang nyaris mengejek. Naya mencoba mengingat pesan ibunya: jangan takut pada pintu, takutlah pada orang yang menyuruhmu tidak bertanya. Tetapi pesan itu dulu hanya terdengar seperti nasihat untuk anak kecil yang sering kehilangan sandal di masjid. Sekarang, di usia yang memaksa dirinya terlihat dewasa, kalimat itu berubah menjadi pisau. Ia berdiri terlalu lama, sampai suara sandal dari arah belakang membuat tengkuknya menegang.",
      "Nadine menolak menulis tanpa bukti berlapis. Kalimat itu datang tidak selalu dengan teriakan; justru semakin pelan diucapkan, semakin jelas ancamannya. Naya tahu ada orang-orang yang menguasai tempat ini bukan karena mereka benar, melainkan karena semua orang sudah terbiasa menunduk. Ia menatap wajah Nadine, mencari celah yang bisa dibaca, tetapi yang ia temukan hanya kegelisahan yang disembunyikan di balik sikap biasa. Di pesantren, kebohongan tidak memakai pakaian hitam. Ia memakai senyum ustazah, kitab yang ditutup mendadak, dan aturan yang baru disebut setelah seseorang hampir menemukan jawaban.",
      "Hafiz menyerahkan salinan foto tiga bayangan. Bantuan itu kecil, hampir tidak pantas disebut pertolongan, namun bagi Naya yang mulai kehabisan tempat berpijak, hal kecil bisa terasa seperti tangan di tepi sumur. Ia menyimpan napas, mendengar bunyi malam, dan membiarkan dirinya membaca ulang semua kejadian sejak pulang. Kenapa semua orang tahu nama ibunya, tetapi tidak seorang pun berani mengucapkannya dengan wajar? Kenapa setiap arsip tentang Laila selalu punya bekas sobekan? Hafiz pernah berkata bahwa beberapa keluarga tidak runtuh karena miskin, melainkan karena terlalu lama menyimpan malu milik orang lain.",
      "Petunjuk tentang kamera kecil milik reporter alumni Nadine membuat Naya sadar bahwa misteri ini tidak berdiri sendiri. Ada tanah wakaf, nama anak-anak yang dipindahkan, para pengurus yang takut kehilangan muka, dan keluarga yang dibiarkan patah agar bangunan pesantren tetap terlihat kokoh. Ia ingat tiga jalan yang sejak awal membayanginya: menggali sendiri sampai kebenaran telanjang, patuh sebentar untuk memancing pengakuan, atau keluar dari pagar agar bukti tidak ikut dikubur. Pilihan itu tidak pernah benar-benar bersih. Jalan pertama bisa menghancurkan orang yang masih ingin ia percaya. Jalan kedua bisa menjadikannya alat para pembohong. Jalan ketiga bisa membuatnya kehilangan akses pada semua pintu yang baru mulai terbuka. Namun diam jelas bukan pilihan; diam adalah bahasa yang selama ini dipakai untuk mengubur Laila.",
      "Ketika Naya menyentuh bukti itu, Naya sadar kebenaran butuh saksi di luar lingkaran pesantren. Dadanya terasa seperti dipenuhi air yang tidak menemukan jalan keluar. Ia marah pada ibunya karena meninggalkan teka-teki, marah pada ayah yang entah hidup atau mati, marah pada Marwah yang selalu berbicara seolah luka orang lain adalah urusan administrasi. Tetapi paling dalam, Naya marah pada dirinya sendiri karena masih ingin seseorang berkata bahwa semua ini salah paham. Anak yang kehilangan ibu kadang tidak mencari kebenaran dulu; ia mencari satu orang dewasa yang bersedia mengaku telah gagal melindunginya.",
      "Dialog yang terjadi setelah itu pendek, tetapi menancap. 'Kamu tidak paham akibatnya,' kata suara yang menahan panik. Naya menjawab pelan, 'Mungkin. Tapi kalian terlalu lama memakai kata akibat untuk menutup kata dosa.' Ruangan mendadak sempit. Nadine memalingkan muka, seolah kalimat itu mengenai bagian dirinya yang paling ia sembunyikan. Di luar, suara santri mengaji terdengar jauh, bersih, hampir tidak cocok dengan kebusukan yang pelan-pelan muncul di balik dinding. Naya mendadak paham mengapa ibunya dulu selalu memilih duduk di belakang, dekat pintu keluar.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Makin malam, tekanan makin rapi. Ada yang mengunci pintu, ada yang memindahkan map, ada yang mengirim pesan tanpa nama. Naya mulai membedakan takut yang melumpuhkan dan takut yang memberi tenaga. Ia mencatat urutan kejadian dalam kepala: siapa datang lebih dulu, siapa terlalu cepat tahu, siapa pura-pura kaget, siapa menyebut nama Laila dengan suara seperti meminta ampun. Jika suatu hari ia harus berdiri di depan semua orang, ia tidak boleh hanya membawa tangis. Ia harus membawa urutan, tanggal, suara, dan bukti yang tidak bisa dipelintir menjadi cerita anak durhaka.",
      "Menjelang akhir babak itu, Nadine mengenali Jamal dari kasus wakaf di kota lain. Naya tidak langsung bergerak. Tubuhnya ingin lari, tetapi sesuatu di dalam dirinya justru menjadi tenang, seperti orang yang akhirnya melihat bentuk musuh setelah lama dipukul dari gelap. Ia menggenggam bukti yang tersisa, menatap lorong, lalu berbisik pada nama ibunya tanpa suara. Besok mereka mungkin menuduhnya. Besok ia mungkin terusir. Besok orang-orang yang terlihat saleh bisa menunjukkan wajah asli. Namun malam ini satu hal pasti: pintu yang pernah ditutup untuk Laila mulai terbuka untuk Naya."
    ],
    "wordCount": 878,
    "sceneCount": 4,
    "reveals": [],
    "newNamedCharacters": [
      "char:nadine"
    ],
    "proposedStateDelta": {
      "chapter26_progress": true,
      "tension": true
    },
    "dialogue": [
      {
        "characterId": "char:naya",
        "text": "Aku tidak pulang untuk jadi anak baik di depan kebohongan."
      },
      {
        "characterId": "char:nadine",
        "text": "Kalau kamu terus membuka pintu itu, tidak semua orang bisa diselamatkan."
      }
    ],
    "emotionBeats": [
      {
        "characterId": "char:naya",
        "targetCharacterId": "char:nadine",
        "valence": "cold"
      }
    ]
  },
  {
    "chapterNumber": 27,
    "title": "Artikel yang Hampir Terbit",
    "phase": "ACT_5_BUKTI_DARI_LUAR",
    "chapterGoal": "Menggerakkan konflik Bilik Ketujuh melalui draft artikel tentang jaringan wakaf palsu dan tekanan utama: Jamal mengancam Nadine lewat pesan suara.",
    "mandatoryBeats": [
      "draft artikel tentang jaringan wakaf palsu",
      "Jamal mengancam Nadine lewat pesan suara",
      "Salma mengirim rekaman bisik santri ke ponsel Naya",
      "listrik kamar padam tepat saat artikel diunggah"
    ],
    "cast": [
      "char:naya",
      "char:nadine",
      "char:salma",
      "char:jamal"
    ],
    "threadIds": [
      "thread:kunci-wakaf"
    ],
    "paragraphs": [
      "Kamar kos nadine di kota kecil tidak pernah terasa benar bagi Naya. Setiap sudutnya seperti menyimpan napas orang yang menunggu dipanggil, sementara draft artikel tentang jaringan wakaf palsu terletak di hadapannya dengan tenang yang nyaris mengejek. Naya mencoba mengingat pesan ibunya: jangan takut pada pintu, takutlah pada orang yang menyuruhmu tidak bertanya. Tetapi pesan itu dulu hanya terdengar seperti nasihat untuk anak kecil yang sering kehilangan sandal di masjid. Sekarang, di usia yang memaksa dirinya terlihat dewasa, kalimat itu berubah menjadi pisau. Ia berdiri terlalu lama, sampai suara sandal dari arah belakang membuat tengkuknya menegang.",
      "Jamal mengancam Nadine lewat pesan suara. Kalimat itu datang tidak selalu dengan teriakan; justru semakin pelan diucapkan, semakin jelas ancamannya. Naya tahu ada orang-orang yang menguasai tempat ini bukan karena mereka benar, melainkan karena semua orang sudah terbiasa menunduk. Ia menatap wajah Nadine, mencari celah yang bisa dibaca, tetapi yang ia temukan hanya kegelisahan yang disembunyikan di balik sikap biasa. Di pesantren, kebohongan tidak memakai pakaian hitam. Ia memakai senyum ustazah, kitab yang ditutup mendadak, dan aturan yang baru disebut setelah seseorang hampir menemukan jawaban.",
      "Salma mengirim rekaman bisik santri ke ponsel Naya. Bantuan itu kecil, hampir tidak pantas disebut pertolongan, namun bagi Naya yang mulai kehabisan tempat berpijak, hal kecil bisa terasa seperti tangan di tepi sumur. Ia menyimpan napas, mendengar bunyi malam, dan membiarkan dirinya membaca ulang semua kejadian sejak pulang. Kenapa semua orang tahu nama ibunya, tetapi tidak seorang pun berani mengucapkannya dengan wajar? Kenapa setiap arsip tentang Laila selalu punya bekas sobekan? Salma pernah berkata bahwa beberapa keluarga tidak runtuh karena miskin, melainkan karena terlalu lama menyimpan malu milik orang lain.",
      "Petunjuk tentang draft artikel tentang jaringan wakaf palsu membuat Naya sadar bahwa misteri ini tidak berdiri sendiri. Ada tanah wakaf, nama anak-anak yang dipindahkan, para pengurus yang takut kehilangan muka, dan keluarga yang dibiarkan patah agar bangunan pesantren tetap terlihat kokoh. Ia ingat tiga jalan yang sejak awal membayanginya: menggali sendiri sampai kebenaran telanjang, patuh sebentar untuk memancing pengakuan, atau keluar dari pagar agar bukti tidak ikut dikubur. Pilihan itu tidak pernah benar-benar bersih. Jalan pertama bisa menghancurkan orang yang masih ingin ia percaya. Jalan kedua bisa menjadikannya alat para pembohong. Jalan ketiga bisa membuatnya kehilangan akses pada semua pintu yang baru mulai terbuka. Namun diam jelas bukan pilihan; diam adalah bahasa yang selama ini dipakai untuk mengubur Laila.",
      "Ketika Naya menyentuh bukti itu, rasa bersalah Naya muncul karena orang lain ikut terluka. Dadanya terasa seperti dipenuhi air yang tidak menemukan jalan keluar. Ia marah pada ibunya karena meninggalkan teka-teki, marah pada ayah yang entah hidup atau mati, marah pada Marwah yang selalu berbicara seolah luka orang lain adalah urusan administrasi. Tetapi paling dalam, Naya marah pada dirinya sendiri karena masih ingin seseorang berkata bahwa semua ini salah paham. Anak yang kehilangan ibu kadang tidak mencari kebenaran dulu; ia mencari satu orang dewasa yang bersedia mengaku telah gagal melindunginya.",
      "Dialog yang terjadi setelah itu pendek, tetapi menancap. 'Kamu tidak paham akibatnya,' kata suara yang menahan panik. Naya menjawab pelan, 'Mungkin. Tapi kalian terlalu lama memakai kata akibat untuk menutup kata dosa.' Ruangan mendadak sempit. Nadine memalingkan muka, seolah kalimat itu mengenai bagian dirinya yang paling ia sembunyikan. Di luar, suara santri mengaji terdengar jauh, bersih, hampir tidak cocok dengan kebusukan yang pelan-pelan muncul di balik dinding. Naya mendadak paham mengapa ibunya dulu selalu memilih duduk di belakang, dekat pintu keluar.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Makin malam, tekanan makin rapi. Ada yang mengunci pintu, ada yang memindahkan map, ada yang mengirim pesan tanpa nama. Naya mulai membedakan takut yang melumpuhkan dan takut yang memberi tenaga. Ia mencatat urutan kejadian dalam kepala: siapa datang lebih dulu, siapa terlalu cepat tahu, siapa pura-pura kaget, siapa menyebut nama Laila dengan suara seperti meminta ampun. Jika suatu hari ia harus berdiri di depan semua orang, ia tidak boleh hanya membawa tangis. Ia harus membawa urutan, tanggal, suara, dan bukti yang tidak bisa dipelintir menjadi cerita anak durhaka.",
      "Menjelang akhir babak itu, listrik kamar padam tepat saat artikel diunggah. Naya tidak langsung bergerak. Tubuhnya ingin lari, tetapi sesuatu di dalam dirinya justru menjadi tenang, seperti orang yang akhirnya melihat bentuk musuh setelah lama dipukul dari gelap. Ia menggenggam bukti yang tersisa, menatap lorong, lalu berbisik pada nama ibunya tanpa suara. Besok mereka mungkin menuduhnya. Besok ia mungkin terusir. Besok orang-orang yang terlihat saleh bisa menunjukkan wajah asli. Namun malam ini satu hal pasti: pintu yang pernah ditutup untuk Laila mulai terbuka untuk Naya."
    ],
    "wordCount": 879,
    "sceneCount": 4,
    "reveals": [],
    "newNamedCharacters": [],
    "proposedStateDelta": {
      "chapter27_progress": true,
      "tension": true
    },
    "dialogue": [
      {
        "characterId": "char:naya",
        "text": "Aku tidak pulang untuk jadi anak baik di depan kebohongan."
      },
      {
        "characterId": "char:nadine",
        "text": "Kalau kamu terus membuka pintu itu, tidak semua orang bisa diselamatkan."
      }
    ],
    "emotionBeats": [
      {
        "characterId": "char:naya",
        "targetCharacterId": "char:nadine",
        "valence": "cold"
      }
    ]
  },
  {
    "chapterNumber": 28,
    "title": "Menyusup atau Menyerahkan Bukti",
    "phase": "ACT_5_BUKTI_DARI_LUAR",
    "chapterGoal": "Menggerakkan konflik Bilik Ketujuh melalui flashdisk berisi foto dan daftar nama dan tekanan utama: Marwah meminta bukti diserahkan padanya sebelum dewan datang.",
    "mandatoryBeats": [
      "flashdisk berisi foto dan daftar nama",
      "Marwah meminta bukti diserahkan padanya sebelum dewan datang",
      "Nadine menyarankan siaran langsung bila Naya tidak percaya siapa pun",
      "dari dalam pesantren terdengar suara kaset diputar sebentar lalu mati"
    ],
    "cast": [
      "char:naya",
      "char:ustazah-marwah",
      "char:nadine"
    ],
    "threadIds": [
      "thread:bilik-ketujuh",
      "thread:kunci-wakaf"
    ],
    "paragraphs": [
      "Jalan belakang menuju pesantren tidak pernah terasa benar bagi Naya. Setiap sudutnya seperti menyimpan napas orang yang menunggu dipanggil, sementara flashdisk berisi foto dan daftar nama terletak di hadapannya dengan tenang yang nyaris mengejek. Naya mencoba mengingat pesan ibunya: jangan takut pada pintu, takutlah pada orang yang menyuruhmu tidak bertanya. Tetapi pesan itu dulu hanya terdengar seperti nasihat untuk anak kecil yang sering kehilangan sandal di masjid. Sekarang, di usia yang memaksa dirinya terlihat dewasa, kalimat itu berubah menjadi pisau. Ia berdiri terlalu lama, sampai suara sandal dari arah belakang membuat tengkuknya menegang.",
      "Marwah meminta bukti diserahkan padanya sebelum dewan datang. Kalimat itu datang tidak selalu dengan teriakan; justru semakin pelan diucapkan, semakin jelas ancamannya. Naya tahu ada orang-orang yang menguasai tempat ini bukan karena mereka benar, melainkan karena semua orang sudah terbiasa menunduk. Ia menatap wajah Marwah, mencari celah yang bisa dibaca, tetapi yang ia temukan hanya kegelisahan yang disembunyikan di balik sikap biasa. Di pesantren, kebohongan tidak memakai pakaian hitam. Ia memakai senyum ustazah, kitab yang ditutup mendadak, dan aturan yang baru disebut setelah seseorang hampir menemukan jawaban.",
      "Nadine menyarankan siaran langsung bila Naya tidak percaya siapa pun. Bantuan itu kecil, hampir tidak pantas disebut pertolongan, namun bagi Naya yang mulai kehabisan tempat berpijak, hal kecil bisa terasa seperti tangan di tepi sumur. Ia menyimpan napas, mendengar bunyi malam, dan membiarkan dirinya membaca ulang semua kejadian sejak pulang. Kenapa semua orang tahu nama ibunya, tetapi tidak seorang pun berani mengucapkannya dengan wajar? Kenapa setiap arsip tentang Laila selalu punya bekas sobekan? Nadine pernah berkata bahwa beberapa keluarga tidak runtuh karena miskin, melainkan karena terlalu lama menyimpan malu milik orang lain.",
      "Petunjuk tentang flashdisk berisi foto dan daftar nama membuat Naya sadar bahwa misteri ini tidak berdiri sendiri. Ada tanah wakaf, nama anak-anak yang dipindahkan, para pengurus yang takut kehilangan muka, dan keluarga yang dibiarkan patah agar bangunan pesantren tetap terlihat kokoh. Malam itu cerita memberinya simpang yang tidak sopan: membongkar sekarang, mengikuti aturan yang mungkin busuk, atau menyelamatkan bukti dengan cara yang membuatnya tampak bersalah. Pilihan itu tidak pernah benar-benar bersih. Jalan pertama bisa menghancurkan orang yang masih ingin ia percaya. Jalan kedua bisa menjadikannya alat para pembohong. Jalan ketiga bisa membuatnya kehilangan akses pada semua pintu yang baru mulai terbuka. Namun diam jelas bukan pilihan; diam adalah bahasa yang selama ini dipakai untuk mengubur Laila.",
      "Ketika Naya menyentuh bukti itu, Naya harus memilih antara strategi rapi atau ledakan terbuka. Dadanya terasa seperti dipenuhi air yang tidak menemukan jalan keluar. Ia marah pada ibunya karena meninggalkan teka-teki, marah pada ayah yang entah hidup atau mati, marah pada Marwah yang selalu berbicara seolah luka orang lain adalah urusan administrasi. Tetapi paling dalam, Naya marah pada dirinya sendiri karena masih ingin seseorang berkata bahwa semua ini salah paham. Anak yang kehilangan ibu kadang tidak mencari kebenaran dulu; ia mencari satu orang dewasa yang bersedia mengaku telah gagal melindunginya.",
      "Dialog yang terjadi setelah itu pendek, tetapi menancap. 'Kamu tidak paham akibatnya,' kata suara yang menahan panik. Naya menjawab pelan, 'Mungkin. Tapi kalian terlalu lama memakai kata akibat untuk menutup kata dosa.' Ruangan mendadak sempit. Marwah memalingkan muka, seolah kalimat itu mengenai bagian dirinya yang paling ia sembunyikan. Di luar, suara santri mengaji terdengar jauh, bersih, hampir tidak cocok dengan kebusukan yang pelan-pelan muncul di balik dinding. Naya mendadak paham mengapa ibunya dulu selalu memilih duduk di belakang, dekat pintu keluar.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Makin malam, tekanan makin rapi. Ada yang mengunci pintu, ada yang memindahkan map, ada yang mengirim pesan tanpa nama. Naya mulai membedakan takut yang melumpuhkan dan takut yang memberi tenaga. Ia mencatat urutan kejadian dalam kepala: siapa datang lebih dulu, siapa terlalu cepat tahu, siapa pura-pura kaget, siapa menyebut nama Laila dengan suara seperti meminta ampun. Jika suatu hari ia harus berdiri di depan semua orang, ia tidak boleh hanya membawa tangis. Ia harus membawa urutan, tanggal, suara, dan bukti yang tidak bisa dipelintir menjadi cerita anak durhaka.",
      "Menjelang akhir babak itu, dari dalam pesantren terdengar suara kaset diputar sebentar lalu mati. Naya tidak langsung bergerak. Tubuhnya ingin lari, tetapi sesuatu di dalam dirinya justru menjadi tenang, seperti orang yang akhirnya melihat bentuk musuh setelah lama dipukul dari gelap. Ia menggenggam bukti yang tersisa, menatap lorong, lalu berbisik pada nama ibunya tanpa suara. Besok mereka mungkin menuduhnya. Besok ia mungkin terusir. Besok orang-orang yang terlihat saleh bisa menunjukkan wajah asli. Namun malam ini satu hal pasti: pintu yang pernah ditutup untuk Laila mulai terbuka untuk Naya."
    ],
    "wordCount": 881,
    "sceneCount": 4,
    "reveals": [],
    "newNamedCharacters": [],
    "proposedStateDelta": {
      "chapter28_progress": true,
      "tension": true,
      "choice_chapter_28": true
    },
    "dialogue": [
      {
        "characterId": "char:naya",
        "text": "Aku tidak pulang untuk jadi anak baik di depan kebohongan."
      },
      {
        "characterId": "char:ustazah-marwah",
        "text": "Kalau kamu terus membuka pintu itu, tidak semua orang bisa diselamatkan."
      }
    ],
    "emotionBeats": [
      {
        "characterId": "char:naya",
        "targetCharacterId": "char:ustazah-marwah",
        "valence": "cold"
      }
    ]
  },
  {
    "chapterNumber": 29,
    "title": "Malam Operasi Arsip",
    "phase": "ACT_5_BUKTI_DARI_LUAR",
    "chapterGoal": "Menggerakkan konflik Bilik Ketujuh melalui jendela kecil menuju ruang penyimpanan dan tekanan utama: Hafiz memimpin jalan tetapi tangannya tidak berhenti gemetar.",
    "mandatoryBeats": [
      "jendela kecil menuju ruang penyimpanan",
      "Hafiz memimpin jalan tetapi tangannya tidak berhenti gemetar",
      "Naya menemukan map yang baru saja dikosongkan",
      "di meja arsip tertinggal sehelai rambut Marwah"
    ],
    "cast": [
      "char:naya",
      "char:hafiz",
      "char:ustazah-marwah"
    ],
    "threadIds": [
      "thread:bilik-ketujuh",
      "thread:loyalitas-hafiz"
    ],
    "paragraphs": [
      "Atap aula yang mengarah ke gudang arsip tidak pernah terasa benar bagi Naya. Setiap sudutnya seperti menyimpan napas orang yang menunggu dipanggil, sementara jendela kecil menuju ruang penyimpanan terletak di hadapannya dengan tenang yang nyaris mengejek. Naya mencoba mengingat pesan ibunya: jangan takut pada pintu, takutlah pada orang yang menyuruhmu tidak bertanya. Tetapi pesan itu dulu hanya terdengar seperti nasihat untuk anak kecil yang sering kehilangan sandal di masjid. Sekarang, di usia yang memaksa dirinya terlihat dewasa, kalimat itu berubah menjadi pisau. Ia berdiri terlalu lama, sampai suara sandal dari arah belakang membuat tengkuknya menegang.",
      "Hafiz memimpin jalan tetapi tangannya tidak berhenti gemetar. Kalimat itu datang tidak selalu dengan teriakan; justru semakin pelan diucapkan, semakin jelas ancamannya. Naya tahu ada orang-orang yang menguasai tempat ini bukan karena mereka benar, melainkan karena semua orang sudah terbiasa menunduk. Ia menatap wajah Hafiz, mencari celah yang bisa dibaca, tetapi yang ia temukan hanya kegelisahan yang disembunyikan di balik sikap biasa. Di pesantren, kebohongan tidak memakai pakaian hitam. Ia memakai senyum ustazah, kitab yang ditutup mendadak, dan aturan yang baru disebut setelah seseorang hampir menemukan jawaban.",
      "Naya menemukan map yang baru saja dikosongkan. Bantuan itu kecil, hampir tidak pantas disebut pertolongan, namun bagi Naya yang mulai kehabisan tempat berpijak, hal kecil bisa terasa seperti tangan di tepi sumur. Ia menyimpan napas, mendengar bunyi malam, dan membiarkan dirinya membaca ulang semua kejadian sejak pulang. Kenapa semua orang tahu nama ibunya, tetapi tidak seorang pun berani mengucapkannya dengan wajar? Kenapa setiap arsip tentang Laila selalu punya bekas sobekan? Marwah pernah berkata bahwa beberapa keluarga tidak runtuh karena miskin, melainkan karena terlalu lama menyimpan malu milik orang lain.",
      "Petunjuk tentang jendela kecil menuju ruang penyimpanan membuat Naya sadar bahwa misteri ini tidak berdiri sendiri. Ada tanah wakaf, nama anak-anak yang dipindahkan, para pengurus yang takut kehilangan muka, dan keluarga yang dibiarkan patah agar bangunan pesantren tetap terlihat kokoh. Ia ingat tiga jalan yang sejak awal membayanginya: menggali sendiri sampai kebenaran telanjang, patuh sebentar untuk memancing pengakuan, atau keluar dari pagar agar bukti tidak ikut dikubur. Pilihan itu tidak pernah benar-benar bersih. Jalan pertama bisa menghancurkan orang yang masih ingin ia percaya. Jalan kedua bisa menjadikannya alat para pembohong. Jalan ketiga bisa membuatnya kehilangan akses pada semua pintu yang baru mulai terbuka. Namun diam jelas bukan pilihan; diam adalah bahasa yang selama ini dipakai untuk mengubur Laila.",
      "Ketika Naya menyentuh bukti itu, adrenalin membuat Naya lupa bahwa ia masih anak yang terluka. Dadanya terasa seperti dipenuhi air yang tidak menemukan jalan keluar. Ia marah pada ibunya karena meninggalkan teka-teki, marah pada ayah yang entah hidup atau mati, marah pada Marwah yang selalu berbicara seolah luka orang lain adalah urusan administrasi. Tetapi paling dalam, Naya marah pada dirinya sendiri karena masih ingin seseorang berkata bahwa semua ini salah paham. Anak yang kehilangan ibu kadang tidak mencari kebenaran dulu; ia mencari satu orang dewasa yang bersedia mengaku telah gagal melindunginya.",
      "Dialog yang terjadi setelah itu pendek, tetapi menancap. 'Kamu tidak paham akibatnya,' kata suara yang menahan panik. Naya menjawab pelan, 'Mungkin. Tapi kalian terlalu lama memakai kata akibat untuk menutup kata dosa.' Ruangan mendadak sempit. Hafiz memalingkan muka, seolah kalimat itu mengenai bagian dirinya yang paling ia sembunyikan. Di luar, suara santri mengaji terdengar jauh, bersih, hampir tidak cocok dengan kebusukan yang pelan-pelan muncul di balik dinding. Naya mendadak paham mengapa ibunya dulu selalu memilih duduk di belakang, dekat pintu keluar.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Makin malam, tekanan makin rapi. Ada yang mengunci pintu, ada yang memindahkan map, ada yang mengirim pesan tanpa nama. Naya mulai membedakan takut yang melumpuhkan dan takut yang memberi tenaga. Ia mencatat urutan kejadian dalam kepala: siapa datang lebih dulu, siapa terlalu cepat tahu, siapa pura-pura kaget, siapa menyebut nama Laila dengan suara seperti meminta ampun. Jika suatu hari ia harus berdiri di depan semua orang, ia tidak boleh hanya membawa tangis. Ia harus membawa urutan, tanggal, suara, dan bukti yang tidak bisa dipelintir menjadi cerita anak durhaka.",
      "Menjelang akhir babak itu, di meja arsip tertinggal sehelai rambut Marwah. Naya tidak langsung bergerak. Tubuhnya ingin lari, tetapi sesuatu di dalam dirinya justru menjadi tenang, seperti orang yang akhirnya melihat bentuk musuh setelah lama dipukul dari gelap. Ia menggenggam bukti yang tersisa, menatap lorong, lalu berbisik pada nama ibunya tanpa suara. Besok mereka mungkin menuduhnya. Besok ia mungkin terusir. Besok orang-orang yang terlihat saleh bisa menunjukkan wajah asli. Namun malam ini satu hal pasti: pintu yang pernah ditutup untuk Laila mulai terbuka untuk Naya."
    ],
    "wordCount": 880,
    "sceneCount": 4,
    "reveals": [],
    "newNamedCharacters": [],
    "proposedStateDelta": {
      "chapter29_progress": true,
      "tension": true
    },
    "dialogue": [
      {
        "characterId": "char:naya",
        "text": "Aku tidak pulang untuk jadi anak baik di depan kebohongan."
      },
      {
        "characterId": "char:hafiz",
        "text": "Kalau kamu terus membuka pintu itu, tidak semua orang bisa diselamatkan."
      }
    ],
    "emotionBeats": [
      {
        "characterId": "char:naya",
        "targetCharacterId": "char:hafiz",
        "valence": "cold"
      }
    ]
  },
  {
    "chapterNumber": 30,
    "title": "Kebakaran di Gudang Lama",
    "phase": "ACT_5_BUKTI_DARI_LUAR",
    "chapterGoal": "Menggerakkan konflik Bilik Ketujuh melalui api kecil yang terlalu teratur untuk disebut kecelakaan dan tekanan utama: Kyai Hamid menuduh Naya membawa kekacauan.",
    "mandatoryBeats": [
      "api kecil yang terlalu teratur untuk disebut kecelakaan",
      "Kyai Hamid menuduh Naya membawa kekacauan",
      "Arman menerobos asap mencari sisa kaset",
      "di antara abu muncul logam kecil dari mesin perekam"
    ],
    "cast": [
      "char:naya",
      "char:kyai-hamid",
      "char:arman"
    ],
    "threadIds": [
      "thread:bilik-ketujuh",
      "thread:keluarga-naya"
    ],
    "paragraphs": [
      "Gudang lama di belakang dapur umum tidak pernah terasa benar bagi Naya. Setiap sudutnya seperti menyimpan napas orang yang menunggu dipanggil, sementara api kecil yang terlalu teratur untuk disebut kecelakaan terletak di hadapannya dengan tenang yang nyaris mengejek. Naya mencoba mengingat pesan ibunya: jangan takut pada pintu, takutlah pada orang yang menyuruhmu tidak bertanya. Tetapi pesan itu dulu hanya terdengar seperti nasihat untuk anak kecil yang sering kehilangan sandal di masjid. Sekarang, di usia yang memaksa dirinya terlihat dewasa, kalimat itu berubah menjadi pisau. Ia berdiri terlalu lama, sampai suara sandal dari arah belakang membuat tengkuknya menegang.",
      "Kyai Hamid menuduh Naya membawa kekacauan. Kalimat itu datang tidak selalu dengan teriakan; justru semakin pelan diucapkan, semakin jelas ancamannya. Naya tahu ada orang-orang yang menguasai tempat ini bukan karena mereka benar, melainkan karena semua orang sudah terbiasa menunduk. Ia menatap wajah Hamid, mencari celah yang bisa dibaca, tetapi yang ia temukan hanya kegelisahan yang disembunyikan di balik sikap biasa. Di pesantren, kebohongan tidak memakai pakaian hitam. Ia memakai senyum ustazah, kitab yang ditutup mendadak, dan aturan yang baru disebut setelah seseorang hampir menemukan jawaban.",
      "Arman menerobos asap mencari sisa kaset. Bantuan itu kecil, hampir tidak pantas disebut pertolongan, namun bagi Naya yang mulai kehabisan tempat berpijak, hal kecil bisa terasa seperti tangan di tepi sumur. Ia menyimpan napas, mendengar bunyi malam, dan membiarkan dirinya membaca ulang semua kejadian sejak pulang. Kenapa semua orang tahu nama ibunya, tetapi tidak seorang pun berani mengucapkannya dengan wajar? Kenapa setiap arsip tentang Laila selalu punya bekas sobekan? Arman pernah berkata bahwa beberapa keluarga tidak runtuh karena miskin, melainkan karena terlalu lama menyimpan malu milik orang lain.",
      "Petunjuk tentang api kecil yang terlalu teratur untuk disebut kecelakaan membuat Naya sadar bahwa misteri ini tidak berdiri sendiri. Ada tanah wakaf, nama anak-anak yang dipindahkan, para pengurus yang takut kehilangan muka, dan keluarga yang dibiarkan patah agar bangunan pesantren tetap terlihat kokoh. Ia ingat tiga jalan yang sejak awal membayanginya: menggali sendiri sampai kebenaran telanjang, patuh sebentar untuk memancing pengakuan, atau keluar dari pagar agar bukti tidak ikut dikubur. Pilihan itu tidak pernah benar-benar bersih. Jalan pertama bisa menghancurkan orang yang masih ingin ia percaya. Jalan kedua bisa menjadikannya alat para pembohong. Jalan ketiga bisa membuatnya kehilangan akses pada semua pintu yang baru mulai terbuka. Namun diam jelas bukan pilihan; diam adalah bahasa yang selama ini dipakai untuk mengubur Laila.",
      "Ketika Naya menyentuh bukti itu, Naya hampir kehilangan ayahnya untuk kedua kali. Dadanya terasa seperti dipenuhi air yang tidak menemukan jalan keluar. Ia marah pada ibunya karena meninggalkan teka-teki, marah pada ayah yang entah hidup atau mati, marah pada Marwah yang selalu berbicara seolah luka orang lain adalah urusan administrasi. Tetapi paling dalam, Naya marah pada dirinya sendiri karena masih ingin seseorang berkata bahwa semua ini salah paham. Anak yang kehilangan ibu kadang tidak mencari kebenaran dulu; ia mencari satu orang dewasa yang bersedia mengaku telah gagal melindunginya.",
      "Dialog yang terjadi setelah itu pendek, tetapi menancap. 'Kamu tidak paham akibatnya,' kata suara yang menahan panik. Naya menjawab pelan, 'Mungkin. Tapi kalian terlalu lama memakai kata akibat untuk menutup kata dosa.' Ruangan mendadak sempit. Hamid memalingkan muka, seolah kalimat itu mengenai bagian dirinya yang paling ia sembunyikan. Di luar, suara santri mengaji terdengar jauh, bersih, hampir tidak cocok dengan kebusukan yang pelan-pelan muncul di balik dinding. Naya mendadak paham mengapa ibunya dulu selalu memilih duduk di belakang, dekat pintu keluar.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Makin malam, tekanan makin rapi. Ada yang mengunci pintu, ada yang memindahkan map, ada yang mengirim pesan tanpa nama. Naya mulai membedakan takut yang melumpuhkan dan takut yang memberi tenaga. Ia mencatat urutan kejadian dalam kepala: siapa datang lebih dulu, siapa terlalu cepat tahu, siapa pura-pura kaget, siapa menyebut nama Laila dengan suara seperti meminta ampun. Jika suatu hari ia harus berdiri di depan semua orang, ia tidak boleh hanya membawa tangis. Ia harus membawa urutan, tanggal, suara, dan bukti yang tidak bisa dipelintir menjadi cerita anak durhaka.",
      "Menjelang akhir babak itu, di antara abu muncul logam kecil dari mesin perekam. Naya tidak langsung bergerak. Tubuhnya ingin lari, tetapi sesuatu di dalam dirinya justru menjadi tenang, seperti orang yang akhirnya melihat bentuk musuh setelah lama dipukul dari gelap. Ia menggenggam bukti yang tersisa, menatap lorong, lalu berbisik pada nama ibunya tanpa suara. Besok mereka mungkin menuduhnya. Besok ia mungkin terusir. Besok orang-orang yang terlihat saleh bisa menunjukkan wajah asli. Namun malam ini satu hal pasti: pintu yang pernah ditutup untuk Laila mulai terbuka untuk Naya."
    ],
    "wordCount": 881,
    "sceneCount": 4,
    "reveals": [],
    "newNamedCharacters": [],
    "proposedStateDelta": {
      "chapter30_progress": true,
      "tension": true
    },
    "dialogue": [
      {
        "characterId": "char:naya",
        "text": "Aku tidak pulang untuk jadi anak baik di depan kebohongan."
      },
      {
        "characterId": "char:kyai-hamid",
        "text": "Kalau kamu terus membuka pintu itu, tidak semua orang bisa diselamatkan."
      }
    ],
    "emotionBeats": [
      {
        "characterId": "char:naya",
        "targetCharacterId": "char:kyai-hamid",
        "valence": "cold"
      }
    ]
  },
  {
    "chapterNumber": 31,
    "title": "Santri yang Melihat Semuanya",
    "phase": "ACT_5_BUKTI_DARI_LUAR",
    "chapterGoal": "Menggerakkan konflik Bilik Ketujuh melalui kesaksian santri kecil tentang orang berjas hitam dan tekanan utama: Salma membujuk saksi agar tidak takut pada pengurus.",
    "mandatoryBeats": [
      "kesaksian santri kecil tentang orang berjas hitam",
      "Salma membujuk saksi agar tidak takut pada pengurus",
      "Naya mencatat nama saksi di balik kartu obat",
      "saksi itu menggambar wajah Jamal di sudut buku tulis"
    ],
    "cast": [
      "char:naya",
      "char:salma",
      "char:jamal"
    ],
    "threadIds": [
      "thread:kunci-wakaf"
    ],
    "paragraphs": [
      "Ruang uks sementara setelah kebakaran tidak pernah terasa benar bagi Naya. Setiap sudutnya seperti menyimpan napas orang yang menunggu dipanggil, sementara kesaksian santri kecil tentang orang berjas hitam terletak di hadapannya dengan tenang yang nyaris mengejek. Naya mencoba mengingat pesan ibunya: jangan takut pada pintu, takutlah pada orang yang menyuruhmu tidak bertanya. Tetapi pesan itu dulu hanya terdengar seperti nasihat untuk anak kecil yang sering kehilangan sandal di masjid. Sekarang, di usia yang memaksa dirinya terlihat dewasa, kalimat itu berubah menjadi pisau. Ia berdiri terlalu lama, sampai suara sandal dari arah belakang membuat tengkuknya menegang.",
      "Salma membujuk saksi agar tidak takut pada pengurus. Kalimat itu datang tidak selalu dengan teriakan; justru semakin pelan diucapkan, semakin jelas ancamannya. Naya tahu ada orang-orang yang menguasai tempat ini bukan karena mereka benar, melainkan karena semua orang sudah terbiasa menunduk. Ia menatap wajah Salma, mencari celah yang bisa dibaca, tetapi yang ia temukan hanya kegelisahan yang disembunyikan di balik sikap biasa. Di pesantren, kebohongan tidak memakai pakaian hitam. Ia memakai senyum ustazah, kitab yang ditutup mendadak, dan aturan yang baru disebut setelah seseorang hampir menemukan jawaban.",
      "Naya mencatat nama saksi di balik kartu obat. Bantuan itu kecil, hampir tidak pantas disebut pertolongan, namun bagi Naya yang mulai kehabisan tempat berpijak, hal kecil bisa terasa seperti tangan di tepi sumur. Ia menyimpan napas, mendengar bunyi malam, dan membiarkan dirinya membaca ulang semua kejadian sejak pulang. Kenapa semua orang tahu nama ibunya, tetapi tidak seorang pun berani mengucapkannya dengan wajar? Kenapa setiap arsip tentang Laila selalu punya bekas sobekan? Jamal pernah berkata bahwa beberapa keluarga tidak runtuh karena miskin, melainkan karena terlalu lama menyimpan malu milik orang lain.",
      "Petunjuk tentang kesaksian santri kecil tentang orang berjas hitam membuat Naya sadar bahwa misteri ini tidak berdiri sendiri. Ada tanah wakaf, nama anak-anak yang dipindahkan, para pengurus yang takut kehilangan muka, dan keluarga yang dibiarkan patah agar bangunan pesantren tetap terlihat kokoh. Ia ingat tiga jalan yang sejak awal membayanginya: menggali sendiri sampai kebenaran telanjang, patuh sebentar untuk memancing pengakuan, atau keluar dari pagar agar bukti tidak ikut dikubur. Pilihan itu tidak pernah benar-benar bersih. Jalan pertama bisa menghancurkan orang yang masih ingin ia percaya. Jalan kedua bisa menjadikannya alat para pembohong. Jalan ketiga bisa membuatnya kehilangan akses pada semua pintu yang baru mulai terbuka. Namun diam jelas bukan pilihan; diam adalah bahasa yang selama ini dipakai untuk mengubur Laila.",
      "Ketika Naya menyentuh bukti itu, Naya menyadari keberanian bisa menular lewat hal kecil. Dadanya terasa seperti dipenuhi air yang tidak menemukan jalan keluar. Ia marah pada ibunya karena meninggalkan teka-teki, marah pada ayah yang entah hidup atau mati, marah pada Marwah yang selalu berbicara seolah luka orang lain adalah urusan administrasi. Tetapi paling dalam, Naya marah pada dirinya sendiri karena masih ingin seseorang berkata bahwa semua ini salah paham. Anak yang kehilangan ibu kadang tidak mencari kebenaran dulu; ia mencari satu orang dewasa yang bersedia mengaku telah gagal melindunginya.",
      "Dialog yang terjadi setelah itu pendek, tetapi menancap. 'Kamu tidak paham akibatnya,' kata suara yang menahan panik. Naya menjawab pelan, 'Mungkin. Tapi kalian terlalu lama memakai kata akibat untuk menutup kata dosa.' Ruangan mendadak sempit. Salma memalingkan muka, seolah kalimat itu mengenai bagian dirinya yang paling ia sembunyikan. Di luar, suara santri mengaji terdengar jauh, bersih, hampir tidak cocok dengan kebusukan yang pelan-pelan muncul di balik dinding. Naya mendadak paham mengapa ibunya dulu selalu memilih duduk di belakang, dekat pintu keluar.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Makin malam, tekanan makin rapi. Ada yang mengunci pintu, ada yang memindahkan map, ada yang mengirim pesan tanpa nama. Naya mulai membedakan takut yang melumpuhkan dan takut yang memberi tenaga. Ia mencatat urutan kejadian dalam kepala: siapa datang lebih dulu, siapa terlalu cepat tahu, siapa pura-pura kaget, siapa menyebut nama Laila dengan suara seperti meminta ampun. Jika suatu hari ia harus berdiri di depan semua orang, ia tidak boleh hanya membawa tangis. Ia harus membawa urutan, tanggal, suara, dan bukti yang tidak bisa dipelintir menjadi cerita anak durhaka.",
      "Menjelang akhir babak itu, saksi itu menggambar wajah Jamal di sudut buku tulis. Naya tidak langsung bergerak. Tubuhnya ingin lari, tetapi sesuatu di dalam dirinya justru menjadi tenang, seperti orang yang akhirnya melihat bentuk musuh setelah lama dipukul dari gelap. Ia menggenggam bukti yang tersisa, menatap lorong, lalu berbisik pada nama ibunya tanpa suara. Besok mereka mungkin menuduhnya. Besok ia mungkin terusir. Besok orang-orang yang terlihat saleh bisa menunjukkan wajah asli. Namun malam ini satu hal pasti: pintu yang pernah ditutup untuk Laila mulai terbuka untuk Naya."
    ],
    "wordCount": 883,
    "sceneCount": 4,
    "reveals": [],
    "newNamedCharacters": [],
    "proposedStateDelta": {
      "chapter31_progress": true,
      "tension": true
    },
    "dialogue": [
      {
        "characterId": "char:naya",
        "text": "Aku tidak pulang untuk jadi anak baik di depan kebohongan."
      },
      {
        "characterId": "char:salma",
        "text": "Kalau kamu terus membuka pintu itu, tidak semua orang bisa diselamatkan."
      }
    ],
    "emotionBeats": [
      {
        "characterId": "char:naya",
        "targetCharacterId": "char:salma",
        "valence": "cold"
      }
    ]
  },
  {
    "chapterNumber": 32,
    "title": "Pengakuan Kyai Hamid",
    "phase": "ACT_5_BUKTI_DARI_LUAR",
    "chapterGoal": "Menggerakkan konflik Bilik Ketujuh melalui catatan rapat dewan yang disimpan Hamid dan tekanan utama: Hamid mengaku menutup perjanjian palsu demi pesantren.",
    "mandatoryBeats": [
      "catatan rapat dewan yang disimpan Hamid",
      "Hamid mengaku menutup perjanjian palsu demi pesantren",
      "Marwah menangis tanpa suara untuk pertama kalinya",
      "Hamid menyebut masih ada rekaman utuh di Bilik Ketujuh"
    ],
    "cast": [
      "char:naya",
      "char:kyai-hamid",
      "char:ustazah-marwah"
    ],
    "threadIds": [
      "thread:bilik-ketujuh",
      "thread:kunci-wakaf"
    ],
    "paragraphs": [
      "Serambi masjid sebelum subuh tidak pernah terasa benar bagi Naya. Setiap sudutnya seperti menyimpan napas orang yang menunggu dipanggil, sementara catatan rapat dewan yang disimpan Hamid terletak di hadapannya dengan tenang yang nyaris mengejek. Naya mencoba mengingat pesan ibunya: jangan takut pada pintu, takutlah pada orang yang menyuruhmu tidak bertanya. Tetapi pesan itu dulu hanya terdengar seperti nasihat untuk anak kecil yang sering kehilangan sandal di masjid. Sekarang, di usia yang memaksa dirinya terlihat dewasa, kalimat itu berubah menjadi pisau. Ia berdiri terlalu lama, sampai suara sandal dari arah belakang membuat tengkuknya menegang.",
      "Hamid mengaku menutup perjanjian palsu demi pesantren. Kalimat itu datang tidak selalu dengan teriakan; justru semakin pelan diucapkan, semakin jelas ancamannya. Naya tahu ada orang-orang yang menguasai tempat ini bukan karena mereka benar, melainkan karena semua orang sudah terbiasa menunduk. Ia menatap wajah Hamid, mencari celah yang bisa dibaca, tetapi yang ia temukan hanya kegelisahan yang disembunyikan di balik sikap biasa. Di pesantren, kebohongan tidak memakai pakaian hitam. Ia memakai senyum ustazah, kitab yang ditutup mendadak, dan aturan yang baru disebut setelah seseorang hampir menemukan jawaban.",
      "Marwah menangis tanpa suara untuk pertama kalinya. Bantuan itu kecil, hampir tidak pantas disebut pertolongan, namun bagi Naya yang mulai kehabisan tempat berpijak, hal kecil bisa terasa seperti tangan di tepi sumur. Ia menyimpan napas, mendengar bunyi malam, dan membiarkan dirinya membaca ulang semua kejadian sejak pulang. Kenapa semua orang tahu nama ibunya, tetapi tidak seorang pun berani mengucapkannya dengan wajar? Kenapa setiap arsip tentang Laila selalu punya bekas sobekan? Marwah pernah berkata bahwa beberapa keluarga tidak runtuh karena miskin, melainkan karena terlalu lama menyimpan malu milik orang lain.",
      "Petunjuk tentang catatan rapat dewan yang disimpan Hamid membuat Naya sadar bahwa misteri ini tidak berdiri sendiri. Ada tanah wakaf, nama anak-anak yang dipindahkan, para pengurus yang takut kehilangan muka, dan keluarga yang dibiarkan patah agar bangunan pesantren tetap terlihat kokoh. Ia ingat tiga jalan yang sejak awal membayanginya: menggali sendiri sampai kebenaran telanjang, patuh sebentar untuk memancing pengakuan, atau keluar dari pagar agar bukti tidak ikut dikubur. Pilihan itu tidak pernah benar-benar bersih. Jalan pertama bisa menghancurkan orang yang masih ingin ia percaya. Jalan kedua bisa menjadikannya alat para pembohong. Jalan ketiga bisa membuatnya kehilangan akses pada semua pintu yang baru mulai terbuka. Namun diam jelas bukan pilihan; diam adalah bahasa yang selama ini dipakai untuk mengubur Laila.",
      "Ketika Naya menyentuh bukti itu, Naya harus memutuskan apakah alasan baik bisa menutup kejahatan. Dadanya terasa seperti dipenuhi air yang tidak menemukan jalan keluar. Ia marah pada ibunya karena meninggalkan teka-teki, marah pada ayah yang entah hidup atau mati, marah pada Marwah yang selalu berbicara seolah luka orang lain adalah urusan administrasi. Tetapi paling dalam, Naya marah pada dirinya sendiri karena masih ingin seseorang berkata bahwa semua ini salah paham. Anak yang kehilangan ibu kadang tidak mencari kebenaran dulu; ia mencari satu orang dewasa yang bersedia mengaku telah gagal melindunginya.",
      "Dialog yang terjadi setelah itu pendek, tetapi menancap. 'Kamu tidak paham akibatnya,' kata suara yang menahan panik. Naya menjawab pelan, 'Mungkin. Tapi kalian terlalu lama memakai kata akibat untuk menutup kata dosa.' Ruangan mendadak sempit. Hamid memalingkan muka, seolah kalimat itu mengenai bagian dirinya yang paling ia sembunyikan. Di luar, suara santri mengaji terdengar jauh, bersih, hampir tidak cocok dengan kebusukan yang pelan-pelan muncul di balik dinding. Naya mendadak paham mengapa ibunya dulu selalu memilih duduk di belakang, dekat pintu keluar.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Makin malam, tekanan makin rapi. Ada yang mengunci pintu, ada yang memindahkan map, ada yang mengirim pesan tanpa nama. Naya mulai membedakan takut yang melumpuhkan dan takut yang memberi tenaga. Ia mencatat urutan kejadian dalam kepala: siapa datang lebih dulu, siapa terlalu cepat tahu, siapa pura-pura kaget, siapa menyebut nama Laila dengan suara seperti meminta ampun. Jika suatu hari ia harus berdiri di depan semua orang, ia tidak boleh hanya membawa tangis. Ia harus membawa urutan, tanggal, suara, dan bukti yang tidak bisa dipelintir menjadi cerita anak durhaka. Yang terbuka bukan sekadar petunjuk, melainkan rahasia yang mengubah cara Naya membaca semua babak sebelumnya.",
      "Menjelang akhir babak itu, Hamid menyebut masih ada rekaman utuh di Bilik Ketujuh. Naya tidak langsung bergerak. Tubuhnya ingin lari, tetapi sesuatu di dalam dirinya justru menjadi tenang, seperti orang yang akhirnya melihat bentuk musuh setelah lama dipukul dari gelap. Ia menggenggam bukti yang tersisa, menatap lorong, lalu berbisik pada nama ibunya tanpa suara. Besok mereka mungkin menuduhnya. Besok ia mungkin terusir. Besok orang-orang yang terlihat saleh bisa menunjukkan wajah asli. Namun malam ini satu hal pasti: pintu yang pernah ditutup untuk Laila mulai terbuka untuk Naya."
    ],
    "wordCount": 821,
    "sceneCount": 4,
    "reveals": [
      "secret:hamid-menutup-perjanjian"
    ],
    "newNamedCharacters": [],
    "proposedStateDelta": {
      "chapter32_progress": true,
      "tension": true,
      "revealed_hamid_menutup_perjanjian": true
    },
    "dialogue": [
      {
        "characterId": "char:naya",
        "text": "Aku tidak pulang untuk jadi anak baik di depan kebohongan."
      },
      {
        "characterId": "char:kyai-hamid",
        "text": "Kalau kamu terus membuka pintu itu, tidak semua orang bisa diselamatkan."
      }
    ],
    "emotionBeats": [
      {
        "characterId": "char:naya",
        "targetCharacterId": "char:kyai-hamid",
        "valence": "cold"
      }
    ]
  },
  {
    "chapterNumber": 33,
    "title": "Rafi dan Buku Ekspedisi",
    "phase": "ACT_6_JARINGAN_DEWAN",
    "chapterGoal": "Menggerakkan konflik Bilik Ketujuh melalui buku ekspedisi tua yang dibawa Rafi dan tekanan utama: Rafi menuntut jawaban tentang adiknya yang hilang.",
    "mandatoryBeats": [
      "buku ekspedisi tua yang dibawa Rafi",
      "Rafi menuntut jawaban tentang adiknya yang hilang",
      "Nadine menghubungkan nomor kiriman dengan daftar Laila",
      "buku ekspedisi menunjukkan paket terakhir dikirim ke rumah Sastro"
    ],
    "cast": [
      "char:naya",
      "char:rafi",
      "char:nadine"
    ],
    "threadIds": [
      "thread:kunci-wakaf",
      "thread:kematian-laila"
    ],
    "paragraphs": [
      "Terminal paket dekat pasar tidak pernah terasa benar bagi Naya. Setiap sudutnya seperti menyimpan napas orang yang menunggu dipanggil, sementara buku ekspedisi tua yang dibawa Rafi terletak di hadapannya dengan tenang yang nyaris mengejek. Naya mencoba mengingat pesan ibunya: jangan takut pada pintu, takutlah pada orang yang menyuruhmu tidak bertanya. Tetapi pesan itu dulu hanya terdengar seperti nasihat untuk anak kecil yang sering kehilangan sandal di masjid. Sekarang, di usia yang memaksa dirinya terlihat dewasa, kalimat itu berubah menjadi pisau. Ia berdiri terlalu lama, sampai suara sandal dari arah belakang membuat tengkuknya menegang.",
      "Rafi menuntut jawaban tentang adiknya yang hilang. Kalimat itu datang tidak selalu dengan teriakan; justru semakin pelan diucapkan, semakin jelas ancamannya. Naya tahu ada orang-orang yang menguasai tempat ini bukan karena mereka benar, melainkan karena semua orang sudah terbiasa menunduk. Ia menatap wajah Rafi, mencari celah yang bisa dibaca, tetapi yang ia temukan hanya kegelisahan yang disembunyikan di balik sikap biasa. Di pesantren, kebohongan tidak memakai pakaian hitam. Ia memakai senyum ustazah, kitab yang ditutup mendadak, dan aturan yang baru disebut setelah seseorang hampir menemukan jawaban.",
      "Nadine menghubungkan nomor kiriman dengan daftar Laila. Bantuan itu kecil, hampir tidak pantas disebut pertolongan, namun bagi Naya yang mulai kehabisan tempat berpijak, hal kecil bisa terasa seperti tangan di tepi sumur. Ia menyimpan napas, mendengar bunyi malam, dan membiarkan dirinya membaca ulang semua kejadian sejak pulang. Kenapa semua orang tahu nama ibunya, tetapi tidak seorang pun berani mengucapkannya dengan wajar? Kenapa setiap arsip tentang Laila selalu punya bekas sobekan? Nadine pernah berkata bahwa beberapa keluarga tidak runtuh karena miskin, melainkan karena terlalu lama menyimpan malu milik orang lain.",
      "Petunjuk tentang buku ekspedisi tua yang dibawa Rafi membuat Naya sadar bahwa misteri ini tidak berdiri sendiri. Ada tanah wakaf, nama anak-anak yang dipindahkan, para pengurus yang takut kehilangan muka, dan keluarga yang dibiarkan patah agar bangunan pesantren tetap terlihat kokoh. Ia ingat tiga jalan yang sejak awal membayanginya: menggali sendiri sampai kebenaran telanjang, patuh sebentar untuk memancing pengakuan, atau keluar dari pagar agar bukti tidak ikut dikubur. Pilihan itu tidak pernah benar-benar bersih. Jalan pertama bisa menghancurkan orang yang masih ingin ia percaya. Jalan kedua bisa menjadikannya alat para pembohong. Jalan ketiga bisa membuatnya kehilangan akses pada semua pintu yang baru mulai terbuka. Namun diam jelas bukan pilihan; diam adalah bahasa yang selama ini dipakai untuk mengubur Laila.",
      "Ketika Naya menyentuh bukti itu, Naya melihat lukanya bukan satu-satunya luka di desa itu. Dadanya terasa seperti dipenuhi air yang tidak menemukan jalan keluar. Ia marah pada ibunya karena meninggalkan teka-teki, marah pada ayah yang entah hidup atau mati, marah pada Marwah yang selalu berbicara seolah luka orang lain adalah urusan administrasi. Tetapi paling dalam, Naya marah pada dirinya sendiri karena masih ingin seseorang berkata bahwa semua ini salah paham. Anak yang kehilangan ibu kadang tidak mencari kebenaran dulu; ia mencari satu orang dewasa yang bersedia mengaku telah gagal melindunginya.",
      "Dialog yang terjadi setelah itu pendek, tetapi menancap. 'Kamu tidak paham akibatnya,' kata suara yang menahan panik. Naya menjawab pelan, 'Mungkin. Tapi kalian terlalu lama memakai kata akibat untuk menutup kata dosa.' Ruangan mendadak sempit. Rafi memalingkan muka, seolah kalimat itu mengenai bagian dirinya yang paling ia sembunyikan. Di luar, suara santri mengaji terdengar jauh, bersih, hampir tidak cocok dengan kebusukan yang pelan-pelan muncul di balik dinding. Naya mendadak paham mengapa ibunya dulu selalu memilih duduk di belakang, dekat pintu keluar.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Makin malam, tekanan makin rapi. Ada yang mengunci pintu, ada yang memindahkan map, ada yang mengirim pesan tanpa nama. Naya mulai membedakan takut yang melumpuhkan dan takut yang memberi tenaga. Ia mencatat urutan kejadian dalam kepala: siapa datang lebih dulu, siapa terlalu cepat tahu, siapa pura-pura kaget, siapa menyebut nama Laila dengan suara seperti meminta ampun. Jika suatu hari ia harus berdiri di depan semua orang, ia tidak boleh hanya membawa tangis. Ia harus membawa urutan, tanggal, suara, dan bukti yang tidak bisa dipelintir menjadi cerita anak durhaka.",
      "Menjelang akhir babak itu, buku ekspedisi menunjukkan paket terakhir dikirim ke rumah Sastro. Naya tidak langsung bergerak. Tubuhnya ingin lari, tetapi sesuatu di dalam dirinya justru menjadi tenang, seperti orang yang akhirnya melihat bentuk musuh setelah lama dipukul dari gelap. Ia menggenggam bukti yang tersisa, menatap lorong, lalu berbisik pada nama ibunya tanpa suara. Besok mereka mungkin menuduhnya. Besok ia mungkin terusir. Besok orang-orang yang terlihat saleh bisa menunjukkan wajah asli. Namun malam ini satu hal pasti: pintu yang pernah ditutup untuk Laila mulai terbuka untuk Naya."
    ],
    "wordCount": 879,
    "sceneCount": 4,
    "reveals": [],
    "newNamedCharacters": [
      "char:rafi"
    ],
    "proposedStateDelta": {
      "chapter33_progress": true,
      "tension": true
    },
    "dialogue": [
      {
        "characterId": "char:naya",
        "text": "Aku tidak pulang untuk jadi anak baik di depan kebohongan."
      },
      {
        "characterId": "char:rafi",
        "text": "Kalau kamu terus membuka pintu itu, tidak semua orang bisa diselamatkan."
      }
    ],
    "emotionBeats": [
      {
        "characterId": "char:naya",
        "targetCharacterId": "char:rafi",
        "valence": "cold"
      }
    ]
  },
  {
    "chapterNumber": 34,
    "title": "Jejak Mobil Hitam",
    "phase": "ACT_6_JARINGAN_DEWAN",
    "chapterGoal": "Menggerakkan konflik Bilik Ketujuh melalui bekas ban mobil hitam di samping sawah dan tekanan utama: Jamal menyuruh orang mengawasi Naya dari jauh.",
    "mandatoryBeats": [
      "bekas ban mobil hitam di samping sawah",
      "Jamal menyuruh orang mengawasi Naya dari jauh",
      "Hafiz menahan Rafi yang hampir menyerang penjaga",
      "sebuah plat nomor patah cocok dengan foto lama"
    ],
    "cast": [
      "char:naya",
      "char:hafiz",
      "char:rafi",
      "char:jamal"
    ],
    "threadIds": [
      "thread:kunci-wakaf"
    ],
    "paragraphs": [
      "Jalan tanah menuju rumah sastro tidak pernah terasa benar bagi Naya. Setiap sudutnya seperti menyimpan napas orang yang menunggu dipanggil, sementara bekas ban mobil hitam di samping sawah terletak di hadapannya dengan tenang yang nyaris mengejek. Naya mencoba mengingat pesan ibunya: jangan takut pada pintu, takutlah pada orang yang menyuruhmu tidak bertanya. Tetapi pesan itu dulu hanya terdengar seperti nasihat untuk anak kecil yang sering kehilangan sandal di masjid. Sekarang, di usia yang memaksa dirinya terlihat dewasa, kalimat itu berubah menjadi pisau. Ia berdiri terlalu lama, sampai suara sandal dari arah belakang membuat tengkuknya menegang.",
      "Jamal menyuruh orang mengawasi Naya dari jauh. Kalimat itu datang tidak selalu dengan teriakan; justru semakin pelan diucapkan, semakin jelas ancamannya. Naya tahu ada orang-orang yang menguasai tempat ini bukan karena mereka benar, melainkan karena semua orang sudah terbiasa menunduk. Ia menatap wajah Hafiz, mencari celah yang bisa dibaca, tetapi yang ia temukan hanya kegelisahan yang disembunyikan di balik sikap biasa. Di pesantren, kebohongan tidak memakai pakaian hitam. Ia memakai senyum ustazah, kitab yang ditutup mendadak, dan aturan yang baru disebut setelah seseorang hampir menemukan jawaban.",
      "Hafiz menahan Rafi yang hampir menyerang penjaga. Bantuan itu kecil, hampir tidak pantas disebut pertolongan, namun bagi Naya yang mulai kehabisan tempat berpijak, hal kecil bisa terasa seperti tangan di tepi sumur. Ia menyimpan napas, mendengar bunyi malam, dan membiarkan dirinya membaca ulang semua kejadian sejak pulang. Kenapa semua orang tahu nama ibunya, tetapi tidak seorang pun berani mengucapkannya dengan wajar? Kenapa setiap arsip tentang Laila selalu punya bekas sobekan? Rafi pernah berkata bahwa beberapa keluarga tidak runtuh karena miskin, melainkan karena terlalu lama menyimpan malu milik orang lain.",
      "Petunjuk tentang bekas ban mobil hitam di samping sawah membuat Naya sadar bahwa misteri ini tidak berdiri sendiri. Ada tanah wakaf, nama anak-anak yang dipindahkan, para pengurus yang takut kehilangan muka, dan keluarga yang dibiarkan patah agar bangunan pesantren tetap terlihat kokoh. Ia ingat tiga jalan yang sejak awal membayanginya: menggali sendiri sampai kebenaran telanjang, patuh sebentar untuk memancing pengakuan, atau keluar dari pagar agar bukti tidak ikut dikubur. Pilihan itu tidak pernah benar-benar bersih. Jalan pertama bisa menghancurkan orang yang masih ingin ia percaya. Jalan kedua bisa menjadikannya alat para pembohong. Jalan ketiga bisa membuatnya kehilangan akses pada semua pintu yang baru mulai terbuka. Namun diam jelas bukan pilihan; diam adalah bahasa yang selama ini dipakai untuk mengubur Laila.",
      "Ketika Naya menyentuh bukti itu, Naya belajar bahwa bukti harus lebih kuat daripada amarah. Dadanya terasa seperti dipenuhi air yang tidak menemukan jalan keluar. Ia marah pada ibunya karena meninggalkan teka-teki, marah pada ayah yang entah hidup atau mati, marah pada Marwah yang selalu berbicara seolah luka orang lain adalah urusan administrasi. Tetapi paling dalam, Naya marah pada dirinya sendiri karena masih ingin seseorang berkata bahwa semua ini salah paham. Anak yang kehilangan ibu kadang tidak mencari kebenaran dulu; ia mencari satu orang dewasa yang bersedia mengaku telah gagal melindunginya.",
      "Dialog yang terjadi setelah itu pendek, tetapi menancap. 'Kamu tidak paham akibatnya,' kata suara yang menahan panik. Naya menjawab pelan, 'Mungkin. Tapi kalian terlalu lama memakai kata akibat untuk menutup kata dosa.' Ruangan mendadak sempit. Hafiz memalingkan muka, seolah kalimat itu mengenai bagian dirinya yang paling ia sembunyikan. Di luar, suara santri mengaji terdengar jauh, bersih, hampir tidak cocok dengan kebusukan yang pelan-pelan muncul di balik dinding. Naya mendadak paham mengapa ibunya dulu selalu memilih duduk di belakang, dekat pintu keluar.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Makin malam, tekanan makin rapi. Ada yang mengunci pintu, ada yang memindahkan map, ada yang mengirim pesan tanpa nama. Naya mulai membedakan takut yang melumpuhkan dan takut yang memberi tenaga. Ia mencatat urutan kejadian dalam kepala: siapa datang lebih dulu, siapa terlalu cepat tahu, siapa pura-pura kaget, siapa menyebut nama Laila dengan suara seperti meminta ampun. Jika suatu hari ia harus berdiri di depan semua orang, ia tidak boleh hanya membawa tangis. Ia harus membawa urutan, tanggal, suara, dan bukti yang tidak bisa dipelintir menjadi cerita anak durhaka.",
      "Menjelang akhir babak itu, sebuah plat nomor patah cocok dengan foto lama. Naya tidak langsung bergerak. Tubuhnya ingin lari, tetapi sesuatu di dalam dirinya justru menjadi tenang, seperti orang yang akhirnya melihat bentuk musuh setelah lama dipukul dari gelap. Ia menggenggam bukti yang tersisa, menatap lorong, lalu berbisik pada nama ibunya tanpa suara. Besok mereka mungkin menuduhnya. Besok ia mungkin terusir. Besok orang-orang yang terlihat saleh bisa menunjukkan wajah asli. Namun malam ini satu hal pasti: pintu yang pernah ditutup untuk Laila mulai terbuka untuk Naya."
    ],
    "wordCount": 881,
    "sceneCount": 4,
    "reveals": [],
    "newNamedCharacters": [],
    "proposedStateDelta": {
      "chapter34_progress": true,
      "tension": true
    },
    "dialogue": [
      {
        "characterId": "char:naya",
        "text": "Aku tidak pulang untuk jadi anak baik di depan kebohongan."
      },
      {
        "characterId": "char:hafiz",
        "text": "Kalau kamu terus membuka pintu itu, tidak semua orang bisa diselamatkan."
      }
    ],
    "emotionBeats": [
      {
        "characterId": "char:naya",
        "targetCharacterId": "char:hafiz",
        "valence": "cold"
      }
    ]
  },
  {
    "chapterNumber": 35,
    "title": "Wasiat Bu Laila",
    "phase": "ACT_6_JARINGAN_DEWAN",
    "chapterGoal": "Menggerakkan konflik Bilik Ketujuh melalui kaleng berisi surat wasiat Laila dan tekanan utama: Arman tidak sanggup membaca kalimat terakhir istrinya.",
    "mandatoryBeats": [
      "kaleng berisi surat wasiat Laila",
      "Arman tidak sanggup membaca kalimat terakhir istrinya",
      "Naya membaca pesan yang meminta ia tidak membalas dengan fitnah",
      "wasiat itu menyebut nama Sastro sebagai pemegang kunci kedua"
    ],
    "cast": [
      "char:naya",
      "char:arman",
      "char:hafiz"
    ],
    "threadIds": [
      "thread:keluarga-naya",
      "thread:kunci-wakaf"
    ],
    "paragraphs": [
      "Sumur tua di belakang rumah wakaf tidak pernah terasa benar bagi Naya. Setiap sudutnya seperti menyimpan napas orang yang menunggu dipanggil, sementara kaleng berisi surat wasiat Laila terletak di hadapannya dengan tenang yang nyaris mengejek. Naya mencoba mengingat pesan ibunya: jangan takut pada pintu, takutlah pada orang yang menyuruhmu tidak bertanya. Tetapi pesan itu dulu hanya terdengar seperti nasihat untuk anak kecil yang sering kehilangan sandal di masjid. Sekarang, di usia yang memaksa dirinya terlihat dewasa, kalimat itu berubah menjadi pisau. Ia berdiri terlalu lama, sampai suara sandal dari arah belakang membuat tengkuknya menegang.",
      "Arman tidak sanggup membaca kalimat terakhir istrinya. Kalimat itu datang tidak selalu dengan teriakan; justru semakin pelan diucapkan, semakin jelas ancamannya. Naya tahu ada orang-orang yang menguasai tempat ini bukan karena mereka benar, melainkan karena semua orang sudah terbiasa menunduk. Ia menatap wajah Arman, mencari celah yang bisa dibaca, tetapi yang ia temukan hanya kegelisahan yang disembunyikan di balik sikap biasa. Di pesantren, kebohongan tidak memakai pakaian hitam. Ia memakai senyum ustazah, kitab yang ditutup mendadak, dan aturan yang baru disebut setelah seseorang hampir menemukan jawaban.",
      "Naya membaca pesan yang meminta ia tidak membalas dengan fitnah. Bantuan itu kecil, hampir tidak pantas disebut pertolongan, namun bagi Naya yang mulai kehabisan tempat berpijak, hal kecil bisa terasa seperti tangan di tepi sumur. Ia menyimpan napas, mendengar bunyi malam, dan membiarkan dirinya membaca ulang semua kejadian sejak pulang. Kenapa semua orang tahu nama ibunya, tetapi tidak seorang pun berani mengucapkannya dengan wajar? Kenapa setiap arsip tentang Laila selalu punya bekas sobekan? Hafiz pernah berkata bahwa beberapa keluarga tidak runtuh karena miskin, melainkan karena terlalu lama menyimpan malu milik orang lain.",
      "Petunjuk tentang kaleng berisi surat wasiat Laila membuat Naya sadar bahwa misteri ini tidak berdiri sendiri. Ada tanah wakaf, nama anak-anak yang dipindahkan, para pengurus yang takut kehilangan muka, dan keluarga yang dibiarkan patah agar bangunan pesantren tetap terlihat kokoh. Ia ingat tiga jalan yang sejak awal membayanginya: menggali sendiri sampai kebenaran telanjang, patuh sebentar untuk memancing pengakuan, atau keluar dari pagar agar bukti tidak ikut dikubur. Pilihan itu tidak pernah benar-benar bersih. Jalan pertama bisa menghancurkan orang yang masih ingin ia percaya. Jalan kedua bisa menjadikannya alat para pembohong. Jalan ketiga bisa membuatnya kehilangan akses pada semua pintu yang baru mulai terbuka. Namun diam jelas bukan pilihan; diam adalah bahasa yang selama ini dipakai untuk mengubur Laila.",
      "Ketika Naya menyentuh bukti itu, tangis Naya kali ini tidak melemahkan melainkan membersihkan. Dadanya terasa seperti dipenuhi air yang tidak menemukan jalan keluar. Ia marah pada ibunya karena meninggalkan teka-teki, marah pada ayah yang entah hidup atau mati, marah pada Marwah yang selalu berbicara seolah luka orang lain adalah urusan administrasi. Tetapi paling dalam, Naya marah pada dirinya sendiri karena masih ingin seseorang berkata bahwa semua ini salah paham. Anak yang kehilangan ibu kadang tidak mencari kebenaran dulu; ia mencari satu orang dewasa yang bersedia mengaku telah gagal melindunginya.",
      "Dialog yang terjadi setelah itu pendek, tetapi menancap. 'Kamu tidak paham akibatnya,' kata suara yang menahan panik. Naya menjawab pelan, 'Mungkin. Tapi kalian terlalu lama memakai kata akibat untuk menutup kata dosa.' Ruangan mendadak sempit. Arman memalingkan muka, seolah kalimat itu mengenai bagian dirinya yang paling ia sembunyikan. Di luar, suara santri mengaji terdengar jauh, bersih, hampir tidak cocok dengan kebusukan yang pelan-pelan muncul di balik dinding. Naya mendadak paham mengapa ibunya dulu selalu memilih duduk di belakang, dekat pintu keluar.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Makin malam, tekanan makin rapi. Ada yang mengunci pintu, ada yang memindahkan map, ada yang mengirim pesan tanpa nama. Naya mulai membedakan takut yang melumpuhkan dan takut yang memberi tenaga. Ia mencatat urutan kejadian dalam kepala: siapa datang lebih dulu, siapa terlalu cepat tahu, siapa pura-pura kaget, siapa menyebut nama Laila dengan suara seperti meminta ampun. Jika suatu hari ia harus berdiri di depan semua orang, ia tidak boleh hanya membawa tangis. Ia harus membawa urutan, tanggal, suara, dan bukti yang tidak bisa dipelintir menjadi cerita anak durhaka.",
      "Menjelang akhir babak itu, wasiat itu menyebut nama Sastro sebagai pemegang kunci kedua. Naya tidak langsung bergerak. Tubuhnya ingin lari, tetapi sesuatu di dalam dirinya justru menjadi tenang, seperti orang yang akhirnya melihat bentuk musuh setelah lama dipukul dari gelap. Ia menggenggam bukti yang tersisa, menatap lorong, lalu berbisik pada nama ibunya tanpa suara. Besok mereka mungkin menuduhnya. Besok ia mungkin terusir. Besok orang-orang yang terlihat saleh bisa menunjukkan wajah asli. Namun malam ini satu hal pasti: pintu yang pernah ditutup untuk Laila mulai terbuka untuk Naya."
    ],
    "wordCount": 881,
    "sceneCount": 4,
    "reveals": [],
    "newNamedCharacters": [],
    "proposedStateDelta": {
      "chapter35_progress": true,
      "tension": true
    },
    "dialogue": [
      {
        "characterId": "char:naya",
        "text": "Aku tidak pulang untuk jadi anak baik di depan kebohongan."
      },
      {
        "characterId": "char:arman",
        "text": "Kalau kamu terus membuka pintu itu, tidak semua orang bisa diselamatkan."
      }
    ],
    "emotionBeats": [
      {
        "characterId": "char:naya",
        "targetCharacterId": "char:arman",
        "valence": "cold"
      }
    ]
  },
  {
    "chapterNumber": 36,
    "title": "Salma Diancam",
    "phase": "ACT_6_JARINGAN_DEWAN",
    "chapterGoal": "Menggerakkan konflik Bilik Ketujuh melalui pecahan kaca dan pesan ancaman di lantai dan tekanan utama: Salma ingin mundur karena ibunya jatuh sakit.",
    "mandatoryBeats": [
      "pecahan kaca dan pesan ancaman di lantai",
      "Salma ingin mundur karena ibunya jatuh sakit",
      "Naya menawarkan diri membawa semua risiko sendiri",
      "Salma akhirnya menyerahkan rekaman suara dari malam penggeledahan"
    ],
    "cast": [
      "char:naya",
      "char:salma",
      "char:jamal"
    ],
    "threadIds": [
      "thread:kunci-wakaf",
      "thread:kematian-laila"
    ],
    "paragraphs": [
      "Rumah salma di gang sempit tidak pernah terasa benar bagi Naya. Setiap sudutnya seperti menyimpan napas orang yang menunggu dipanggil, sementara pecahan kaca dan pesan ancaman di lantai terletak di hadapannya dengan tenang yang nyaris mengejek. Naya mencoba mengingat pesan ibunya: jangan takut pada pintu, takutlah pada orang yang menyuruhmu tidak bertanya. Tetapi pesan itu dulu hanya terdengar seperti nasihat untuk anak kecil yang sering kehilangan sandal di masjid. Sekarang, di usia yang memaksa dirinya terlihat dewasa, kalimat itu berubah menjadi pisau. Ia berdiri terlalu lama, sampai suara sandal dari arah belakang membuat tengkuknya menegang.",
      "Salma ingin mundur karena ibunya jatuh sakit. Kalimat itu datang tidak selalu dengan teriakan; justru semakin pelan diucapkan, semakin jelas ancamannya. Naya tahu ada orang-orang yang menguasai tempat ini bukan karena mereka benar, melainkan karena semua orang sudah terbiasa menunduk. Ia menatap wajah Salma, mencari celah yang bisa dibaca, tetapi yang ia temukan hanya kegelisahan yang disembunyikan di balik sikap biasa. Di pesantren, kebohongan tidak memakai pakaian hitam. Ia memakai senyum ustazah, kitab yang ditutup mendadak, dan aturan yang baru disebut setelah seseorang hampir menemukan jawaban.",
      "Naya menawarkan diri membawa semua risiko sendiri. Bantuan itu kecil, hampir tidak pantas disebut pertolongan, namun bagi Naya yang mulai kehabisan tempat berpijak, hal kecil bisa terasa seperti tangan di tepi sumur. Ia menyimpan napas, mendengar bunyi malam, dan membiarkan dirinya membaca ulang semua kejadian sejak pulang. Kenapa semua orang tahu nama ibunya, tetapi tidak seorang pun berani mengucapkannya dengan wajar? Kenapa setiap arsip tentang Laila selalu punya bekas sobekan? Jamal pernah berkata bahwa beberapa keluarga tidak runtuh karena miskin, melainkan karena terlalu lama menyimpan malu milik orang lain.",
      "Petunjuk tentang pecahan kaca dan pesan ancaman di lantai membuat Naya sadar bahwa misteri ini tidak berdiri sendiri. Ada tanah wakaf, nama anak-anak yang dipindahkan, para pengurus yang takut kehilangan muka, dan keluarga yang dibiarkan patah agar bangunan pesantren tetap terlihat kokoh. Ia ingat tiga jalan yang sejak awal membayanginya: menggali sendiri sampai kebenaran telanjang, patuh sebentar untuk memancing pengakuan, atau keluar dari pagar agar bukti tidak ikut dikubur. Pilihan itu tidak pernah benar-benar bersih. Jalan pertama bisa menghancurkan orang yang masih ingin ia percaya. Jalan kedua bisa menjadikannya alat para pembohong. Jalan ketiga bisa membuatnya kehilangan akses pada semua pintu yang baru mulai terbuka. Namun diam jelas bukan pilihan; diam adalah bahasa yang selama ini dipakai untuk mengubur Laila.",
      "Ketika Naya menyentuh bukti itu, persahabatan diuji bukan oleh marah tetapi rasa takut. Dadanya terasa seperti dipenuhi air yang tidak menemukan jalan keluar. Ia marah pada ibunya karena meninggalkan teka-teki, marah pada ayah yang entah hidup atau mati, marah pada Marwah yang selalu berbicara seolah luka orang lain adalah urusan administrasi. Tetapi paling dalam, Naya marah pada dirinya sendiri karena masih ingin seseorang berkata bahwa semua ini salah paham. Anak yang kehilangan ibu kadang tidak mencari kebenaran dulu; ia mencari satu orang dewasa yang bersedia mengaku telah gagal melindunginya.",
      "Dialog yang terjadi setelah itu pendek, tetapi menancap. 'Kamu tidak paham akibatnya,' kata suara yang menahan panik. Naya menjawab pelan, 'Mungkin. Tapi kalian terlalu lama memakai kata akibat untuk menutup kata dosa.' Ruangan mendadak sempit. Salma memalingkan muka, seolah kalimat itu mengenai bagian dirinya yang paling ia sembunyikan. Di luar, suara santri mengaji terdengar jauh, bersih, hampir tidak cocok dengan kebusukan yang pelan-pelan muncul di balik dinding. Naya mendadak paham mengapa ibunya dulu selalu memilih duduk di belakang, dekat pintu keluar.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Makin malam, tekanan makin rapi. Ada yang mengunci pintu, ada yang memindahkan map, ada yang mengirim pesan tanpa nama. Naya mulai membedakan takut yang melumpuhkan dan takut yang memberi tenaga. Ia mencatat urutan kejadian dalam kepala: siapa datang lebih dulu, siapa terlalu cepat tahu, siapa pura-pura kaget, siapa menyebut nama Laila dengan suara seperti meminta ampun. Jika suatu hari ia harus berdiri di depan semua orang, ia tidak boleh hanya membawa tangis. Ia harus membawa urutan, tanggal, suara, dan bukti yang tidak bisa dipelintir menjadi cerita anak durhaka.",
      "Menjelang akhir babak itu, Salma akhirnya menyerahkan rekaman suara dari malam penggeledahan. Naya tidak langsung bergerak. Tubuhnya ingin lari, tetapi sesuatu di dalam dirinya justru menjadi tenang, seperti orang yang akhirnya melihat bentuk musuh setelah lama dipukul dari gelap. Ia menggenggam bukti yang tersisa, menatap lorong, lalu berbisik pada nama ibunya tanpa suara. Besok mereka mungkin menuduhnya. Besok ia mungkin terusir. Besok orang-orang yang terlihat saleh bisa menunjukkan wajah asli. Namun malam ini satu hal pasti: pintu yang pernah ditutup untuk Laila mulai terbuka untuk Naya."
    ],
    "wordCount": 880,
    "sceneCount": 4,
    "reveals": [],
    "newNamedCharacters": [],
    "proposedStateDelta": {
      "chapter36_progress": true,
      "tension": true
    },
    "dialogue": [
      {
        "characterId": "char:naya",
        "text": "Aku tidak pulang untuk jadi anak baik di depan kebohongan."
      },
      {
        "characterId": "char:salma",
        "text": "Kalau kamu terus membuka pintu itu, tidak semua orang bisa diselamatkan."
      }
    ],
    "emotionBeats": [
      {
        "characterId": "char:naya",
        "targetCharacterId": "char:salma",
        "valence": "cold"
      }
    ]
  },
  {
    "chapterNumber": 37,
    "title": "Rukmini Mengingat Nama Asli",
    "phase": "ACT_6_JARINGAN_DEWAN",
    "chapterGoal": "Menggerakkan konflik Bilik Ketujuh melalui nama asli salah satu anak hilang dan tekanan utama: Rukmini mengaku mengubah tiga belas identitas anak.",
    "mandatoryBeats": [
      "nama asli salah satu anak hilang",
      "Rukmini mengaku mengubah tiga belas identitas anak",
      "Rafi menemukan nama adiknya dalam catatan itu",
      "catatan terakhir menunjuk tanggal rapat wakaf rahasia"
    ],
    "cast": [
      "char:naya",
      "char:bu-rukmini",
      "char:rafi"
    ],
    "threadIds": [
      "thread:kematian-laila",
      "thread:kunci-wakaf"
    ],
    "paragraphs": [
      "Pondok arsiparis saat hujan sore tidak pernah terasa benar bagi Naya. Setiap sudutnya seperti menyimpan napas orang yang menunggu dipanggil, sementara nama asli salah satu anak hilang terletak di hadapannya dengan tenang yang nyaris mengejek. Naya mencoba mengingat pesan ibunya: jangan takut pada pintu, takutlah pada orang yang menyuruhmu tidak bertanya. Tetapi pesan itu dulu hanya terdengar seperti nasihat untuk anak kecil yang sering kehilangan sandal di masjid. Sekarang, di usia yang memaksa dirinya terlihat dewasa, kalimat itu berubah menjadi pisau. Ia berdiri terlalu lama, sampai suara sandal dari arah belakang membuat tengkuknya menegang.",
      "Rukmini mengaku mengubah tiga belas identitas anak. Kalimat itu datang tidak selalu dengan teriakan; justru semakin pelan diucapkan, semakin jelas ancamannya. Naya tahu ada orang-orang yang menguasai tempat ini bukan karena mereka benar, melainkan karena semua orang sudah terbiasa menunduk. Ia menatap wajah Rukmini, mencari celah yang bisa dibaca, tetapi yang ia temukan hanya kegelisahan yang disembunyikan di balik sikap biasa. Di pesantren, kebohongan tidak memakai pakaian hitam. Ia memakai senyum ustazah, kitab yang ditutup mendadak, dan aturan yang baru disebut setelah seseorang hampir menemukan jawaban.",
      "Rafi menemukan nama adiknya dalam catatan itu. Bantuan itu kecil, hampir tidak pantas disebut pertolongan, namun bagi Naya yang mulai kehabisan tempat berpijak, hal kecil bisa terasa seperti tangan di tepi sumur. Ia menyimpan napas, mendengar bunyi malam, dan membiarkan dirinya membaca ulang semua kejadian sejak pulang. Kenapa semua orang tahu nama ibunya, tetapi tidak seorang pun berani mengucapkannya dengan wajar? Kenapa setiap arsip tentang Laila selalu punya bekas sobekan? Rafi pernah berkata bahwa beberapa keluarga tidak runtuh karena miskin, melainkan karena terlalu lama menyimpan malu milik orang lain.",
      "Petunjuk tentang nama asli salah satu anak hilang membuat Naya sadar bahwa misteri ini tidak berdiri sendiri. Ada tanah wakaf, nama anak-anak yang dipindahkan, para pengurus yang takut kehilangan muka, dan keluarga yang dibiarkan patah agar bangunan pesantren tetap terlihat kokoh. Ia ingat tiga jalan yang sejak awal membayanginya: menggali sendiri sampai kebenaran telanjang, patuh sebentar untuk memancing pengakuan, atau keluar dari pagar agar bukti tidak ikut dikubur. Pilihan itu tidak pernah benar-benar bersih. Jalan pertama bisa menghancurkan orang yang masih ingin ia percaya. Jalan kedua bisa menjadikannya alat para pembohong. Jalan ketiga bisa membuatnya kehilangan akses pada semua pintu yang baru mulai terbuka. Namun diam jelas bukan pilihan; diam adalah bahasa yang selama ini dipakai untuk mengubur Laila.",
      "Ketika Naya menyentuh bukti itu, Naya tidak bisa lagi menganggap ini cuma urusan keluarga. Dadanya terasa seperti dipenuhi air yang tidak menemukan jalan keluar. Ia marah pada ibunya karena meninggalkan teka-teki, marah pada ayah yang entah hidup atau mati, marah pada Marwah yang selalu berbicara seolah luka orang lain adalah urusan administrasi. Tetapi paling dalam, Naya marah pada dirinya sendiri karena masih ingin seseorang berkata bahwa semua ini salah paham. Anak yang kehilangan ibu kadang tidak mencari kebenaran dulu; ia mencari satu orang dewasa yang bersedia mengaku telah gagal melindunginya.",
      "Dialog yang terjadi setelah itu pendek, tetapi menancap. 'Kamu tidak paham akibatnya,' kata suara yang menahan panik. Naya menjawab pelan, 'Mungkin. Tapi kalian terlalu lama memakai kata akibat untuk menutup kata dosa.' Ruangan mendadak sempit. Rukmini memalingkan muka, seolah kalimat itu mengenai bagian dirinya yang paling ia sembunyikan. Di luar, suara santri mengaji terdengar jauh, bersih, hampir tidak cocok dengan kebusukan yang pelan-pelan muncul di balik dinding. Naya mendadak paham mengapa ibunya dulu selalu memilih duduk di belakang, dekat pintu keluar.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Makin malam, tekanan makin rapi. Ada yang mengunci pintu, ada yang memindahkan map, ada yang mengirim pesan tanpa nama. Naya mulai membedakan takut yang melumpuhkan dan takut yang memberi tenaga. Ia mencatat urutan kejadian dalam kepala: siapa datang lebih dulu, siapa terlalu cepat tahu, siapa pura-pura kaget, siapa menyebut nama Laila dengan suara seperti meminta ampun. Jika suatu hari ia harus berdiri di depan semua orang, ia tidak boleh hanya membawa tangis. Ia harus membawa urutan, tanggal, suara, dan bukti yang tidak bisa dipelintir menjadi cerita anak durhaka.",
      "Menjelang akhir babak itu, catatan terakhir menunjuk tanggal rapat wakaf rahasia. Naya tidak langsung bergerak. Tubuhnya ingin lari, tetapi sesuatu di dalam dirinya justru menjadi tenang, seperti orang yang akhirnya melihat bentuk musuh setelah lama dipukul dari gelap. Ia menggenggam bukti yang tersisa, menatap lorong, lalu berbisik pada nama ibunya tanpa suara. Besok mereka mungkin menuduhnya. Besok ia mungkin terusir. Besok orang-orang yang terlihat saleh bisa menunjukkan wajah asli. Namun malam ini satu hal pasti: pintu yang pernah ditutup untuk Laila mulai terbuka untuk Naya."
    ],
    "wordCount": 878,
    "sceneCount": 4,
    "reveals": [],
    "newNamedCharacters": [],
    "proposedStateDelta": {
      "chapter37_progress": true,
      "tension": true
    },
    "dialogue": [
      {
        "characterId": "char:naya",
        "text": "Aku tidak pulang untuk jadi anak baik di depan kebohongan."
      },
      {
        "characterId": "char:bu-rukmini",
        "text": "Kalau kamu terus membuka pintu itu, tidak semua orang bisa diselamatkan."
      }
    ],
    "emotionBeats": [
      {
        "characterId": "char:naya",
        "targetCharacterId": "char:bu-rukmini",
        "valence": "cold"
      }
    ]
  },
  {
    "chapterNumber": 38,
    "title": "Sastro Membuka Rapat Wakaf",
    "phase": "ACT_6_JARINGAN_DEWAN",
    "chapterGoal": "Menggerakkan konflik Bilik Ketujuh melalui undangan rapat wakaf tertutup dan tekanan utama: Sastro mencoba terlihat netral di depan semua pihak.",
    "mandatoryBeats": [
      "undangan rapat wakaf tertutup",
      "Sastro mencoba terlihat netral di depan semua pihak",
      "Nadine menyiapkan kamera cadangan di tasnya",
      "Sastro berbisik bahwa rekaman utuh ada di ruang suara masjid"
    ],
    "cast": [
      "char:naya",
      "char:pak-sastro",
      "char:nadine",
      "char:jamal"
    ],
    "threadIds": [
      "thread:kunci-wakaf",
      "thread:bilik-ketujuh"
    ],
    "paragraphs": [
      "Balai desa yang penuh warga tidak pernah terasa benar bagi Naya. Setiap sudutnya seperti menyimpan napas orang yang menunggu dipanggil, sementara undangan rapat wakaf tertutup terletak di hadapannya dengan tenang yang nyaris mengejek. Naya mencoba mengingat pesan ibunya: jangan takut pada pintu, takutlah pada orang yang menyuruhmu tidak bertanya. Tetapi pesan itu dulu hanya terdengar seperti nasihat untuk anak kecil yang sering kehilangan sandal di masjid. Sekarang, di usia yang memaksa dirinya terlihat dewasa, kalimat itu berubah menjadi pisau. Ia berdiri terlalu lama, sampai suara sandal dari arah belakang membuat tengkuknya menegang.",
      "Sastro mencoba terlihat netral di depan semua pihak. Kalimat itu datang tidak selalu dengan teriakan; justru semakin pelan diucapkan, semakin jelas ancamannya. Naya tahu ada orang-orang yang menguasai tempat ini bukan karena mereka benar, melainkan karena semua orang sudah terbiasa menunduk. Ia menatap wajah Sastro, mencari celah yang bisa dibaca, tetapi yang ia temukan hanya kegelisahan yang disembunyikan di balik sikap biasa. Di pesantren, kebohongan tidak memakai pakaian hitam. Ia memakai senyum ustazah, kitab yang ditutup mendadak, dan aturan yang baru disebut setelah seseorang hampir menemukan jawaban.",
      "Nadine menyiapkan kamera cadangan di tasnya. Bantuan itu kecil, hampir tidak pantas disebut pertolongan, namun bagi Naya yang mulai kehabisan tempat berpijak, hal kecil bisa terasa seperti tangan di tepi sumur. Ia menyimpan napas, mendengar bunyi malam, dan membiarkan dirinya membaca ulang semua kejadian sejak pulang. Kenapa semua orang tahu nama ibunya, tetapi tidak seorang pun berani mengucapkannya dengan wajar? Kenapa setiap arsip tentang Laila selalu punya bekas sobekan? Nadine pernah berkata bahwa beberapa keluarga tidak runtuh karena miskin, melainkan karena terlalu lama menyimpan malu milik orang lain.",
      "Petunjuk tentang undangan rapat wakaf tertutup membuat Naya sadar bahwa misteri ini tidak berdiri sendiri. Ada tanah wakaf, nama anak-anak yang dipindahkan, para pengurus yang takut kehilangan muka, dan keluarga yang dibiarkan patah agar bangunan pesantren tetap terlihat kokoh. Ia ingat tiga jalan yang sejak awal membayanginya: menggali sendiri sampai kebenaran telanjang, patuh sebentar untuk memancing pengakuan, atau keluar dari pagar agar bukti tidak ikut dikubur. Pilihan itu tidak pernah benar-benar bersih. Jalan pertama bisa menghancurkan orang yang masih ingin ia percaya. Jalan kedua bisa menjadikannya alat para pembohong. Jalan ketiga bisa membuatnya kehilangan akses pada semua pintu yang baru mulai terbuka. Namun diam jelas bukan pilihan; diam adalah bahasa yang selama ini dipakai untuk mengubur Laila.",
      "Ketika Naya menyentuh bukti itu, Naya mencium peluang tetapi juga jebakan. Dadanya terasa seperti dipenuhi air yang tidak menemukan jalan keluar. Ia marah pada ibunya karena meninggalkan teka-teki, marah pada ayah yang entah hidup atau mati, marah pada Marwah yang selalu berbicara seolah luka orang lain adalah urusan administrasi. Tetapi paling dalam, Naya marah pada dirinya sendiri karena masih ingin seseorang berkata bahwa semua ini salah paham. Anak yang kehilangan ibu kadang tidak mencari kebenaran dulu; ia mencari satu orang dewasa yang bersedia mengaku telah gagal melindunginya.",
      "Dialog yang terjadi setelah itu pendek, tetapi menancap. 'Kamu tidak paham akibatnya,' kata suara yang menahan panik. Naya menjawab pelan, 'Mungkin. Tapi kalian terlalu lama memakai kata akibat untuk menutup kata dosa.' Ruangan mendadak sempit. Sastro memalingkan muka, seolah kalimat itu mengenai bagian dirinya yang paling ia sembunyikan. Di luar, suara santri mengaji terdengar jauh, bersih, hampir tidak cocok dengan kebusukan yang pelan-pelan muncul di balik dinding. Naya mendadak paham mengapa ibunya dulu selalu memilih duduk di belakang, dekat pintu keluar.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Makin malam, tekanan makin rapi. Ada yang mengunci pintu, ada yang memindahkan map, ada yang mengirim pesan tanpa nama. Naya mulai membedakan takut yang melumpuhkan dan takut yang memberi tenaga. Ia mencatat urutan kejadian dalam kepala: siapa datang lebih dulu, siapa terlalu cepat tahu, siapa pura-pura kaget, siapa menyebut nama Laila dengan suara seperti meminta ampun. Jika suatu hari ia harus berdiri di depan semua orang, ia tidak boleh hanya membawa tangis. Ia harus membawa urutan, tanggal, suara, dan bukti yang tidak bisa dipelintir menjadi cerita anak durhaka.",
      "Menjelang akhir babak itu, Sastro berbisik bahwa rekaman utuh ada di ruang suara masjid. Naya tidak langsung bergerak. Tubuhnya ingin lari, tetapi sesuatu di dalam dirinya justru menjadi tenang, seperti orang yang akhirnya melihat bentuk musuh setelah lama dipukul dari gelap. Ia menggenggam bukti yang tersisa, menatap lorong, lalu berbisik pada nama ibunya tanpa suara. Besok mereka mungkin menuduhnya. Besok ia mungkin terusir. Besok orang-orang yang terlihat saleh bisa menunjukkan wajah asli. Namun malam ini satu hal pasti: pintu yang pernah ditutup untuk Laila mulai terbuka untuk Naya."
    ],
    "wordCount": 874,
    "sceneCount": 4,
    "reveals": [],
    "newNamedCharacters": [
      "char:pak-sastro"
    ],
    "proposedStateDelta": {
      "chapter38_progress": true,
      "tension": true
    },
    "dialogue": [
      {
        "characterId": "char:naya",
        "text": "Aku tidak pulang untuk jadi anak baik di depan kebohongan."
      },
      {
        "characterId": "char:pak-sastro",
        "text": "Kalau kamu terus membuka pintu itu, tidak semua orang bisa diselamatkan."
      }
    ],
    "emotionBeats": [
      {
        "characterId": "char:naya",
        "targetCharacterId": "char:pak-sastro",
        "valence": "cold"
      }
    ]
  },
  {
    "chapterNumber": 39,
    "title": "Bukti yang Hilang di Masjid",
    "phase": "ACT_6_JARINGAN_DEWAN",
    "chapterGoal": "Menggerakkan konflik Bilik Ketujuh melalui kotak kaset yang kosong kecuali debu dan tekanan utama: Marwah menuduh Sastro menjebak Naya.",
    "mandatoryBeats": [
      "kotak kaset yang kosong kecuali debu",
      "Marwah menuduh Sastro menjebak Naya",
      "Hafiz menemukan serat kain di sela lemari",
      "serat kain itu sama dengan sorban Kyai Hamid"
    ],
    "cast": [
      "char:naya",
      "char:ustazah-marwah",
      "char:hafiz",
      "char:pak-sastro"
    ],
    "threadIds": [
      "thread:bilik-ketujuh",
      "thread:loyalitas-hafiz"
    ],
    "paragraphs": [
      "Ruang suara masjid dekat mimbar tidak pernah terasa benar bagi Naya. Setiap sudutnya seperti menyimpan napas orang yang menunggu dipanggil, sementara kotak kaset yang kosong kecuali debu terletak di hadapannya dengan tenang yang nyaris mengejek. Naya mencoba mengingat pesan ibunya: jangan takut pada pintu, takutlah pada orang yang menyuruhmu tidak bertanya. Tetapi pesan itu dulu hanya terdengar seperti nasihat untuk anak kecil yang sering kehilangan sandal di masjid. Sekarang, di usia yang memaksa dirinya terlihat dewasa, kalimat itu berubah menjadi pisau. Ia berdiri terlalu lama, sampai suara sandal dari arah belakang membuat tengkuknya menegang.",
      "Marwah menuduh Sastro menjebak Naya. Kalimat itu datang tidak selalu dengan teriakan; justru semakin pelan diucapkan, semakin jelas ancamannya. Naya tahu ada orang-orang yang menguasai tempat ini bukan karena mereka benar, melainkan karena semua orang sudah terbiasa menunduk. Ia menatap wajah Marwah, mencari celah yang bisa dibaca, tetapi yang ia temukan hanya kegelisahan yang disembunyikan di balik sikap biasa. Di pesantren, kebohongan tidak memakai pakaian hitam. Ia memakai senyum ustazah, kitab yang ditutup mendadak, dan aturan yang baru disebut setelah seseorang hampir menemukan jawaban.",
      "Hafiz menemukan serat kain di sela lemari. Bantuan itu kecil, hampir tidak pantas disebut pertolongan, namun bagi Naya yang mulai kehabisan tempat berpijak, hal kecil bisa terasa seperti tangan di tepi sumur. Ia menyimpan napas, mendengar bunyi malam, dan membiarkan dirinya membaca ulang semua kejadian sejak pulang. Kenapa semua orang tahu nama ibunya, tetapi tidak seorang pun berani mengucapkannya dengan wajar? Kenapa setiap arsip tentang Laila selalu punya bekas sobekan? Hafiz pernah berkata bahwa beberapa keluarga tidak runtuh karena miskin, melainkan karena terlalu lama menyimpan malu milik orang lain.",
      "Petunjuk tentang kotak kaset yang kosong kecuali debu membuat Naya sadar bahwa misteri ini tidak berdiri sendiri. Ada tanah wakaf, nama anak-anak yang dipindahkan, para pengurus yang takut kehilangan muka, dan keluarga yang dibiarkan patah agar bangunan pesantren tetap terlihat kokoh. Ia ingat tiga jalan yang sejak awal membayanginya: menggali sendiri sampai kebenaran telanjang, patuh sebentar untuk memancing pengakuan, atau keluar dari pagar agar bukti tidak ikut dikubur. Pilihan itu tidak pernah benar-benar bersih. Jalan pertama bisa menghancurkan orang yang masih ingin ia percaya. Jalan kedua bisa menjadikannya alat para pembohong. Jalan ketiga bisa membuatnya kehilangan akses pada semua pintu yang baru mulai terbuka. Namun diam jelas bukan pilihan; diam adalah bahasa yang selama ini dipakai untuk mengubur Laila.",
      "Ketika Naya menyentuh bukti itu, kepercayaan Naya retak lagi di saat ia paling butuh sekutu. Dadanya terasa seperti dipenuhi air yang tidak menemukan jalan keluar. Ia marah pada ibunya karena meninggalkan teka-teki, marah pada ayah yang entah hidup atau mati, marah pada Marwah yang selalu berbicara seolah luka orang lain adalah urusan administrasi. Tetapi paling dalam, Naya marah pada dirinya sendiri karena masih ingin seseorang berkata bahwa semua ini salah paham. Anak yang kehilangan ibu kadang tidak mencari kebenaran dulu; ia mencari satu orang dewasa yang bersedia mengaku telah gagal melindunginya.",
      "Dialog yang terjadi setelah itu pendek, tetapi menancap. 'Kamu tidak paham akibatnya,' kata suara yang menahan panik. Naya menjawab pelan, 'Mungkin. Tapi kalian terlalu lama memakai kata akibat untuk menutup kata dosa.' Ruangan mendadak sempit. Marwah memalingkan muka, seolah kalimat itu mengenai bagian dirinya yang paling ia sembunyikan. Di luar, suara santri mengaji terdengar jauh, bersih, hampir tidak cocok dengan kebusukan yang pelan-pelan muncul di balik dinding. Naya mendadak paham mengapa ibunya dulu selalu memilih duduk di belakang, dekat pintu keluar.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Makin malam, tekanan makin rapi. Ada yang mengunci pintu, ada yang memindahkan map, ada yang mengirim pesan tanpa nama. Naya mulai membedakan takut yang melumpuhkan dan takut yang memberi tenaga. Ia mencatat urutan kejadian dalam kepala: siapa datang lebih dulu, siapa terlalu cepat tahu, siapa pura-pura kaget, siapa menyebut nama Laila dengan suara seperti meminta ampun. Jika suatu hari ia harus berdiri di depan semua orang, ia tidak boleh hanya membawa tangis. Ia harus membawa urutan, tanggal, suara, dan bukti yang tidak bisa dipelintir menjadi cerita anak durhaka.",
      "Menjelang akhir babak itu, serat kain itu sama dengan sorban Kyai Hamid. Naya tidak langsung bergerak. Tubuhnya ingin lari, tetapi sesuatu di dalam dirinya justru menjadi tenang, seperti orang yang akhirnya melihat bentuk musuh setelah lama dipukul dari gelap. Ia menggenggam bukti yang tersisa, menatap lorong, lalu berbisik pada nama ibunya tanpa suara. Besok mereka mungkin menuduhnya. Besok ia mungkin terusir. Besok orang-orang yang terlihat saleh bisa menunjukkan wajah asli. Namun malam ini satu hal pasti: pintu yang pernah ditutup untuk Laila mulai terbuka untuk Naya."
    ],
    "wordCount": 878,
    "sceneCount": 4,
    "reveals": [],
    "newNamedCharacters": [],
    "proposedStateDelta": {
      "chapter39_progress": true,
      "tension": true
    },
    "dialogue": [
      {
        "characterId": "char:naya",
        "text": "Aku tidak pulang untuk jadi anak baik di depan kebohongan."
      },
      {
        "characterId": "char:ustazah-marwah",
        "text": "Kalau kamu terus membuka pintu itu, tidak semua orang bisa diselamatkan."
      }
    ],
    "emotionBeats": [
      {
        "characterId": "char:naya",
        "targetCharacterId": "char:ustazah-marwah",
        "valence": "cold"
      }
    ]
  },
  {
    "chapterNumber": 40,
    "title": "Janji Hafiz kepada Bu Laila",
    "phase": "ACT_7_REKAMAN_DAN_PENGAKUAN",
    "chapterGoal": "Menggerakkan konflik Bilik Ketujuh melalui buku utang lama dengan tanda tangan Laila dan tekanan utama: Hafiz mengaku pernah berjanji menjaga Naya.",
    "mandatoryBeats": [
      "buku utang lama dengan tanda tangan Laila",
      "Hafiz mengaku pernah berjanji menjaga Naya",
      "Naya akhirnya bertanya apakah janji itu cinta atau rasa bersalah",
      "di halaman terakhir buku utang ada kode rak Bilik Ketujuh"
    ],
    "cast": [
      "char:naya",
      "char:hafiz",
      "char:salma"
    ],
    "threadIds": [
      "thread:loyalitas-hafiz",
      "thread:bilik-ketujuh"
    ],
    "paragraphs": [
      "Koperasi yang kini dijaga santri tidak pernah terasa benar bagi Naya. Setiap sudutnya seperti menyimpan napas orang yang menunggu dipanggil, sementara buku utang lama dengan tanda tangan Laila terletak di hadapannya dengan tenang yang nyaris mengejek. Naya mencoba mengingat pesan ibunya: jangan takut pada pintu, takutlah pada orang yang menyuruhmu tidak bertanya. Tetapi pesan itu dulu hanya terdengar seperti nasihat untuk anak kecil yang sering kehilangan sandal di masjid. Sekarang, di usia yang memaksa dirinya terlihat dewasa, kalimat itu berubah menjadi pisau. Ia berdiri terlalu lama, sampai suara sandal dari arah belakang membuat tengkuknya menegang.",
      "Hafiz mengaku pernah berjanji menjaga Naya. Kalimat itu datang tidak selalu dengan teriakan; justru semakin pelan diucapkan, semakin jelas ancamannya. Naya tahu ada orang-orang yang menguasai tempat ini bukan karena mereka benar, melainkan karena semua orang sudah terbiasa menunduk. Ia menatap wajah Hafiz, mencari celah yang bisa dibaca, tetapi yang ia temukan hanya kegelisahan yang disembunyikan di balik sikap biasa. Di pesantren, kebohongan tidak memakai pakaian hitam. Ia memakai senyum ustazah, kitab yang ditutup mendadak, dan aturan yang baru disebut setelah seseorang hampir menemukan jawaban.",
      "Naya akhirnya bertanya apakah janji itu cinta atau rasa bersalah. Bantuan itu kecil, hampir tidak pantas disebut pertolongan, namun bagi Naya yang mulai kehabisan tempat berpijak, hal kecil bisa terasa seperti tangan di tepi sumur. Ia menyimpan napas, mendengar bunyi malam, dan membiarkan dirinya membaca ulang semua kejadian sejak pulang. Kenapa semua orang tahu nama ibunya, tetapi tidak seorang pun berani mengucapkannya dengan wajar? Kenapa setiap arsip tentang Laila selalu punya bekas sobekan? Salma pernah berkata bahwa beberapa keluarga tidak runtuh karena miskin, melainkan karena terlalu lama menyimpan malu milik orang lain.",
      "Petunjuk tentang buku utang lama dengan tanda tangan Laila membuat Naya sadar bahwa misteri ini tidak berdiri sendiri. Ada tanah wakaf, nama anak-anak yang dipindahkan, para pengurus yang takut kehilangan muka, dan keluarga yang dibiarkan patah agar bangunan pesantren tetap terlihat kokoh. Ia ingat tiga jalan yang sejak awal membayanginya: menggali sendiri sampai kebenaran telanjang, patuh sebentar untuk memancing pengakuan, atau keluar dari pagar agar bukti tidak ikut dikubur. Pilihan itu tidak pernah benar-benar bersih. Jalan pertama bisa menghancurkan orang yang masih ingin ia percaya. Jalan kedua bisa menjadikannya alat para pembohong. Jalan ketiga bisa membuatnya kehilangan akses pada semua pintu yang baru mulai terbuka. Namun diam jelas bukan pilihan; diam adalah bahasa yang selama ini dipakai untuk mengubur Laila.",
      "Ketika Naya menyentuh bukti itu, hati Naya melembut tanpa kehilangan kewaspadaan. Dadanya terasa seperti dipenuhi air yang tidak menemukan jalan keluar. Ia marah pada ibunya karena meninggalkan teka-teki, marah pada ayah yang entah hidup atau mati, marah pada Marwah yang selalu berbicara seolah luka orang lain adalah urusan administrasi. Tetapi paling dalam, Naya marah pada dirinya sendiri karena masih ingin seseorang berkata bahwa semua ini salah paham. Anak yang kehilangan ibu kadang tidak mencari kebenaran dulu; ia mencari satu orang dewasa yang bersedia mengaku telah gagal melindunginya.",
      "Dialog yang terjadi setelah itu pendek, tetapi menancap. 'Kamu tidak paham akibatnya,' kata suara yang menahan panik. Naya menjawab pelan, 'Mungkin. Tapi kalian terlalu lama memakai kata akibat untuk menutup kata dosa.' Ruangan mendadak sempit. Hafiz memalingkan muka, seolah kalimat itu mengenai bagian dirinya yang paling ia sembunyikan. Di luar, suara santri mengaji terdengar jauh, bersih, hampir tidak cocok dengan kebusukan yang pelan-pelan muncul di balik dinding. Naya mendadak paham mengapa ibunya dulu selalu memilih duduk di belakang, dekat pintu keluar.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Makin malam, tekanan makin rapi. Ada yang mengunci pintu, ada yang memindahkan map, ada yang mengirim pesan tanpa nama. Naya mulai membedakan takut yang melumpuhkan dan takut yang memberi tenaga. Ia mencatat urutan kejadian dalam kepala: siapa datang lebih dulu, siapa terlalu cepat tahu, siapa pura-pura kaget, siapa menyebut nama Laila dengan suara seperti meminta ampun. Jika suatu hari ia harus berdiri di depan semua orang, ia tidak boleh hanya membawa tangis. Ia harus membawa urutan, tanggal, suara, dan bukti yang tidak bisa dipelintir menjadi cerita anak durhaka.",
      "Menjelang akhir babak itu, di halaman terakhir buku utang ada kode rak Bilik Ketujuh. Naya tidak langsung bergerak. Tubuhnya ingin lari, tetapi sesuatu di dalam dirinya justru menjadi tenang, seperti orang yang akhirnya melihat bentuk musuh setelah lama dipukul dari gelap. Ia menggenggam bukti yang tersisa, menatap lorong, lalu berbisik pada nama ibunya tanpa suara. Besok mereka mungkin menuduhnya. Besok ia mungkin terusir. Besok orang-orang yang terlihat saleh bisa menunjukkan wajah asli. Namun malam ini satu hal pasti: pintu yang pernah ditutup untuk Laila mulai terbuka untuk Naya."
    ],
    "wordCount": 882,
    "sceneCount": 4,
    "reveals": [],
    "newNamedCharacters": [],
    "proposedStateDelta": {
      "chapter40_progress": true,
      "tension": true
    },
    "dialogue": [
      {
        "characterId": "char:naya",
        "text": "Aku tidak pulang untuk jadi anak baik di depan kebohongan."
      },
      {
        "characterId": "char:hafiz",
        "text": "Kalau kamu terus membuka pintu itu, tidak semua orang bisa diselamatkan."
      }
    ],
    "emotionBeats": [
      {
        "characterId": "char:naya",
        "targetCharacterId": "char:hafiz",
        "valence": "neutral"
      }
    ]
  },
  {
    "chapterNumber": 41,
    "title": "Marwah Meminta Satu Malam",
    "phase": "ACT_7_REKAMAN_DAN_PENGAKUAN",
    "chapterGoal": "Menggerakkan konflik Bilik Ketujuh melalui tasbih Laila yang disimpan Marwah dan tekanan utama: Marwah meminta kesempatan menebus sebelum semuanya pecah.",
    "mandatoryBeats": [
      "tasbih Laila yang disimpan Marwah",
      "Marwah meminta kesempatan menebus sebelum semuanya pecah",
      "Arman menolak percaya pada perempuan yang menghancurkan keluarganya",
      "Marwah berkata besok ia akan membuka Bilik Ketujuh sendiri"
    ],
    "cast": [
      "char:naya",
      "char:ustazah-marwah",
      "char:arman"
    ],
    "threadIds": [
      "thread:kematian-laila",
      "thread:bilik-ketujuh"
    ],
    "paragraphs": [
      "Teras rumah pengasuh yang sepi tidak pernah terasa benar bagi Naya. Setiap sudutnya seperti menyimpan napas orang yang menunggu dipanggil, sementara tasbih Laila yang disimpan Marwah terletak di hadapannya dengan tenang yang nyaris mengejek. Naya mencoba mengingat pesan ibunya: jangan takut pada pintu, takutlah pada orang yang menyuruhmu tidak bertanya. Tetapi pesan itu dulu hanya terdengar seperti nasihat untuk anak kecil yang sering kehilangan sandal di masjid. Sekarang, di usia yang memaksa dirinya terlihat dewasa, kalimat itu berubah menjadi pisau. Ia berdiri terlalu lama, sampai suara sandal dari arah belakang membuat tengkuknya menegang.",
      "Marwah meminta kesempatan menebus sebelum semuanya pecah. Kalimat itu datang tidak selalu dengan teriakan; justru semakin pelan diucapkan, semakin jelas ancamannya. Naya tahu ada orang-orang yang menguasai tempat ini bukan karena mereka benar, melainkan karena semua orang sudah terbiasa menunduk. Ia menatap wajah Marwah, mencari celah yang bisa dibaca, tetapi yang ia temukan hanya kegelisahan yang disembunyikan di balik sikap biasa. Di pesantren, kebohongan tidak memakai pakaian hitam. Ia memakai senyum ustazah, kitab yang ditutup mendadak, dan aturan yang baru disebut setelah seseorang hampir menemukan jawaban.",
      "Arman menolak percaya pada perempuan yang menghancurkan keluarganya. Bantuan itu kecil, hampir tidak pantas disebut pertolongan, namun bagi Naya yang mulai kehabisan tempat berpijak, hal kecil bisa terasa seperti tangan di tepi sumur. Ia menyimpan napas, mendengar bunyi malam, dan membiarkan dirinya membaca ulang semua kejadian sejak pulang. Kenapa semua orang tahu nama ibunya, tetapi tidak seorang pun berani mengucapkannya dengan wajar? Kenapa setiap arsip tentang Laila selalu punya bekas sobekan? Arman pernah berkata bahwa beberapa keluarga tidak runtuh karena miskin, melainkan karena terlalu lama menyimpan malu milik orang lain.",
      "Petunjuk tentang tasbih Laila yang disimpan Marwah membuat Naya sadar bahwa misteri ini tidak berdiri sendiri. Ada tanah wakaf, nama anak-anak yang dipindahkan, para pengurus yang takut kehilangan muka, dan keluarga yang dibiarkan patah agar bangunan pesantren tetap terlihat kokoh. Ia ingat tiga jalan yang sejak awal membayanginya: menggali sendiri sampai kebenaran telanjang, patuh sebentar untuk memancing pengakuan, atau keluar dari pagar agar bukti tidak ikut dikubur. Pilihan itu tidak pernah benar-benar bersih. Jalan pertama bisa menghancurkan orang yang masih ingin ia percaya. Jalan kedua bisa menjadikannya alat para pembohong. Jalan ketiga bisa membuatnya kehilangan akses pada semua pintu yang baru mulai terbuka. Namun diam jelas bukan pilihan; diam adalah bahasa yang selama ini dipakai untuk mengubur Laila.",
      "Ketika Naya menyentuh bukti itu, Naya berdiri di antara dendam ayah dan rahasia bibinya. Dadanya terasa seperti dipenuhi air yang tidak menemukan jalan keluar. Ia marah pada ibunya karena meninggalkan teka-teki, marah pada ayah yang entah hidup atau mati, marah pada Marwah yang selalu berbicara seolah luka orang lain adalah urusan administrasi. Tetapi paling dalam, Naya marah pada dirinya sendiri karena masih ingin seseorang berkata bahwa semua ini salah paham. Anak yang kehilangan ibu kadang tidak mencari kebenaran dulu; ia mencari satu orang dewasa yang bersedia mengaku telah gagal melindunginya.",
      "Dialog yang terjadi setelah itu pendek, tetapi menancap. 'Kamu tidak paham akibatnya,' kata suara yang menahan panik. Naya menjawab pelan, 'Mungkin. Tapi kalian terlalu lama memakai kata akibat untuk menutup kata dosa.' Ruangan mendadak sempit. Marwah memalingkan muka, seolah kalimat itu mengenai bagian dirinya yang paling ia sembunyikan. Di luar, suara santri mengaji terdengar jauh, bersih, hampir tidak cocok dengan kebusukan yang pelan-pelan muncul di balik dinding. Naya mendadak paham mengapa ibunya dulu selalu memilih duduk di belakang, dekat pintu keluar.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Makin malam, tekanan makin rapi. Ada yang mengunci pintu, ada yang memindahkan map, ada yang mengirim pesan tanpa nama. Naya mulai membedakan takut yang melumpuhkan dan takut yang memberi tenaga. Ia mencatat urutan kejadian dalam kepala: siapa datang lebih dulu, siapa terlalu cepat tahu, siapa pura-pura kaget, siapa menyebut nama Laila dengan suara seperti meminta ampun. Jika suatu hari ia harus berdiri di depan semua orang, ia tidak boleh hanya membawa tangis. Ia harus membawa urutan, tanggal, suara, dan bukti yang tidak bisa dipelintir menjadi cerita anak durhaka.",
      "Menjelang akhir babak itu, Marwah berkata besok ia akan membuka Bilik Ketujuh sendiri. Naya tidak langsung bergerak. Tubuhnya ingin lari, tetapi sesuatu di dalam dirinya justru menjadi tenang, seperti orang yang akhirnya melihat bentuk musuh setelah lama dipukul dari gelap. Ia menggenggam bukti yang tersisa, menatap lorong, lalu berbisik pada nama ibunya tanpa suara. Besok mereka mungkin menuduhnya. Besok ia mungkin terusir. Besok orang-orang yang terlihat saleh bisa menunjukkan wajah asli. Namun malam ini satu hal pasti: pintu yang pernah ditutup untuk Laila mulai terbuka untuk Naya."
    ],
    "wordCount": 879,
    "sceneCount": 4,
    "reveals": [],
    "newNamedCharacters": [],
    "proposedStateDelta": {
      "chapter41_progress": true,
      "tension": true
    },
    "dialogue": [
      {
        "characterId": "char:naya",
        "text": "Aku tidak pulang untuk jadi anak baik di depan kebohongan."
      },
      {
        "characterId": "char:ustazah-marwah",
        "text": "Kalau kamu terus membuka pintu itu, tidak semua orang bisa diselamatkan."
      }
    ],
    "emotionBeats": [
      {
        "characterId": "char:naya",
        "targetCharacterId": "char:ustazah-marwah",
        "valence": "neutral"
      }
    ]
  },
  {
    "chapterNumber": 42,
    "title": "Desa Mulai Berpihak",
    "phase": "ACT_7_REKAMAN_DAN_PENGAKUAN",
    "chapterGoal": "Menggerakkan konflik Bilik Ketujuh melalui warga membawa salinan artikel Nadine dan tekanan utama: Jamal menyebar uang agar orang tetap diam.",
    "mandatoryBeats": [
      "warga membawa salinan artikel Nadine",
      "Jamal menyebar uang agar orang tetap diam",
      "Salma memimpin santri putri membaca nama anak hilang",
      "seorang ibu tua menyerahkan foto Laila yang belum pernah dilihat"
    ],
    "cast": [
      "char:naya",
      "char:salma",
      "char:nadine",
      "char:jamal"
    ],
    "threadIds": [
      "thread:kematian-laila",
      "thread:kunci-wakaf"
    ],
    "paragraphs": [
      "Pasar pagi yang biasanya membuang muka tidak pernah terasa benar bagi Naya. Setiap sudutnya seperti menyimpan napas orang yang menunggu dipanggil, sementara warga membawa salinan artikel Nadine terletak di hadapannya dengan tenang yang nyaris mengejek. Naya mencoba mengingat pesan ibunya: jangan takut pada pintu, takutlah pada orang yang menyuruhmu tidak bertanya. Tetapi pesan itu dulu hanya terdengar seperti nasihat untuk anak kecil yang sering kehilangan sandal di masjid. Sekarang, di usia yang memaksa dirinya terlihat dewasa, kalimat itu berubah menjadi pisau. Ia berdiri terlalu lama, sampai suara sandal dari arah belakang membuat tengkuknya menegang.",
      "Jamal menyebar uang agar orang tetap diam. Kalimat itu datang tidak selalu dengan teriakan; justru semakin pelan diucapkan, semakin jelas ancamannya. Naya tahu ada orang-orang yang menguasai tempat ini bukan karena mereka benar, melainkan karena semua orang sudah terbiasa menunduk. Ia menatap wajah Salma, mencari celah yang bisa dibaca, tetapi yang ia temukan hanya kegelisahan yang disembunyikan di balik sikap biasa. Di pesantren, kebohongan tidak memakai pakaian hitam. Ia memakai senyum ustazah, kitab yang ditutup mendadak, dan aturan yang baru disebut setelah seseorang hampir menemukan jawaban.",
      "Salma memimpin santri putri membaca nama anak hilang. Bantuan itu kecil, hampir tidak pantas disebut pertolongan, namun bagi Naya yang mulai kehabisan tempat berpijak, hal kecil bisa terasa seperti tangan di tepi sumur. Ia menyimpan napas, mendengar bunyi malam, dan membiarkan dirinya membaca ulang semua kejadian sejak pulang. Kenapa semua orang tahu nama ibunya, tetapi tidak seorang pun berani mengucapkannya dengan wajar? Kenapa setiap arsip tentang Laila selalu punya bekas sobekan? Nadine pernah berkata bahwa beberapa keluarga tidak runtuh karena miskin, melainkan karena terlalu lama menyimpan malu milik orang lain.",
      "Petunjuk tentang warga membawa salinan artikel Nadine membuat Naya sadar bahwa misteri ini tidak berdiri sendiri. Ada tanah wakaf, nama anak-anak yang dipindahkan, para pengurus yang takut kehilangan muka, dan keluarga yang dibiarkan patah agar bangunan pesantren tetap terlihat kokoh. Ia ingat tiga jalan yang sejak awal membayanginya: menggali sendiri sampai kebenaran telanjang, patuh sebentar untuk memancing pengakuan, atau keluar dari pagar agar bukti tidak ikut dikubur. Pilihan itu tidak pernah benar-benar bersih. Jalan pertama bisa menghancurkan orang yang masih ingin ia percaya. Jalan kedua bisa menjadikannya alat para pembohong. Jalan ketiga bisa membuatnya kehilangan akses pada semua pintu yang baru mulai terbuka. Namun diam jelas bukan pilihan; diam adalah bahasa yang selama ini dipakai untuk mengubur Laila.",
      "Ketika Naya menyentuh bukti itu, Naya melihat kebenaran tumbuh menjadi keberanian bersama. Dadanya terasa seperti dipenuhi air yang tidak menemukan jalan keluar. Ia marah pada ibunya karena meninggalkan teka-teki, marah pada ayah yang entah hidup atau mati, marah pada Marwah yang selalu berbicara seolah luka orang lain adalah urusan administrasi. Tetapi paling dalam, Naya marah pada dirinya sendiri karena masih ingin seseorang berkata bahwa semua ini salah paham. Anak yang kehilangan ibu kadang tidak mencari kebenaran dulu; ia mencari satu orang dewasa yang bersedia mengaku telah gagal melindunginya.",
      "Dialog yang terjadi setelah itu pendek, tetapi menancap. 'Kamu tidak paham akibatnya,' kata suara yang menahan panik. Naya menjawab pelan, 'Mungkin. Tapi kalian terlalu lama memakai kata akibat untuk menutup kata dosa.' Ruangan mendadak sempit. Salma memalingkan muka, seolah kalimat itu mengenai bagian dirinya yang paling ia sembunyikan. Di luar, suara santri mengaji terdengar jauh, bersih, hampir tidak cocok dengan kebusukan yang pelan-pelan muncul di balik dinding. Naya mendadak paham mengapa ibunya dulu selalu memilih duduk di belakang, dekat pintu keluar.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Makin malam, tekanan makin rapi. Ada yang mengunci pintu, ada yang memindahkan map, ada yang mengirim pesan tanpa nama. Naya mulai membedakan takut yang melumpuhkan dan takut yang memberi tenaga. Ia mencatat urutan kejadian dalam kepala: siapa datang lebih dulu, siapa terlalu cepat tahu, siapa pura-pura kaget, siapa menyebut nama Laila dengan suara seperti meminta ampun. Jika suatu hari ia harus berdiri di depan semua orang, ia tidak boleh hanya membawa tangis. Ia harus membawa urutan, tanggal, suara, dan bukti yang tidak bisa dipelintir menjadi cerita anak durhaka.",
      "Menjelang akhir babak itu, seorang ibu tua menyerahkan foto Laila yang belum pernah dilihat. Naya tidak langsung bergerak. Tubuhnya ingin lari, tetapi sesuatu di dalam dirinya justru menjadi tenang, seperti orang yang akhirnya melihat bentuk musuh setelah lama dipukul dari gelap. Ia menggenggam bukti yang tersisa, menatap lorong, lalu berbisik pada nama ibunya tanpa suara. Besok mereka mungkin menuduhnya. Besok ia mungkin terusir. Besok orang-orang yang terlihat saleh bisa menunjukkan wajah asli. Namun malam ini satu hal pasti: pintu yang pernah ditutup untuk Laila mulai terbuka untuk Naya."
    ],
    "wordCount": 879,
    "sceneCount": 4,
    "reveals": [],
    "newNamedCharacters": [],
    "proposedStateDelta": {
      "chapter42_progress": true,
      "tension": true
    },
    "dialogue": [
      {
        "characterId": "char:naya",
        "text": "Aku tidak pulang untuk jadi anak baik di depan kebohongan."
      },
      {
        "characterId": "char:salma",
        "text": "Kalau kamu terus membuka pintu itu, tidak semua orang bisa diselamatkan."
      }
    ],
    "emotionBeats": [
      {
        "characterId": "char:naya",
        "targetCharacterId": "char:salma",
        "valence": "neutral"
      }
    ]
  },
  {
    "chapterNumber": 43,
    "title": "Naya di Hadapan Dewan",
    "phase": "ACT_7_REKAMAN_DAN_PENGAKUAN",
    "chapterGoal": "Menggerakkan konflik Bilik Ketujuh melalui meja dewan wakaf dengan mikrofon menyala dan tekanan utama: Sastro meminta Naya bicara tanpa menyerang nama pesantren.",
    "mandatoryBeats": [
      "meja dewan wakaf dengan mikrofon menyala",
      "Sastro meminta Naya bicara tanpa menyerang nama pesantren",
      "Kyai Hamid duduk pucat di samping Jamal",
      "pengeras suara tiba-tiba memutar potongan suara Laila"
    ],
    "cast": [
      "char:naya",
      "char:pak-sastro",
      "char:kyai-hamid",
      "char:jamal"
    ],
    "threadIds": [
      "thread:kunci-wakaf",
      "thread:kematian-laila"
    ],
    "paragraphs": [
      "Aula pesantren yang dipenuhi warga tidak pernah terasa benar bagi Naya. Setiap sudutnya seperti menyimpan napas orang yang menunggu dipanggil, sementara meja dewan wakaf dengan mikrofon menyala terletak di hadapannya dengan tenang yang nyaris mengejek. Naya mencoba mengingat pesan ibunya: jangan takut pada pintu, takutlah pada orang yang menyuruhmu tidak bertanya. Tetapi pesan itu dulu hanya terdengar seperti nasihat untuk anak kecil yang sering kehilangan sandal di masjid. Sekarang, di usia yang memaksa dirinya terlihat dewasa, kalimat itu berubah menjadi pisau. Ia berdiri terlalu lama, sampai suara sandal dari arah belakang membuat tengkuknya menegang.",
      "Sastro meminta Naya bicara tanpa menyerang nama pesantren. Kalimat itu datang tidak selalu dengan teriakan; justru semakin pelan diucapkan, semakin jelas ancamannya. Naya tahu ada orang-orang yang menguasai tempat ini bukan karena mereka benar, melainkan karena semua orang sudah terbiasa menunduk. Ia menatap wajah Sastro, mencari celah yang bisa dibaca, tetapi yang ia temukan hanya kegelisahan yang disembunyikan di balik sikap biasa. Di pesantren, kebohongan tidak memakai pakaian hitam. Ia memakai senyum ustazah, kitab yang ditutup mendadak, dan aturan yang baru disebut setelah seseorang hampir menemukan jawaban.",
      "Kyai Hamid duduk pucat di samping Jamal. Bantuan itu kecil, hampir tidak pantas disebut pertolongan, namun bagi Naya yang mulai kehabisan tempat berpijak, hal kecil bisa terasa seperti tangan di tepi sumur. Ia menyimpan napas, mendengar bunyi malam, dan membiarkan dirinya membaca ulang semua kejadian sejak pulang. Kenapa semua orang tahu nama ibunya, tetapi tidak seorang pun berani mengucapkannya dengan wajar? Kenapa setiap arsip tentang Laila selalu punya bekas sobekan? Hamid pernah berkata bahwa beberapa keluarga tidak runtuh karena miskin, melainkan karena terlalu lama menyimpan malu milik orang lain.",
      "Petunjuk tentang meja dewan wakaf dengan mikrofon menyala membuat Naya sadar bahwa misteri ini tidak berdiri sendiri. Ada tanah wakaf, nama anak-anak yang dipindahkan, para pengurus yang takut kehilangan muka, dan keluarga yang dibiarkan patah agar bangunan pesantren tetap terlihat kokoh. Ia ingat tiga jalan yang sejak awal membayanginya: menggali sendiri sampai kebenaran telanjang, patuh sebentar untuk memancing pengakuan, atau keluar dari pagar agar bukti tidak ikut dikubur. Pilihan itu tidak pernah benar-benar bersih. Jalan pertama bisa menghancurkan orang yang masih ingin ia percaya. Jalan kedua bisa menjadikannya alat para pembohong. Jalan ketiga bisa membuatnya kehilangan akses pada semua pintu yang baru mulai terbuka. Namun diam jelas bukan pilihan; diam adalah bahasa yang selama ini dipakai untuk mengubur Laila.",
      "Ketika Naya menyentuh bukti itu, Naya memilih kata yang menyelamatkan santri tanpa menyelamatkan pelaku. Dadanya terasa seperti dipenuhi air yang tidak menemukan jalan keluar. Ia marah pada ibunya karena meninggalkan teka-teki, marah pada ayah yang entah hidup atau mati, marah pada Marwah yang selalu berbicara seolah luka orang lain adalah urusan administrasi. Tetapi paling dalam, Naya marah pada dirinya sendiri karena masih ingin seseorang berkata bahwa semua ini salah paham. Anak yang kehilangan ibu kadang tidak mencari kebenaran dulu; ia mencari satu orang dewasa yang bersedia mengaku telah gagal melindunginya.",
      "Dialog yang terjadi setelah itu pendek, tetapi menancap. 'Kamu tidak paham akibatnya,' kata suara yang menahan panik. Naya menjawab pelan, 'Mungkin. Tapi kalian terlalu lama memakai kata akibat untuk menutup kata dosa.' Ruangan mendadak sempit. Sastro memalingkan muka, seolah kalimat itu mengenai bagian dirinya yang paling ia sembunyikan. Di luar, suara santri mengaji terdengar jauh, bersih, hampir tidak cocok dengan kebusukan yang pelan-pelan muncul di balik dinding. Naya mendadak paham mengapa ibunya dulu selalu memilih duduk di belakang, dekat pintu keluar.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Makin malam, tekanan makin rapi. Ada yang mengunci pintu, ada yang memindahkan map, ada yang mengirim pesan tanpa nama. Naya mulai membedakan takut yang melumpuhkan dan takut yang memberi tenaga. Ia mencatat urutan kejadian dalam kepala: siapa datang lebih dulu, siapa terlalu cepat tahu, siapa pura-pura kaget, siapa menyebut nama Laila dengan suara seperti meminta ampun. Jika suatu hari ia harus berdiri di depan semua orang, ia tidak boleh hanya membawa tangis. Ia harus membawa urutan, tanggal, suara, dan bukti yang tidak bisa dipelintir menjadi cerita anak durhaka.",
      "Menjelang akhir babak itu, pengeras suara tiba-tiba memutar potongan suara Laila. Naya tidak langsung bergerak. Tubuhnya ingin lari, tetapi sesuatu di dalam dirinya justru menjadi tenang, seperti orang yang akhirnya melihat bentuk musuh setelah lama dipukul dari gelap. Ia menggenggam bukti yang tersisa, menatap lorong, lalu berbisik pada nama ibunya tanpa suara. Besok mereka mungkin menuduhnya. Besok ia mungkin terusir. Besok orang-orang yang terlihat saleh bisa menunjukkan wajah asli. Namun malam ini satu hal pasti: pintu yang pernah ditutup untuk Laila mulai terbuka untuk Naya."
    ],
    "wordCount": 879,
    "sceneCount": 4,
    "reveals": [],
    "newNamedCharacters": [],
    "proposedStateDelta": {
      "chapter43_progress": true,
      "tension": true
    },
    "dialogue": [
      {
        "characterId": "char:naya",
        "text": "Aku tidak pulang untuk jadi anak baik di depan kebohongan."
      },
      {
        "characterId": "char:pak-sastro",
        "text": "Kalau kamu terus membuka pintu itu, tidak semua orang bisa diselamatkan."
      }
    ],
    "emotionBeats": [
      {
        "characterId": "char:naya",
        "targetCharacterId": "char:pak-sastro",
        "valence": "neutral"
      }
    ]
  },
  {
    "chapterNumber": 44,
    "title": "Rekaman di Bilik Ketujuh",
    "phase": "ACT_7_REKAMAN_DAN_PENGAKUAN",
    "chapterGoal": "Menggerakkan konflik Bilik Ketujuh melalui mesin perekam tua di balik lemari palsu dan tekanan utama: Marwah mengakui ia menyimpan rekaman untuk menunggu waktu.",
    "mandatoryBeats": [
      "mesin perekam tua di balik lemari palsu",
      "Marwah mengakui ia menyimpan rekaman untuk menunggu waktu",
      "Nadine memastikan suara Laila tersalin ke tiga perangkat",
      "rekaman menyebut nama Jamal dan seorang anggota dewan yang belum bicara"
    ],
    "cast": [
      "char:naya",
      "char:ustazah-marwah",
      "char:nadine",
      "char:jamal"
    ],
    "threadIds": [
      "thread:bilik-ketujuh",
      "thread:kunci-wakaf"
    ],
    "paragraphs": [
      "Bilik ketujuh yang akhirnya terang tidak pernah terasa benar bagi Naya. Setiap sudutnya seperti menyimpan napas orang yang menunggu dipanggil, sementara mesin perekam tua di balik lemari palsu terletak di hadapannya dengan tenang yang nyaris mengejek. Naya mencoba mengingat pesan ibunya: jangan takut pada pintu, takutlah pada orang yang menyuruhmu tidak bertanya. Tetapi pesan itu dulu hanya terdengar seperti nasihat untuk anak kecil yang sering kehilangan sandal di masjid. Sekarang, di usia yang memaksa dirinya terlihat dewasa, kalimat itu berubah menjadi pisau. Ia berdiri terlalu lama, sampai suara sandal dari arah belakang membuat tengkuknya menegang.",
      "Marwah mengakui ia menyimpan rekaman untuk menunggu waktu. Kalimat itu datang tidak selalu dengan teriakan; justru semakin pelan diucapkan, semakin jelas ancamannya. Naya tahu ada orang-orang yang menguasai tempat ini bukan karena mereka benar, melainkan karena semua orang sudah terbiasa menunduk. Ia menatap wajah Marwah, mencari celah yang bisa dibaca, tetapi yang ia temukan hanya kegelisahan yang disembunyikan di balik sikap biasa. Di pesantren, kebohongan tidak memakai pakaian hitam. Ia memakai senyum ustazah, kitab yang ditutup mendadak, dan aturan yang baru disebut setelah seseorang hampir menemukan jawaban.",
      "Nadine memastikan suara Laila tersalin ke tiga perangkat. Bantuan itu kecil, hampir tidak pantas disebut pertolongan, namun bagi Naya yang mulai kehabisan tempat berpijak, hal kecil bisa terasa seperti tangan di tepi sumur. Ia menyimpan napas, mendengar bunyi malam, dan membiarkan dirinya membaca ulang semua kejadian sejak pulang. Kenapa semua orang tahu nama ibunya, tetapi tidak seorang pun berani mengucapkannya dengan wajar? Kenapa setiap arsip tentang Laila selalu punya bekas sobekan? Nadine pernah berkata bahwa beberapa keluarga tidak runtuh karena miskin, melainkan karena terlalu lama menyimpan malu milik orang lain.",
      "Petunjuk tentang mesin perekam tua di balik lemari palsu membuat Naya sadar bahwa misteri ini tidak berdiri sendiri. Ada tanah wakaf, nama anak-anak yang dipindahkan, para pengurus yang takut kehilangan muka, dan keluarga yang dibiarkan patah agar bangunan pesantren tetap terlihat kokoh. Ia ingat tiga jalan yang sejak awal membayanginya: menggali sendiri sampai kebenaran telanjang, patuh sebentar untuk memancing pengakuan, atau keluar dari pagar agar bukti tidak ikut dikubur. Pilihan itu tidak pernah benar-benar bersih. Jalan pertama bisa menghancurkan orang yang masih ingin ia percaya. Jalan kedua bisa menjadikannya alat para pembohong. Jalan ketiga bisa membuatnya kehilangan akses pada semua pintu yang baru mulai terbuka. Namun diam jelas bukan pilihan; diam adalah bahasa yang selama ini dipakai untuk mengubur Laila.",
      "Ketika Naya menyentuh bukti itu, Naya mendengar ibunya hidup kembali sebagai bukti. Dadanya terasa seperti dipenuhi air yang tidak menemukan jalan keluar. Ia marah pada ibunya karena meninggalkan teka-teki, marah pada ayah yang entah hidup atau mati, marah pada Marwah yang selalu berbicara seolah luka orang lain adalah urusan administrasi. Tetapi paling dalam, Naya marah pada dirinya sendiri karena masih ingin seseorang berkata bahwa semua ini salah paham. Anak yang kehilangan ibu kadang tidak mencari kebenaran dulu; ia mencari satu orang dewasa yang bersedia mengaku telah gagal melindunginya.",
      "Dialog yang terjadi setelah itu pendek, tetapi menancap. 'Kamu tidak paham akibatnya,' kata suara yang menahan panik. Naya menjawab pelan, 'Mungkin. Tapi kalian terlalu lama memakai kata akibat untuk menutup kata dosa.' Ruangan mendadak sempit. Marwah memalingkan muka, seolah kalimat itu mengenai bagian dirinya yang paling ia sembunyikan. Di luar, suara santri mengaji terdengar jauh, bersih, hampir tidak cocok dengan kebusukan yang pelan-pelan muncul di balik dinding. Naya mendadak paham mengapa ibunya dulu selalu memilih duduk di belakang, dekat pintu keluar.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Makin malam, tekanan makin rapi. Ada yang mengunci pintu, ada yang memindahkan map, ada yang mengirim pesan tanpa nama. Naya mulai membedakan takut yang melumpuhkan dan takut yang memberi tenaga. Ia mencatat urutan kejadian dalam kepala: siapa datang lebih dulu, siapa terlalu cepat tahu, siapa pura-pura kaget, siapa menyebut nama Laila dengan suara seperti meminta ampun. Jika suatu hari ia harus berdiri di depan semua orang, ia tidak boleh hanya membawa tangis. Ia harus membawa urutan, tanggal, suara, dan bukti yang tidak bisa dipelintir menjadi cerita anak durhaka. Yang terbuka bukan sekadar petunjuk, melainkan rahasia yang mengubah cara Naya membaca semua babak sebelumnya.",
      "Menjelang akhir babak itu, rekaman menyebut nama Jamal dan seorang anggota dewan yang belum bicara. Naya tidak langsung bergerak. Tubuhnya ingin lari, tetapi sesuatu di dalam dirinya justru menjadi tenang, seperti orang yang akhirnya melihat bentuk musuh setelah lama dipukul dari gelap. Ia menggenggam bukti yang tersisa, menatap lorong, lalu berbisik pada nama ibunya tanpa suara. Besok mereka mungkin menuduhnya. Besok ia mungkin terusir. Besok orang-orang yang terlihat saleh bisa menunjukkan wajah asli. Namun malam ini satu hal pasti: pintu yang pernah ditutup untuk Laila mulai terbuka untuk Naya."
    ],
    "wordCount": 826,
    "sceneCount": 4,
    "reveals": [
      "secret:rekaman-bilik-ketujuh"
    ],
    "newNamedCharacters": [],
    "proposedStateDelta": {
      "chapter44_progress": true,
      "tension": true,
      "revealed_rekaman_bilik_ketujuh": true
    },
    "dialogue": [
      {
        "characterId": "char:naya",
        "text": "Aku tidak pulang untuk jadi anak baik di depan kebohongan."
      },
      {
        "characterId": "char:ustazah-marwah",
        "text": "Kalau kamu terus membuka pintu itu, tidak semua orang bisa diselamatkan."
      }
    ],
    "emotionBeats": [
      {
        "characterId": "char:naya",
        "targetCharacterId": "char:ustazah-marwah",
        "valence": "neutral"
      }
    ]
  },
  {
    "chapterNumber": 45,
    "title": "Pilihan Akhir Keluarga",
    "phase": "ACT_7_REKAMAN_DAN_PENGAKUAN",
    "chapterGoal": "Menggerakkan konflik Bilik Ketujuh melalui rekaman penuh malam terakhir Laila dan tekanan utama: Marwah menawarkan diri menanggung semua agar Hamid dan pesantren selamat.",
    "mandatoryBeats": [
      "rekaman penuh malam terakhir Laila",
      "Marwah menawarkan diri menanggung semua agar Hamid dan pesantren selamat",
      "Arman meminta keadilan tanpa kesepakatan gelap",
      "di luar aula polisi dan wali santri tiba bersamaan"
    ],
    "cast": [
      "char:naya",
      "char:ustazah-marwah",
      "char:arman",
      "char:kyai-hamid"
    ],
    "threadIds": [
      "thread:kematian-laila",
      "thread:kunci-wakaf"
    ],
    "paragraphs": [
      "Aula yang berubah menjadi ruang pengakuan tidak pernah terasa benar bagi Naya. Setiap sudutnya seperti menyimpan napas orang yang menunggu dipanggil, sementara rekaman penuh malam terakhir Laila terletak di hadapannya dengan tenang yang nyaris mengejek. Naya mencoba mengingat pesan ibunya: jangan takut pada pintu, takutlah pada orang yang menyuruhmu tidak bertanya. Tetapi pesan itu dulu hanya terdengar seperti nasihat untuk anak kecil yang sering kehilangan sandal di masjid. Sekarang, di usia yang memaksa dirinya terlihat dewasa, kalimat itu berubah menjadi pisau. Ia berdiri terlalu lama, sampai suara sandal dari arah belakang membuat tengkuknya menegang.",
      "Marwah menawarkan diri menanggung semua agar Hamid dan pesantren selamat. Kalimat itu datang tidak selalu dengan teriakan; justru semakin pelan diucapkan, semakin jelas ancamannya. Naya tahu ada orang-orang yang menguasai tempat ini bukan karena mereka benar, melainkan karena semua orang sudah terbiasa menunduk. Ia menatap wajah Marwah, mencari celah yang bisa dibaca, tetapi yang ia temukan hanya kegelisahan yang disembunyikan di balik sikap biasa. Di pesantren, kebohongan tidak memakai pakaian hitam. Ia memakai senyum ustazah, kitab yang ditutup mendadak, dan aturan yang baru disebut setelah seseorang hampir menemukan jawaban.",
      "Arman meminta keadilan tanpa kesepakatan gelap. Bantuan itu kecil, hampir tidak pantas disebut pertolongan, namun bagi Naya yang mulai kehabisan tempat berpijak, hal kecil bisa terasa seperti tangan di tepi sumur. Ia menyimpan napas, mendengar bunyi malam, dan membiarkan dirinya membaca ulang semua kejadian sejak pulang. Kenapa semua orang tahu nama ibunya, tetapi tidak seorang pun berani mengucapkannya dengan wajar? Kenapa setiap arsip tentang Laila selalu punya bekas sobekan? Arman pernah berkata bahwa beberapa keluarga tidak runtuh karena miskin, melainkan karena terlalu lama menyimpan malu milik orang lain.",
      "Petunjuk tentang rekaman penuh malam terakhir Laila membuat Naya sadar bahwa misteri ini tidak berdiri sendiri. Ada tanah wakaf, nama anak-anak yang dipindahkan, para pengurus yang takut kehilangan muka, dan keluarga yang dibiarkan patah agar bangunan pesantren tetap terlihat kokoh. Malam itu cerita memberinya simpang yang tidak sopan: membongkar sekarang, mengikuti aturan yang mungkin busuk, atau menyelamatkan bukti dengan cara yang membuatnya tampak bersalah. Pilihan itu tidak pernah benar-benar bersih. Jalan pertama bisa menghancurkan orang yang masih ingin ia percaya. Jalan kedua bisa menjadikannya alat para pembohong. Jalan ketiga bisa membuatnya kehilangan akses pada semua pintu yang baru mulai terbuka. Namun diam jelas bukan pilihan; diam adalah bahasa yang selama ini dipakai untuk mengubur Laila.",
      "Ketika Naya menyentuh bukti itu, Naya harus memilih membongkar semua atau menyusun pengakuan bertahap. Dadanya terasa seperti dipenuhi air yang tidak menemukan jalan keluar. Ia marah pada ibunya karena meninggalkan teka-teki, marah pada ayah yang entah hidup atau mati, marah pada Marwah yang selalu berbicara seolah luka orang lain adalah urusan administrasi. Tetapi paling dalam, Naya marah pada dirinya sendiri karena masih ingin seseorang berkata bahwa semua ini salah paham. Anak yang kehilangan ibu kadang tidak mencari kebenaran dulu; ia mencari satu orang dewasa yang bersedia mengaku telah gagal melindunginya.",
      "Dialog yang terjadi setelah itu pendek, tetapi menancap. 'Kamu tidak paham akibatnya,' kata suara yang menahan panik. Naya menjawab pelan, 'Mungkin. Tapi kalian terlalu lama memakai kata akibat untuk menutup kata dosa.' Ruangan mendadak sempit. Marwah memalingkan muka, seolah kalimat itu mengenai bagian dirinya yang paling ia sembunyikan. Di luar, suara santri mengaji terdengar jauh, bersih, hampir tidak cocok dengan kebusukan yang pelan-pelan muncul di balik dinding. Naya mendadak paham mengapa ibunya dulu selalu memilih duduk di belakang, dekat pintu keluar.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Makin malam, tekanan makin rapi. Ada yang mengunci pintu, ada yang memindahkan map, ada yang mengirim pesan tanpa nama. Naya mulai membedakan takut yang melumpuhkan dan takut yang memberi tenaga. Ia mencatat urutan kejadian dalam kepala: siapa datang lebih dulu, siapa terlalu cepat tahu, siapa pura-pura kaget, siapa menyebut nama Laila dengan suara seperti meminta ampun. Jika suatu hari ia harus berdiri di depan semua orang, ia tidak boleh hanya membawa tangis. Ia harus membawa urutan, tanggal, suara, dan bukti yang tidak bisa dipelintir menjadi cerita anak durhaka. Yang terbuka bukan sekadar petunjuk, melainkan rahasia yang mengubah cara Naya membaca semua babak sebelumnya.",
      "Menjelang akhir babak itu, di luar aula polisi dan wali santri tiba bersamaan. Naya tidak langsung bergerak. Tubuhnya ingin lari, tetapi sesuatu di dalam dirinya justru menjadi tenang, seperti orang yang akhirnya melihat bentuk musuh setelah lama dipukul dari gelap. Ia menggenggam bukti yang tersisa, menatap lorong, lalu berbisik pada nama ibunya tanpa suara. Besok mereka mungkin menuduhnya. Besok ia mungkin terusir. Besok orang-orang yang terlihat saleh bisa menunjukkan wajah asli. Namun malam ini satu hal pasti: pintu yang pernah ditutup untuk Laila mulai terbuka untuk Naya."
    ],
    "wordCount": 820,
    "sceneCount": 4,
    "reveals": [
      "secret:pengakuan-terakhir"
    ],
    "newNamedCharacters": [],
    "proposedStateDelta": {
      "chapter45_progress": true,
      "tension": true,
      "choice_chapter_45": true,
      "revealed_pengakuan_terakhir": true
    },
    "dialogue": [
      {
        "characterId": "char:naya",
        "text": "Aku tidak pulang untuk jadi anak baik di depan kebohongan."
      },
      {
        "characterId": "char:ustazah-marwah",
        "text": "Kalau kamu terus membuka pintu itu, tidak semua orang bisa diselamatkan."
      }
    ],
    "emotionBeats": [
      {
        "characterId": "char:naya",
        "targetCharacterId": "char:ustazah-marwah",
        "valence": "neutral"
      }
    ]
  },
  {
    "chapterNumber": 46,
    "title": "Setelah Pengakuan",
    "phase": "ACT_8_PEMULIHAN_NAMA",
    "chapterGoal": "Menggerakkan konflik Bilik Ketujuh melalui surat penonaktifan pengurus lama dan tekanan utama: Jamal mencoba kabur sebelum warga menutup gerbang.",
    "mandatoryBeats": [
      "surat penonaktifan pengurus lama",
      "Jamal mencoba kabur sebelum warga menutup gerbang",
      "Hafiz menyerahkan diri karena pernah menyembunyikan bukti",
      "Marwah meninggalkan tasbih Laila di tangan Naya"
    ],
    "cast": [
      "char:naya",
      "char:hafiz",
      "char:ustazah-marwah",
      "char:jamal"
    ],
    "threadIds": [
      "thread:kunci-wakaf",
      "thread:loyalitas-hafiz"
    ],
    "paragraphs": [
      "Halaman pesantren setelah malam panjang tidak pernah terasa benar bagi Naya. Setiap sudutnya seperti menyimpan napas orang yang menunggu dipanggil, sementara surat penonaktifan pengurus lama terletak di hadapannya dengan tenang yang nyaris mengejek. Naya mencoba mengingat pesan ibunya: jangan takut pada pintu, takutlah pada orang yang menyuruhmu tidak bertanya. Tetapi pesan itu dulu hanya terdengar seperti nasihat untuk anak kecil yang sering kehilangan sandal di masjid. Sekarang, di usia yang memaksa dirinya terlihat dewasa, kalimat itu berubah menjadi pisau. Ia berdiri terlalu lama, sampai suara sandal dari arah belakang membuat tengkuknya menegang.",
      "Jamal mencoba kabur sebelum warga menutup gerbang. Kalimat itu datang tidak selalu dengan teriakan; justru semakin pelan diucapkan, semakin jelas ancamannya. Naya tahu ada orang-orang yang menguasai tempat ini bukan karena mereka benar, melainkan karena semua orang sudah terbiasa menunduk. Ia menatap wajah Hafiz, mencari celah yang bisa dibaca, tetapi yang ia temukan hanya kegelisahan yang disembunyikan di balik sikap biasa. Di pesantren, kebohongan tidak memakai pakaian hitam. Ia memakai senyum ustazah, kitab yang ditutup mendadak, dan aturan yang baru disebut setelah seseorang hampir menemukan jawaban.",
      "Hafiz menyerahkan diri karena pernah menyembunyikan bukti. Bantuan itu kecil, hampir tidak pantas disebut pertolongan, namun bagi Naya yang mulai kehabisan tempat berpijak, hal kecil bisa terasa seperti tangan di tepi sumur. Ia menyimpan napas, mendengar bunyi malam, dan membiarkan dirinya membaca ulang semua kejadian sejak pulang. Kenapa semua orang tahu nama ibunya, tetapi tidak seorang pun berani mengucapkannya dengan wajar? Kenapa setiap arsip tentang Laila selalu punya bekas sobekan? Marwah pernah berkata bahwa beberapa keluarga tidak runtuh karena miskin, melainkan karena terlalu lama menyimpan malu milik orang lain.",
      "Petunjuk tentang surat penonaktifan pengurus lama membuat Naya sadar bahwa misteri ini tidak berdiri sendiri. Ada tanah wakaf, nama anak-anak yang dipindahkan, para pengurus yang takut kehilangan muka, dan keluarga yang dibiarkan patah agar bangunan pesantren tetap terlihat kokoh. Ia ingat tiga jalan yang sejak awal membayanginya: menggali sendiri sampai kebenaran telanjang, patuh sebentar untuk memancing pengakuan, atau keluar dari pagar agar bukti tidak ikut dikubur. Pilihan itu tidak pernah benar-benar bersih. Jalan pertama bisa menghancurkan orang yang masih ingin ia percaya. Jalan kedua bisa menjadikannya alat para pembohong. Jalan ketiga bisa membuatnya kehilangan akses pada semua pintu yang baru mulai terbuka. Namun diam jelas bukan pilihan; diam adalah bahasa yang selama ini dipakai untuk mengubur Laila.",
      "Ketika Naya menyentuh bukti itu, Naya belajar bahwa orang baik pun bisa bersalah. Dadanya terasa seperti dipenuhi air yang tidak menemukan jalan keluar. Ia marah pada ibunya karena meninggalkan teka-teki, marah pada ayah yang entah hidup atau mati, marah pada Marwah yang selalu berbicara seolah luka orang lain adalah urusan administrasi. Tetapi paling dalam, Naya marah pada dirinya sendiri karena masih ingin seseorang berkata bahwa semua ini salah paham. Anak yang kehilangan ibu kadang tidak mencari kebenaran dulu; ia mencari satu orang dewasa yang bersedia mengaku telah gagal melindunginya.",
      "Dialog yang terjadi setelah itu pendek, tetapi menancap. 'Kamu tidak paham akibatnya,' kata suara yang menahan panik. Naya menjawab pelan, 'Mungkin. Tapi kalian terlalu lama memakai kata akibat untuk menutup kata dosa.' Ruangan mendadak sempit. Hafiz memalingkan muka, seolah kalimat itu mengenai bagian dirinya yang paling ia sembunyikan. Di luar, suara santri mengaji terdengar jauh, bersih, hampir tidak cocok dengan kebusukan yang pelan-pelan muncul di balik dinding. Naya mendadak paham mengapa ibunya dulu selalu memilih duduk di belakang, dekat pintu keluar.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Makin malam, tekanan makin rapi. Ada yang mengunci pintu, ada yang memindahkan map, ada yang mengirim pesan tanpa nama. Naya mulai membedakan takut yang melumpuhkan dan takut yang memberi tenaga. Ia mencatat urutan kejadian dalam kepala: siapa datang lebih dulu, siapa terlalu cepat tahu, siapa pura-pura kaget, siapa menyebut nama Laila dengan suara seperti meminta ampun. Jika suatu hari ia harus berdiri di depan semua orang, ia tidak boleh hanya membawa tangis. Ia harus membawa urutan, tanggal, suara, dan bukti yang tidak bisa dipelintir menjadi cerita anak durhaka.",
      "Menjelang akhir babak itu, Marwah meninggalkan tasbih Laila di tangan Naya. Naya tidak langsung bergerak. Tubuhnya ingin lari, tetapi sesuatu di dalam dirinya justru menjadi tenang, seperti orang yang akhirnya melihat bentuk musuh setelah lama dipukul dari gelap. Ia menggenggam bukti yang tersisa, menatap lorong, lalu berbisik pada nama ibunya tanpa suara. Besok mereka mungkin menuduhnya. Besok ia mungkin terusir. Besok orang-orang yang terlihat saleh bisa menunjukkan wajah asli. Namun malam ini satu hal pasti: pintu yang pernah ditutup untuk Laila mulai terbuka untuk Naya."
    ],
    "wordCount": 873,
    "sceneCount": 4,
    "reveals": [],
    "newNamedCharacters": [],
    "proposedStateDelta": {
      "chapter46_progress": true,
      "tension": true
    },
    "dialogue": [
      {
        "characterId": "char:naya",
        "text": "Aku tidak pulang untuk jadi anak baik di depan kebohongan."
      },
      {
        "characterId": "char:hafiz",
        "text": "Kalau kamu terus membuka pintu itu, tidak semua orang bisa diselamatkan."
      }
    ],
    "emotionBeats": [
      {
        "characterId": "char:naya",
        "targetCharacterId": "char:hafiz",
        "valence": "neutral"
      }
    ]
  },
  {
    "chapterNumber": 47,
    "title": "Pengadilan Wakaf",
    "phase": "ACT_8_PEMULIHAN_NAMA",
    "chapterGoal": "Menggerakkan konflik Bilik Ketujuh melalui berkas wakaf yang akhirnya masuk berita acara dan tekanan utama: Sastro memberi kesaksian untuk menyelamatkan dirinya.",
    "mandatoryBeats": [
      "berkas wakaf yang akhirnya masuk berita acara",
      "Sastro memberi kesaksian untuk menyelamatkan dirinya",
      "Nadine menolak menulis akhir manis yang palsu",
      "hak tanah pesantren dibekukan sampai audit selesai"
    ],
    "cast": [
      "char:naya",
      "char:pak-sastro",
      "char:nadine"
    ],
    "threadIds": [
      "thread:kunci-wakaf"
    ],
    "paragraphs": [
      "Kantor kecamatan yang panas tidak pernah terasa benar bagi Naya. Setiap sudutnya seperti menyimpan napas orang yang menunggu dipanggil, sementara berkas wakaf yang akhirnya masuk berita acara terletak di hadapannya dengan tenang yang nyaris mengejek. Naya mencoba mengingat pesan ibunya: jangan takut pada pintu, takutlah pada orang yang menyuruhmu tidak bertanya. Tetapi pesan itu dulu hanya terdengar seperti nasihat untuk anak kecil yang sering kehilangan sandal di masjid. Sekarang, di usia yang memaksa dirinya terlihat dewasa, kalimat itu berubah menjadi pisau. Ia berdiri terlalu lama, sampai suara sandal dari arah belakang membuat tengkuknya menegang.",
      "Sastro memberi kesaksian untuk menyelamatkan dirinya. Kalimat itu datang tidak selalu dengan teriakan; justru semakin pelan diucapkan, semakin jelas ancamannya. Naya tahu ada orang-orang yang menguasai tempat ini bukan karena mereka benar, melainkan karena semua orang sudah terbiasa menunduk. Ia menatap wajah Sastro, mencari celah yang bisa dibaca, tetapi yang ia temukan hanya kegelisahan yang disembunyikan di balik sikap biasa. Di pesantren, kebohongan tidak memakai pakaian hitam. Ia memakai senyum ustazah, kitab yang ditutup mendadak, dan aturan yang baru disebut setelah seseorang hampir menemukan jawaban.",
      "Nadine menolak menulis akhir manis yang palsu. Bantuan itu kecil, hampir tidak pantas disebut pertolongan, namun bagi Naya yang mulai kehabisan tempat berpijak, hal kecil bisa terasa seperti tangan di tepi sumur. Ia menyimpan napas, mendengar bunyi malam, dan membiarkan dirinya membaca ulang semua kejadian sejak pulang. Kenapa semua orang tahu nama ibunya, tetapi tidak seorang pun berani mengucapkannya dengan wajar? Kenapa setiap arsip tentang Laila selalu punya bekas sobekan? Nadine pernah berkata bahwa beberapa keluarga tidak runtuh karena miskin, melainkan karena terlalu lama menyimpan malu milik orang lain.",
      "Petunjuk tentang berkas wakaf yang akhirnya masuk berita acara membuat Naya sadar bahwa misteri ini tidak berdiri sendiri. Ada tanah wakaf, nama anak-anak yang dipindahkan, para pengurus yang takut kehilangan muka, dan keluarga yang dibiarkan patah agar bangunan pesantren tetap terlihat kokoh. Ia ingat tiga jalan yang sejak awal membayanginya: menggali sendiri sampai kebenaran telanjang, patuh sebentar untuk memancing pengakuan, atau keluar dari pagar agar bukti tidak ikut dikubur. Pilihan itu tidak pernah benar-benar bersih. Jalan pertama bisa menghancurkan orang yang masih ingin ia percaya. Jalan kedua bisa menjadikannya alat para pembohong. Jalan ketiga bisa membuatnya kehilangan akses pada semua pintu yang baru mulai terbuka. Namun diam jelas bukan pilihan; diam adalah bahasa yang selama ini dipakai untuk mengubur Laila.",
      "Ketika Naya menyentuh bukti itu, Naya ingin keadilan yang jelas bukan sekadar viral. Dadanya terasa seperti dipenuhi air yang tidak menemukan jalan keluar. Ia marah pada ibunya karena meninggalkan teka-teki, marah pada ayah yang entah hidup atau mati, marah pada Marwah yang selalu berbicara seolah luka orang lain adalah urusan administrasi. Tetapi paling dalam, Naya marah pada dirinya sendiri karena masih ingin seseorang berkata bahwa semua ini salah paham. Anak yang kehilangan ibu kadang tidak mencari kebenaran dulu; ia mencari satu orang dewasa yang bersedia mengaku telah gagal melindunginya.",
      "Dialog yang terjadi setelah itu pendek, tetapi menancap. 'Kamu tidak paham akibatnya,' kata suara yang menahan panik. Naya menjawab pelan, 'Mungkin. Tapi kalian terlalu lama memakai kata akibat untuk menutup kata dosa.' Ruangan mendadak sempit. Sastro memalingkan muka, seolah kalimat itu mengenai bagian dirinya yang paling ia sembunyikan. Di luar, suara santri mengaji terdengar jauh, bersih, hampir tidak cocok dengan kebusukan yang pelan-pelan muncul di balik dinding. Naya mendadak paham mengapa ibunya dulu selalu memilih duduk di belakang, dekat pintu keluar.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Makin malam, tekanan makin rapi. Ada yang mengunci pintu, ada yang memindahkan map, ada yang mengirim pesan tanpa nama. Naya mulai membedakan takut yang melumpuhkan dan takut yang memberi tenaga. Ia mencatat urutan kejadian dalam kepala: siapa datang lebih dulu, siapa terlalu cepat tahu, siapa pura-pura kaget, siapa menyebut nama Laila dengan suara seperti meminta ampun. Jika suatu hari ia harus berdiri di depan semua orang, ia tidak boleh hanya membawa tangis. Ia harus membawa urutan, tanggal, suara, dan bukti yang tidak bisa dipelintir menjadi cerita anak durhaka.",
      "Menjelang akhir babak itu, hak tanah pesantren dibekukan sampai audit selesai. Naya tidak langsung bergerak. Tubuhnya ingin lari, tetapi sesuatu di dalam dirinya justru menjadi tenang, seperti orang yang akhirnya melihat bentuk musuh setelah lama dipukul dari gelap. Ia menggenggam bukti yang tersisa, menatap lorong, lalu berbisik pada nama ibunya tanpa suara. Besok mereka mungkin menuduhnya. Besok ia mungkin terusir. Besok orang-orang yang terlihat saleh bisa menunjukkan wajah asli. Namun malam ini satu hal pasti: pintu yang pernah ditutup untuk Laila mulai terbuka untuk Naya."
    ],
    "wordCount": 877,
    "sceneCount": 4,
    "reveals": [],
    "newNamedCharacters": [],
    "proposedStateDelta": {
      "chapter47_progress": true,
      "tension": true
    },
    "dialogue": [
      {
        "characterId": "char:naya",
        "text": "Aku tidak pulang untuk jadi anak baik di depan kebohongan."
      },
      {
        "characterId": "char:pak-sastro",
        "text": "Kalau kamu terus membuka pintu itu, tidak semua orang bisa diselamatkan."
      }
    ],
    "emotionBeats": [
      {
        "characterId": "char:naya",
        "targetCharacterId": "char:pak-sastro",
        "valence": "neutral"
      }
    ]
  },
  {
    "chapterNumber": 48,
    "title": "Pesan Ayah",
    "phase": "ACT_8_PEMULIHAN_NAMA",
    "chapterGoal": "Menggerakkan konflik Bilik Ketujuh melalui surat Arman untuk Naya sebelum pemeriksaan dan tekanan utama: Arman meminta Naya tidak hidup hanya sebagai korban.",
    "mandatoryBeats": [
      "surat Arman untuk Naya sebelum pemeriksaan",
      "Arman meminta Naya tidak hidup hanya sebagai korban",
      "Salma mengajak Naya kembali mengajar anak-anak kecil",
      "di amplop surat ada biji mangga yang dulu ditanam Laila"
    ],
    "cast": [
      "char:naya",
      "char:arman",
      "char:salma"
    ],
    "threadIds": [
      "thread:keluarga-naya"
    ],
    "paragraphs": [
      "Kebun mangga yang mulai dipangkas tidak pernah terasa benar bagi Naya. Setiap sudutnya seperti menyimpan napas orang yang menunggu dipanggil, sementara surat Arman untuk Naya sebelum pemeriksaan terletak di hadapannya dengan tenang yang nyaris mengejek. Naya mencoba mengingat pesan ibunya: jangan takut pada pintu, takutlah pada orang yang menyuruhmu tidak bertanya. Tetapi pesan itu dulu hanya terdengar seperti nasihat untuk anak kecil yang sering kehilangan sandal di masjid. Sekarang, di usia yang memaksa dirinya terlihat dewasa, kalimat itu berubah menjadi pisau. Ia berdiri terlalu lama, sampai suara sandal dari arah belakang membuat tengkuknya menegang.",
      "Arman meminta Naya tidak hidup hanya sebagai korban. Kalimat itu datang tidak selalu dengan teriakan; justru semakin pelan diucapkan, semakin jelas ancamannya. Naya tahu ada orang-orang yang menguasai tempat ini bukan karena mereka benar, melainkan karena semua orang sudah terbiasa menunduk. Ia menatap wajah Arman, mencari celah yang bisa dibaca, tetapi yang ia temukan hanya kegelisahan yang disembunyikan di balik sikap biasa. Di pesantren, kebohongan tidak memakai pakaian hitam. Ia memakai senyum ustazah, kitab yang ditutup mendadak, dan aturan yang baru disebut setelah seseorang hampir menemukan jawaban.",
      "Salma mengajak Naya kembali mengajar anak-anak kecil. Bantuan itu kecil, hampir tidak pantas disebut pertolongan, namun bagi Naya yang mulai kehabisan tempat berpijak, hal kecil bisa terasa seperti tangan di tepi sumur. Ia menyimpan napas, mendengar bunyi malam, dan membiarkan dirinya membaca ulang semua kejadian sejak pulang. Kenapa semua orang tahu nama ibunya, tetapi tidak seorang pun berani mengucapkannya dengan wajar? Kenapa setiap arsip tentang Laila selalu punya bekas sobekan? Salma pernah berkata bahwa beberapa keluarga tidak runtuh karena miskin, melainkan karena terlalu lama menyimpan malu milik orang lain.",
      "Petunjuk tentang surat Arman untuk Naya sebelum pemeriksaan membuat Naya sadar bahwa misteri ini tidak berdiri sendiri. Ada tanah wakaf, nama anak-anak yang dipindahkan, para pengurus yang takut kehilangan muka, dan keluarga yang dibiarkan patah agar bangunan pesantren tetap terlihat kokoh. Ia ingat tiga jalan yang sejak awal membayanginya: menggali sendiri sampai kebenaran telanjang, patuh sebentar untuk memancing pengakuan, atau keluar dari pagar agar bukti tidak ikut dikubur. Pilihan itu tidak pernah benar-benar bersih. Jalan pertama bisa menghancurkan orang yang masih ingin ia percaya. Jalan kedua bisa menjadikannya alat para pembohong. Jalan ketiga bisa membuatnya kehilangan akses pada semua pintu yang baru mulai terbuka. Namun diam jelas bukan pilihan; diam adalah bahasa yang selama ini dipakai untuk mengubur Laila.",
      "Ketika Naya menyentuh bukti itu, Naya memahami pulang bukan selalu kembali ke tempat lama. Dadanya terasa seperti dipenuhi air yang tidak menemukan jalan keluar. Ia marah pada ibunya karena meninggalkan teka-teki, marah pada ayah yang entah hidup atau mati, marah pada Marwah yang selalu berbicara seolah luka orang lain adalah urusan administrasi. Tetapi paling dalam, Naya marah pada dirinya sendiri karena masih ingin seseorang berkata bahwa semua ini salah paham. Anak yang kehilangan ibu kadang tidak mencari kebenaran dulu; ia mencari satu orang dewasa yang bersedia mengaku telah gagal melindunginya.",
      "Dialog yang terjadi setelah itu pendek, tetapi menancap. 'Kamu tidak paham akibatnya,' kata suara yang menahan panik. Naya menjawab pelan, 'Mungkin. Tapi kalian terlalu lama memakai kata akibat untuk menutup kata dosa.' Ruangan mendadak sempit. Arman memalingkan muka, seolah kalimat itu mengenai bagian dirinya yang paling ia sembunyikan. Di luar, suara santri mengaji terdengar jauh, bersih, hampir tidak cocok dengan kebusukan yang pelan-pelan muncul di balik dinding. Naya mendadak paham mengapa ibunya dulu selalu memilih duduk di belakang, dekat pintu keluar.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Makin malam, tekanan makin rapi. Ada yang mengunci pintu, ada yang memindahkan map, ada yang mengirim pesan tanpa nama. Naya mulai membedakan takut yang melumpuhkan dan takut yang memberi tenaga. Ia mencatat urutan kejadian dalam kepala: siapa datang lebih dulu, siapa terlalu cepat tahu, siapa pura-pura kaget, siapa menyebut nama Laila dengan suara seperti meminta ampun. Jika suatu hari ia harus berdiri di depan semua orang, ia tidak boleh hanya membawa tangis. Ia harus membawa urutan, tanggal, suara, dan bukti yang tidak bisa dipelintir menjadi cerita anak durhaka.",
      "Menjelang akhir babak itu, di amplop surat ada biji mangga yang dulu ditanam Laila. Naya tidak langsung bergerak. Tubuhnya ingin lari, tetapi sesuatu di dalam dirinya justru menjadi tenang, seperti orang yang akhirnya melihat bentuk musuh setelah lama dipukul dari gelap. Ia menggenggam bukti yang tersisa, menatap lorong, lalu berbisik pada nama ibunya tanpa suara. Besok mereka mungkin menuduhnya. Besok ia mungkin terusir. Besok orang-orang yang terlihat saleh bisa menunjukkan wajah asli. Namun malam ini satu hal pasti: pintu yang pernah ditutup untuk Laila mulai terbuka untuk Naya."
    ],
    "wordCount": 882,
    "sceneCount": 4,
    "reveals": [],
    "newNamedCharacters": [],
    "proposedStateDelta": {
      "chapter48_progress": true,
      "tension": true
    },
    "dialogue": [
      {
        "characterId": "char:naya",
        "text": "Aku tidak pulang untuk jadi anak baik di depan kebohongan."
      },
      {
        "characterId": "char:arman",
        "text": "Kalau kamu terus membuka pintu itu, tidak semua orang bisa diselamatkan."
      }
    ],
    "emotionBeats": [
      {
        "characterId": "char:naya",
        "targetCharacterId": "char:arman",
        "valence": "neutral"
      }
    ]
  },
  {
    "chapterNumber": 49,
    "title": "Bilik yang Dibuka Untuk Semua",
    "phase": "ACT_8_PEMULIHAN_NAMA",
    "chapterGoal": "Menggerakkan konflik Bilik Ketujuh melalui papan nama Bilik Ketujuh diganti ruang arsip terbuka dan tekanan utama: Hafiz meminta maaf tanpa meminta Naya menerimanya.",
    "mandatoryBeats": [
      "papan nama Bilik Ketujuh diganti ruang arsip terbuka",
      "Hafiz meminta maaf tanpa meminta Naya menerimanya",
      "Rafi menemukan kabar adiknya lewat daftar pemulihan",
      "di rak terakhir ada map kosong dengan nama Naya"
    ],
    "cast": [
      "char:naya",
      "char:hafiz",
      "char:rafi"
    ],
    "threadIds": [
      "thread:bilik-ketujuh",
      "thread:kematian-laila"
    ],
    "paragraphs": [
      "Lorong asrama yang dicat ulang tidak pernah terasa benar bagi Naya. Setiap sudutnya seperti menyimpan napas orang yang menunggu dipanggil, sementara papan nama Bilik Ketujuh diganti ruang arsip terbuka terletak di hadapannya dengan tenang yang nyaris mengejek. Naya mencoba mengingat pesan ibunya: jangan takut pada pintu, takutlah pada orang yang menyuruhmu tidak bertanya. Tetapi pesan itu dulu hanya terdengar seperti nasihat untuk anak kecil yang sering kehilangan sandal di masjid. Sekarang, di usia yang memaksa dirinya terlihat dewasa, kalimat itu berubah menjadi pisau. Ia berdiri terlalu lama, sampai suara sandal dari arah belakang membuat tengkuknya menegang.",
      "Hafiz meminta maaf tanpa meminta Naya menerimanya. Kalimat itu datang tidak selalu dengan teriakan; justru semakin pelan diucapkan, semakin jelas ancamannya. Naya tahu ada orang-orang yang menguasai tempat ini bukan karena mereka benar, melainkan karena semua orang sudah terbiasa menunduk. Ia menatap wajah Hafiz, mencari celah yang bisa dibaca, tetapi yang ia temukan hanya kegelisahan yang disembunyikan di balik sikap biasa. Di pesantren, kebohongan tidak memakai pakaian hitam. Ia memakai senyum ustazah, kitab yang ditutup mendadak, dan aturan yang baru disebut setelah seseorang hampir menemukan jawaban.",
      "Rafi menemukan kabar adiknya lewat daftar pemulihan. Bantuan itu kecil, hampir tidak pantas disebut pertolongan, namun bagi Naya yang mulai kehabisan tempat berpijak, hal kecil bisa terasa seperti tangan di tepi sumur. Ia menyimpan napas, mendengar bunyi malam, dan membiarkan dirinya membaca ulang semua kejadian sejak pulang. Kenapa semua orang tahu nama ibunya, tetapi tidak seorang pun berani mengucapkannya dengan wajar? Kenapa setiap arsip tentang Laila selalu punya bekas sobekan? Rafi pernah berkata bahwa beberapa keluarga tidak runtuh karena miskin, melainkan karena terlalu lama menyimpan malu milik orang lain.",
      "Petunjuk tentang papan nama Bilik Ketujuh diganti ruang arsip terbuka membuat Naya sadar bahwa misteri ini tidak berdiri sendiri. Ada tanah wakaf, nama anak-anak yang dipindahkan, para pengurus yang takut kehilangan muka, dan keluarga yang dibiarkan patah agar bangunan pesantren tetap terlihat kokoh. Ia ingat tiga jalan yang sejak awal membayanginya: menggali sendiri sampai kebenaran telanjang, patuh sebentar untuk memancing pengakuan, atau keluar dari pagar agar bukti tidak ikut dikubur. Pilihan itu tidak pernah benar-benar bersih. Jalan pertama bisa menghancurkan orang yang masih ingin ia percaya. Jalan kedua bisa menjadikannya alat para pembohong. Jalan ketiga bisa membuatnya kehilangan akses pada semua pintu yang baru mulai terbuka. Namun diam jelas bukan pilihan; diam adalah bahasa yang selama ini dipakai untuk mengubur Laila.",
      "Ketika Naya menyentuh bukti itu, Naya melihat luka pribadi berubah menjadi pintu bagi orang lain. Dadanya terasa seperti dipenuhi air yang tidak menemukan jalan keluar. Ia marah pada ibunya karena meninggalkan teka-teki, marah pada ayah yang entah hidup atau mati, marah pada Marwah yang selalu berbicara seolah luka orang lain adalah urusan administrasi. Tetapi paling dalam, Naya marah pada dirinya sendiri karena masih ingin seseorang berkata bahwa semua ini salah paham. Anak yang kehilangan ibu kadang tidak mencari kebenaran dulu; ia mencari satu orang dewasa yang bersedia mengaku telah gagal melindunginya.",
      "Dialog yang terjadi setelah itu pendek, tetapi menancap. 'Kamu tidak paham akibatnya,' kata suara yang menahan panik. Naya menjawab pelan, 'Mungkin. Tapi kalian terlalu lama memakai kata akibat untuk menutup kata dosa.' Ruangan mendadak sempit. Hafiz memalingkan muka, seolah kalimat itu mengenai bagian dirinya yang paling ia sembunyikan. Di luar, suara santri mengaji terdengar jauh, bersih, hampir tidak cocok dengan kebusukan yang pelan-pelan muncul di balik dinding. Naya mendadak paham mengapa ibunya dulu selalu memilih duduk di belakang, dekat pintu keluar.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Makin malam, tekanan makin rapi. Ada yang mengunci pintu, ada yang memindahkan map, ada yang mengirim pesan tanpa nama. Naya mulai membedakan takut yang melumpuhkan dan takut yang memberi tenaga. Ia mencatat urutan kejadian dalam kepala: siapa datang lebih dulu, siapa terlalu cepat tahu, siapa pura-pura kaget, siapa menyebut nama Laila dengan suara seperti meminta ampun. Jika suatu hari ia harus berdiri di depan semua orang, ia tidak boleh hanya membawa tangis. Ia harus membawa urutan, tanggal, suara, dan bukti yang tidak bisa dipelintir menjadi cerita anak durhaka.",
      "Menjelang akhir babak itu, di rak terakhir ada map kosong dengan nama Naya. Naya tidak langsung bergerak. Tubuhnya ingin lari, tetapi sesuatu di dalam dirinya justru menjadi tenang, seperti orang yang akhirnya melihat bentuk musuh setelah lama dipukul dari gelap. Ia menggenggam bukti yang tersisa, menatap lorong, lalu berbisik pada nama ibunya tanpa suara. Besok mereka mungkin menuduhnya. Besok ia mungkin terusir. Besok orang-orang yang terlihat saleh bisa menunjukkan wajah asli. Namun malam ini satu hal pasti: pintu yang pernah ditutup untuk Laila mulai terbuka untuk Naya."
    ],
    "wordCount": 885,
    "sceneCount": 4,
    "reveals": [],
    "newNamedCharacters": [],
    "proposedStateDelta": {
      "chapter49_progress": true,
      "tension": true
    },
    "dialogue": [
      {
        "characterId": "char:naya",
        "text": "Aku tidak pulang untuk jadi anak baik di depan kebohongan."
      },
      {
        "characterId": "char:hafiz",
        "text": "Kalau kamu terus membuka pintu itu, tidak semua orang bisa diselamatkan."
      }
    ],
    "emotionBeats": [
      {
        "characterId": "char:naya",
        "targetCharacterId": "char:hafiz",
        "valence": "neutral"
      }
    ]
  },
  {
    "chapterNumber": 50,
    "title": "Nama yang Kembali Pulang",
    "phase": "ACT_8_PEMULIHAN_NAMA",
    "chapterGoal": "Menggerakkan konflik Bilik Ketujuh melalui daftar wakaf baru dengan nama Laila dipulihkan dan tekanan utama: Marwah datang sebagai saksi bukan pengurus.",
    "mandatoryBeats": [
      "daftar wakaf baru dengan nama Laila dipulihkan",
      "Marwah datang sebagai saksi bukan pengurus",
      "Naya membaca nama ibunya di depan santri dan warga",
      "Bilik Ketujuh tidak lagi berbisik karena semua pintunya terbuka"
    ],
    "cast": [
      "char:naya",
      "char:ustazah-marwah",
      "char:arman",
      "char:hafiz"
    ],
    "threadIds": [
      "thread:bilik-ketujuh",
      "thread:kunci-wakaf",
      "thread:keluarga-naya"
    ],
    "paragraphs": [
      "Halaman pesantren pada hari pembukaan arsip tidak pernah terasa benar bagi Naya. Setiap sudutnya seperti menyimpan napas orang yang menunggu dipanggil, sementara daftar wakaf baru dengan nama Laila dipulihkan terletak di hadapannya dengan tenang yang nyaris mengejek. Naya mencoba mengingat pesan ibunya: jangan takut pada pintu, takutlah pada orang yang menyuruhmu tidak bertanya. Tetapi pesan itu dulu hanya terdengar seperti nasihat untuk anak kecil yang sering kehilangan sandal di masjid. Sekarang, di usia yang memaksa dirinya terlihat dewasa, kalimat itu berubah menjadi pisau. Ia berdiri terlalu lama, sampai suara sandal dari arah belakang membuat tengkuknya menegang.",
      "Marwah datang sebagai saksi bukan pengurus. Kalimat itu datang tidak selalu dengan teriakan; justru semakin pelan diucapkan, semakin jelas ancamannya. Naya tahu ada orang-orang yang menguasai tempat ini bukan karena mereka benar, melainkan karena semua orang sudah terbiasa menunduk. Ia menatap wajah Marwah, mencari celah yang bisa dibaca, tetapi yang ia temukan hanya kegelisahan yang disembunyikan di balik sikap biasa. Di pesantren, kebohongan tidak memakai pakaian hitam. Ia memakai senyum ustazah, kitab yang ditutup mendadak, dan aturan yang baru disebut setelah seseorang hampir menemukan jawaban.",
      "Naya membaca nama ibunya di depan santri dan warga. Bantuan itu kecil, hampir tidak pantas disebut pertolongan, namun bagi Naya yang mulai kehabisan tempat berpijak, hal kecil bisa terasa seperti tangan di tepi sumur. Ia menyimpan napas, mendengar bunyi malam, dan membiarkan dirinya membaca ulang semua kejadian sejak pulang. Kenapa semua orang tahu nama ibunya, tetapi tidak seorang pun berani mengucapkannya dengan wajar? Kenapa setiap arsip tentang Laila selalu punya bekas sobekan? Arman pernah berkata bahwa beberapa keluarga tidak runtuh karena miskin, melainkan karena terlalu lama menyimpan malu milik orang lain.",
      "Petunjuk tentang daftar wakaf baru dengan nama Laila dipulihkan membuat Naya sadar bahwa misteri ini tidak berdiri sendiri. Ada tanah wakaf, nama anak-anak yang dipindahkan, para pengurus yang takut kehilangan muka, dan keluarga yang dibiarkan patah agar bangunan pesantren tetap terlihat kokoh. Ia ingat tiga jalan yang sejak awal membayanginya: menggali sendiri sampai kebenaran telanjang, patuh sebentar untuk memancing pengakuan, atau keluar dari pagar agar bukti tidak ikut dikubur. Pilihan itu tidak pernah benar-benar bersih. Jalan pertama bisa menghancurkan orang yang masih ingin ia percaya. Jalan kedua bisa menjadikannya alat para pembohong. Jalan ketiga bisa membuatnya kehilangan akses pada semua pintu yang baru mulai terbuka. Namun diam jelas bukan pilihan; diam adalah bahasa yang selama ini dipakai untuk mengubur Laila.",
      "Ketika Naya menyentuh bukti itu, air mata kali ini bukan kekalahan melainkan penutup lingkaran. Dadanya terasa seperti dipenuhi air yang tidak menemukan jalan keluar. Ia marah pada ibunya karena meninggalkan teka-teki, marah pada ayah yang entah hidup atau mati, marah pada Marwah yang selalu berbicara seolah luka orang lain adalah urusan administrasi. Tetapi paling dalam, Naya marah pada dirinya sendiri karena masih ingin seseorang berkata bahwa semua ini salah paham. Anak yang kehilangan ibu kadang tidak mencari kebenaran dulu; ia mencari satu orang dewasa yang bersedia mengaku telah gagal melindunginya.",
      "Dialog yang terjadi setelah itu pendek, tetapi menancap. 'Kamu tidak paham akibatnya,' kata suara yang menahan panik. Naya menjawab pelan, 'Mungkin. Tapi kalian terlalu lama memakai kata akibat untuk menutup kata dosa.' Ruangan mendadak sempit. Marwah memalingkan muka, seolah kalimat itu mengenai bagian dirinya yang paling ia sembunyikan. Di luar, suara santri mengaji terdengar jauh, bersih, hampir tidak cocok dengan kebusukan yang pelan-pelan muncul di balik dinding. Naya mendadak paham mengapa ibunya dulu selalu memilih duduk di belakang, dekat pintu keluar.",
      "Naya juga mulai memahami harga sebuah rahasia. Rahasia tidak hanya disimpan oleh pelaku; rahasia ikut dijaga oleh orang yang takut kehilangan pekerjaan, takut anaknya tidak bisa mondok, takut keluarganya dikucilkan, atau takut dosa lama berubah menjadi perkara hukum. Karena itu ia tidak boleh ceroboh. Satu langkah salah bisa membuat bukti hilang, saksi mundur, dan nama Laila kembali dijadikan contoh buruk. Ia harus bergerak seperti orang yang tidak punya pelindung, karena memang begitulah kenyataannya.",
      "Makin malam, tekanan makin rapi. Ada yang mengunci pintu, ada yang memindahkan map, ada yang mengirim pesan tanpa nama. Naya mulai membedakan takut yang melumpuhkan dan takut yang memberi tenaga. Ia mencatat urutan kejadian dalam kepala: siapa datang lebih dulu, siapa terlalu cepat tahu, siapa pura-pura kaget, siapa menyebut nama Laila dengan suara seperti meminta ampun. Jika suatu hari ia harus berdiri di depan semua orang, ia tidak boleh hanya membawa tangis. Ia harus membawa urutan, tanggal, suara, dan bukti yang tidak bisa dipelintir menjadi cerita anak durhaka. Yang terbuka bukan sekadar petunjuk, melainkan rahasia yang mengubah cara Naya membaca semua babak sebelumnya.",
      "Menjelang akhir babak itu, Bilik Ketujuh tidak lagi berbisik karena semua pintunya terbuka. Naya tidak langsung bergerak. Tubuhnya ingin lari, tetapi sesuatu di dalam dirinya justru menjadi tenang, seperti orang yang akhirnya melihat bentuk musuh setelah lama dipukul dari gelap. Ia menggenggam bukti yang tersisa, menatap lorong, lalu berbisik pada nama ibunya tanpa suara. Besok mereka mungkin menuduhnya. Besok ia mungkin terusir. Besok orang-orang yang terlihat saleh bisa menunjukkan wajah asli. Namun malam ini satu hal pasti: pintu yang pernah ditutup untuk Laila mulai terbuka untuk Naya."
    ],
    "wordCount": 826,
    "sceneCount": 4,
    "reveals": [
      "secret:nama-yang-kembali"
    ],
    "newNamedCharacters": [],
    "proposedStateDelta": {
      "chapter50_progress": true,
      "tension": true,
      "revealed_nama_yang_kembali": true
    },
    "dialogue": [
      {
        "characterId": "char:naya",
        "text": "Aku tidak pulang untuk jadi anak baik di depan kebohongan."
      },
      {
        "characterId": "char:ustazah-marwah",
        "text": "Kalau kamu terus membuka pintu itu, tidak semua orang bisa diselamatkan."
      }
    ],
    "emotionBeats": [
      {
        "characterId": "char:naya",
        "targetCharacterId": "char:ustazah-marwah",
        "valence": "neutral"
      }
    ]
  }
] as const

function canonicalName(characterId: string): string {
  return characters.find((character) => character.id === characterId)?.canonicalName ?? characterId
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

function chapterWordCount(paragraphs: readonly string[]): number {
  return paragraphs.reduce((total, paragraph) => total + countWords(paragraph), 0)
}

function choiceOrGateChapter(chapter: number): boolean {
  return Boolean((PREMIUM_ROUTE_MAP_50.choiceGates as Record<number, unknown>)[chapter]) ||
    secrets.some((secret) => secret.revealGateChapter === chapter) ||
    chapter === 50
}

function buildBlueprints(): ChapterBlueprint[] {
  return chapterSpecs.map((spec) => ({
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

export function buildPremiumBilikKetujuh50Snapshot(): CanonSnapshot {
  return {
    storyId: PREMIUM_BILIK_KETUJUH_50_STORY_ID,
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

export function buildPremiumBilikKetujuh50Draft(
  snapshot: CanonSnapshot,
  chapter: number,
): ChapterDraft {
  const spec = chapterSpecs.find((item) => item.chapterNumber === chapter)
  if (!spec) throw new Error(`Unknown chapter: ${chapter}`)

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
    events: spec.cast.slice(0, 3).map((characterId, index) => ({
      characterMention: canonicalName(characterId),
      description: `${canonicalName(characterId)} bergerak dalam konflik utama Bab ${spec.chapterNumber}: ${spec.chapterGoal}`,
      ordinal: index,
      occursAt: spec.chapterNumber * 10 + index,
      isFlashback: false,
    })),
    knowledgeAssertions: [],
    reveals: spec.reveals.map((secretId) => ({ secretId })),
    proposedStateDelta: { ...spec.proposedStateDelta },
    newNamedCharacters: [...spec.newNamedCharacters],
    dialogue: [...spec.dialogue],
    emotionBeats: [...spec.emotionBeats],
    softClaims: [],
    advancedThreadIds: [...spec.threadIds],
    opensNewThread: false,
  }
}

export function buildAllPremiumBilikKetujuh50Drafts(
  snapshot = buildPremiumBilikKetujuh50Snapshot(),
): ChapterDraft[] {
  return chapterSpecs.map((spec) => buildPremiumBilikKetujuh50Draft(snapshot, spec.chapterNumber))
}

export const PREMIUM_BILIK_KETUJUH_50_STATS = {
  totalChapters: chapterSpecs.length,
  minWordCount: Math.min(...chapterSpecs.map((spec) => chapterWordCount(spec.paragraphs))),
  maxWordCount: Math.max(...chapterSpecs.map((spec) => chapterWordCount(spec.paragraphs))),
  choiceChapters: Object.keys(PREMIUM_ROUTE_MAP_50.choiceGates).map(Number),
  revealChapters: secrets.map((secret) => secret.revealGateChapter),
} as const
