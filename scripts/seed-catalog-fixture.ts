import { getDb, result, type Json } from '@lakoku/db'
import { assertLoopbackDatabaseUrl } from './personalized-db-safety'

export const FIXTURE_CATALOG_STORY_ID = 'catalog:bayang-tak-bertuan'

export const FIXTURE_CATALOG_CONTRACT = {
  closureRunway: {
    endingLockChapter: 45,
  },
  endingCandidates: [
    {
      key: 'ending_a',
      name: 'Warisan Terbuka',
      kind: 'main' as const,
      condition: 'Raka memimpin pemulihan tanah leluhur dengan transparansi penuh.',
      requiredClosure: ['Warisan leluhur diakui warga desa.', 'Raka berdamai dengan keluarganya.'],
      blockingConditions: [],
    },
    {
      key: 'ending_b',
      name: 'Kebenaran Pahit',
      kind: 'main' as const,
      condition: 'Raka memilih pergi meninggalkan segalanya demi kedamaian batin.',
      requiredClosure: ['Raka menyerahkan dokumen tanah kepada tetua desa.'],
      blockingConditions: [],
    },
    {
      key: 'ending_secret',
      name: 'Perjanjian Gaib',
      kind: 'secret' as const,
      condition: 'Raka menemukan perjanjian rahasia kakeknya di lereng Lawu.',
      requiredClosure: ['Perjanjian kuno terungkap.', 'Misteri lereng Lawu terselesaikan.'],
      blockingConditions: [],
    },
  ],
}

export const FIXTURE_BAB_44_CHOICES = [
  { id: 'ch44-opt-1', label: 'Hadapi rintangan demi membuka warisan leluhur' },
  { id: 'ch44-opt-2', label: 'Tinggalkan segalanya demi kedamaian batin' },
  { id: 'ch44-opt-3', label: 'Selidiki perjanjian rahasia kakek di lereng Lawu' },
]

export const FIXTURE_BAB_44_OUTCOMES = [
  {
    choiceId: 'ch44-opt-1',
    label: 'Hadapi rintangan demi membuka warisan leluhur',
    directionHint: 'Langkahmu mulai meyakinkan tetua desa.',
    consequence: [
      'Raka memutuskan untuk tetap berdiri teguh di hadapan seluruh warga desa.',
      'Kebenaran tentang tanah leluhur harus diungkap tanpa ada yang disembunyikan.',
    ],
    effectJson: {
      endingBiasDeltas: { ending_a: 10 },
    },
  },
  {
    choiceId: 'ch44-opt-2',
    label: 'Tinggalkan segalanya demi kedamaian batin',
    directionHint: 'Beban di pundakmu perlahan terasa memudar.',
    consequence: [
      'Raka memilih untuk menyerahkan surat tanah dan melangkah pergi dari pusaran konflik.',
      'Kedamaian batin jauh lebih berharga daripada warisan penuh pertikaian.',
    ],
    effectJson: {
      endingBiasDeltas: { ending_b: 10 },
    },
  },
  {
    choiceId: 'ch44-opt-3',
    label: 'Selidiki perjanjian rahasia kakek di lereng Lawu',
    directionHint: 'Kabut lereng Lawu menyibak rahasia tersembunyi.',
    consequence: [
      'Di sudut gua lereng Lawu, Raka menemukan gulungan naskah bertuliskan aksara kuno.',
      'Perjanjian lama kakeknya memegang kunci misteri yang selama ini terkunci.',
    ],
    effectJson: {
      endingBiasDeltas: { ending_secret: 10 },
    },
  },
]

export function assertSeedAllowed(env: Record<string, string | undefined> = process.env): { host: string } {
  if (env.LAKOKU_SEED_CATALOG !== '1') {
    throw new Error('LAKOKU_SEED_CATALOG=1 is required to seed catalog fixture')
  }

  const allowRemote = env.LAKOKU_ALLOW_REMOTE_FIXTURE_SEED === '1'
  const host = assertLoopbackDatabaseUrl(env.DATABASE_URL, allowRemote, env)
  return { host }
}

export async function seedCatalogFixture(env: Record<string, string | undefined> = process.env): Promise<void> {
  const { host } = assertSeedAllowed(env)
  console.log(`[seed-catalog] Target database host: ${host}`)

  if (env.DATABASE_URL) {
    process.env.DATABASE_URL = env.DATABASE_URL
  }

  const db = getDb()
  const storyId = FIXTURE_CATALOG_STORY_ID
  if (!storyId.startsWith('catalog:') || storyId !== FIXTURE_CATALOG_STORY_ID) {
    throw new Error(`Refusing to mutate story outside of "${FIXTURE_CATALOG_STORY_ID}"`)
  }

  console.log(`[seed-catalog] Membersihkan data lama untuk ${storyId}...`)
  await db.deleteFrom('catalog_ending_chapters').where('story_id', '=', storyId).execute()
  await db.deleteFrom('catalog_stories').where('story_id', '=', storyId).execute()
  await db.deleteFrom('choice_outcomes').where('story_id', '=', storyId).execute()
  await db.deleteFrom('chapters').where('story_id', '=', storyId).execute()
  await db.deleteFrom('stories').where('id', '=', storyId).execute()

  console.log('[seed-catalog] Memasukkan baris stories...')
  await result(
    db
      .insertInto('stories')
      .values({
        id: storyId,
        title: 'Bayang Tak Bertuan',
        cover: '/covers/bayang-tak-bertuan.webp',
        tagline: 'Di balik kabut lereng Lawu, rahasia keluarga memanggilmu pulang.',
        role: 'Raka',
        tropes: ['Rahasia Keluarga', 'Kebangkitan Diri'],
        total_chapters: 50,
        synopsis: 'Sebuah novel interaktif 50 bab dengan tiga cabang takdir yang ditentukan pilihan hatimu.',
        status: 'SELESAI',
        current_chapter: 50,
        visibility: 'public',
        story_mode: 'catalog',
        owner_user_id: null,
        jejak: [],
      })
      .execute(),
  )

  console.log('[seed-catalog] Memasukkan catalog_stories...')
  await result(
    db
      .insertInto('catalog_stories')
      .values({
        story_id: storyId,
        status: 'published',
        chapter_price: 5,
        bundle_price: 150,
        contract_json: FIXTURE_CATALOG_CONTRACT as unknown as Json,
        generation_progress: 50,
        published_at: new Date().toISOString(),
        published_by: 'system',
      })
      .execute(),
  )

  console.log('[seed-catalog] Memasukkan Bab 1-44 spine...')
  for (let n = 1; n <= 44; n++) {
    const isBab44 = n === 44
    const choices = isBab44
      ? FIXTURE_BAB_44_CHOICES.map((c) => ({ id: c.id, label: c.label }))
      : [
          { id: `ch${n}-opt-1`, label: `Hadapi rintangan langkah ${n}` },
          { id: `ch${n}-opt-2`, label: `Cari jalan memutar langkah ${n}` },
        ]

    await result(
      db
        .insertInto('chapters')
        .values({
          story_id: storyId,
          number: n,
          title: `Bab ${n}: Titik Temu ${n}`,
          paragraphs: [
            `Langkah demi langkah di Bab ${n} membawa Raka semakin dekat ke inti teka-teki.`,
            `Udara dingin pegunungan menusuk tulang, tetapi tekadnya tak goyah sedikit pun.`,
          ] as unknown as Json,
          choice_prompt: `Apa langkahmu berikutnya di Bab ${n}?`,
          choices: choices as unknown as Json,
        })
        .execute(),
    )

    if (isBab44) {
      for (const outcome of FIXTURE_BAB_44_OUTCOMES) {
        await result(
          db
            .insertInto('choice_outcomes')
            .values({
              story_id: storyId,
              chapter_number: 44,
              choice_id: outcome.choiceId,
              consequence: outcome.consequence as unknown as Json,
              next_chapter_number: 45,
              is_ending: false,
              direction_hint: outcome.directionHint,
              effect_json: outcome.effectJson as unknown as Json,
            })
            .execute(),
        )
      }
    } else {
      for (const c of choices) {
        await result(
          db
            .insertInto('choice_outcomes')
            .values({
              story_id: storyId,
              chapter_number: n,
              choice_id: c.id,
              consequence: [
                `Reaksi mendalam untuk ${c.label}. Keputusan ini membawa dampak nyata bagi suasana di sekitar.`,
                `Raka menghela napas panjang dan melangkah mantap ke depan.`,
              ] as unknown as Json,
              next_chapter_number: n + 1,
              is_ending: false,
              direction_hint: c.id.endsWith('1') ? 'Keyakinanmu mulai mempengaruhi orang sekitar.' : null,
              effect_json: {
                endingBiasDeltas: {},
              } as unknown as Json,
            })
            .execute(),
        )
      }
    }
  }

  console.log('[seed-catalog] Memasukkan Bab 45-50 varian babak akhir...')
  const endingKeys = ['ending_a', 'ending_b', 'ending_secret']
  const endingTagLabels: Record<string, string> = {
    ending_a: 'PUNCAK_A',
    ending_b: 'PUNCAK_B',
    ending_secret: 'PUNCAK_RAHASIA',
  }
  for (const endingKey of endingKeys) {
    const tagLabel = endingTagLabels[endingKey] ?? endingKey.toUpperCase()
    for (let n = 45; n <= 50; n++) {
      const isFinal = n === 50
      const outcomes = isFinal
        ? []
        : [
            {
              storyId,
              chapterNumber: n,
              choiceId: `v-${endingKey}-ch${n}-1`,
              consequence: [`Konsekuensi cabang ${tagLabel} bab ${n}.`],
              nextChapterNumber: n + 1,
              isEnding: false,
            },
          ]

      await result(
        db
          .insertInto('catalog_ending_chapters')
          .values({
            story_id: storyId,
            ending_key: endingKey,
            number: n,
            title: `Bab ${n} [${tagLabel}]: Babak Penutup`,
            paragraphs: [
              `Paragraf khusus cabang ${tagLabel} pada Bab ${n}.`,
              isFinal ? `Inilah penutup dari takdir ${tagLabel}.` : 'Ketegangan memuncak di ujung perjalanan.',
            ] as unknown as Json,
            choice_prompt: isFinal ? null : 'Bagaimana caramu menutup kisah ini?',
            choices: isFinal ? null : ([{ id: `v-${endingKey}-ch${n}-1`, label: 'Lanjutkan akhir kisah' }] as unknown as Json),
            outcomes_json: outcomes as unknown as Json,
          })
          .execute(),
      )
    }
  }

  console.log('[seed-catalog] Sukses menyiapkan fixture catalog:bayang-tak-bertuan (50 bab, 3 cabang takdir).')
}

const isDirectExecution =
  typeof process !== 'undefined' &&
  Boolean(process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/seed-catalog-fixture.ts'))

if (isDirectExecution) {
  seedCatalogFixture().catch((err) => {
    console.error('[seed-catalog] Gagal:', err)
    process.exit(1)
  })
}
