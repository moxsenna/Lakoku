import { getDb, result } from '@lakoku/db'
import { readFileSync } from 'node:fs'

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '')
}

async function main(): Promise<void> {
  const db = getDb()
  const storyId = 'catalog:kamar-304'

  console.log('1. Patching character metadata...')
  const charRes = await result(
    db
      .updateTable('characters')
      .set({
        role: 'Resepsionis malam Hotel Griya Surya yang menyelidiki rahasia kamar 304',
        motivation:
          'Melunasi utang masa lalu keluarga dan menguak misteri kematian tamu yang belum check-out',
      })
      .where('story_id', '=', storyId)
      .where('canonical_name', '=', 'Wulan')
      .execute(),
  )
  if (charRes.error) throw charRes.error

  console.log('2. Patching contract endingCandidates...')
  const storyRow = await db
    .selectFrom('catalog_stories')
    .select('contract_json')
    .where('story_id', '=', storyId)
    .executeTakeFirst()
  if (!storyRow) throw new Error('catalog_stories row not found')

  const contract =
    typeof storyRow.contract_json === 'string'
      ? JSON.parse(storyRow.contract_json)
      : storyRow.contract_json

  contract.endingCandidates = [
    {
      key: 'publish-truth',
      kind: 'main',
      name: 'Arsip Dibuka',
      condition: 'Wulan menjaga bukti asli dan memilih kesaksian publik.',
      requiredClosure: [
        'Dalang sabotase banjir terungkap.',
        'Nama keluarga Wulan dipulihkan.',
        'Wulan menerima akibat peran ayahnya.',
      ],
      blockingConditions: [],
    },
    {
      key: 'protect-witnesses',
      kind: 'main',
      name: 'Kebenaran yang Dijaga',
      condition:
        'Wulan memprioritaskan keselamatan saksi sambil menyerahkan bukti melalui jalur hukum.',
      requiredClosure: [
        'Para saksi mendapat perlindungan.',
        'Jaringan pejabat kehilangan kendali.',
        'Wulan berdamai dengan masa lalu keluarganya.',
      ],
      blockingConditions: [],
    },
    {
      key: 'shadows-protect',
      kind: 'secret',
      name: 'Bayangan Melindungi',
      condition:
        'Wulan menghancurkan bukti dan melindungi keluarga dari ancaman pejabat.',
      requiredClosure: [
        'Ayah selamat.',
        'Saksi-saksi tidak dikenali.',
        'Kota tetap dalam bayang korupsi.',
      ],
      blockingConditions: [],
    },
  ]

  const contractUpdate = await result(
    db
      .updateTable('catalog_stories')
      .set({ contract_json: JSON.stringify(contract) as any })
      .where('story_id', '=', storyId)
      .execute(),
  )
  if (contractUpdate.error) throw contractUpdate.error

  console.log('3. Patching Spine chapters...')
  // Helper for patching paragraphs
  async function patchChapterParagraphs(
    chNum: number,
    replacements: Array<[string | RegExp, string]>,
  ) {
    const row = await db
      .selectFrom('chapters')
      .select('paragraphs')
      .where('story_id', '=', storyId)
      .where('number', '=', chNum)
      .executeTakeFirst()
    if (!row) throw new Error(`Bab ${chNum} not found`)
    let pars: string[] =
      typeof row.paragraphs === 'string'
        ? JSON.parse(row.paragraphs)
        : row.paragraphs
    for (const [pattern, replacement] of replacements) {
      pars = pars.map((p) => p.replace(pattern, replacement))
    }
    const up = await result(
      db
        .updateTable('chapters')
        .set({ paragraphs: JSON.stringify(pars) as any })
        .where('story_id', '=', storyId)
        .where('number', '=', chNum)
        .execute(),
    )
    if (up.error) throw up.error
  }

  await patchChapterParagraphs(27, [
    ['"Waktu kalian sudah habis, Naya,"', '"Waktu kalian sudah habis, Wulan,"'],
  ])
  await patchChapterParagraphs(32, [
    ['Buka pintunya, Naya.', 'Buka pintunya, Wulan.'],
  ])
  await patchChapterParagraphs(37, [
    ['tempat berbahaya ini, Naya,"', 'tempat berbahaya ini, Wulan,"'],
    ['tujuh malam itu, Naya,"', 'tujuh malam itu, Wulan,"'],
  ])

  // Bab 44 Choices
  const choices44 = [
    {
      id: 'ch44-opt-1',
      label: 'Wulan menjaga bukti asli dan memilih kesaksian publik.',
    },
    {
      id: 'ch44-opt-2',
      label:
        'Wulan memprioritaskan keselamatan saksi sambil menyerahkan bukti melalui jalur hukum.',
    },
    {
      id: 'ch44-opt-3',
      label:
        'Wulan menghancurkan bukti dan melindungi keluarga dari ancaman pejabat.',
    },
  ]
  const ch44Update = await result(
    db
      .updateTable('chapters')
      .set({ choices: JSON.stringify(choices44) as any })
      .where('story_id', '=', storyId)
      .where('number', '=', 44)
      .execute(),
  )
  if (ch44Update.error) throw ch44Update.error

  // Bab 44 Choice Outcomes
  async function patchOutcome(choiceId: string, consequence: string[]) {
    const outRes = await result(
      db
        .updateTable('choice_outcomes')
        .set({ consequence: JSON.stringify(consequence) as any })
        .where('story_id', '=', storyId)
        .where('chapter_number', '=', 44)
        .where('choice_id', '=', choiceId)
        .execute(),
    )
    if (outRes.error) throw outRes.error
  }

  await patchOutcome('ch44-opt-1', [
    'Aku memutuskan membuka semua bukti itu ke hadapan publik tanpa ragu sedikit pun. Suara ketukan mikrofon di aula mendadak membuat dadaku bergemuruh kencang bagai petir menyambar.',
    'Aku tahu badai besar akan segera menghantam hidup kami setelah kebenaran ini tersiar luas. Namun, setidaknya beban di pundakku terasa sedikit berkurang saat melihat kilas cahaya keadilan mulai menyala.',
  ])

  await patchOutcome('ch44-opt-2', [
    'Keputusanku menyerahkan dokumen lewat jalur hukum resmi membuatku bernapas sedikit lebih lega. Kami memilih jalur aman agar keselamatan para saksi tetap terlindungi dari ancaman bahaya.',
    'Meskipun prosesnya tampak panjang dan penuh kehati-hatian, aku berharap langkah ini tidak berujung pada sia-sia. Setidaknya secercah asa masih menuntun kami berjalan di atas koridor yang benar.',
  ])

  await patchOutcome('ch44-opt-3', [
    'Aku memilih membakar seluruh berkas penting itu demi menghentikan teror yang terus mengejar keluarga kami. Kepedihan langsung merayap di dadaku saat melihat abu panas beterbangan dihembus angin malam.',
    'Kami memilih merelakan keadilan demi menyelamatkan nyawa orang-orang terkasih dari amukan dendam. Sunyi malam kamar tiga ratus empat kini menelan rapat semua rahasia yang tersisa.',
  ])

  console.log('4. Patching Variant chapters...')
  async function patchVariantParagraphs(
    endingKey: string,
    chNum: number,
    replacements: Array<[string | RegExp, string]>,
  ) {
    const row = await db
      .selectFrom('catalog_ending_chapters')
      .select('paragraphs')
      .where('story_id', '=', storyId)
      .where('ending_key', '=', endingKey)
      .where('number', '=', chNum)
      .executeTakeFirst()
    if (!row) throw new Error(`Variant ${endingKey} ${chNum} not found`)
    let pars: string[] =
      typeof row.paragraphs === 'string'
        ? JSON.parse(row.paragraphs)
        : row.paragraphs
    for (const [pattern, replacement] of replacements) {
      pars = pars.map((p) => p.replace(pattern, replacement))
    }
    const up = await result(
      db
        .updateTable('catalog_ending_chapters')
        .set({ paragraphs: JSON.stringify(pars) as any })
        .where('story_id', '=', storyId)
        .where('ending_key', '=', endingKey)
        .where('number', '=', chNum)
        .execute(),
    )
    if (up.error) throw up.error
  }

  await patchVariantParagraphs('protect-witnesses', 48, [
    ['hari ini, Naya,"', 'hari ini, Wulan,"'],
  ])
  await patchVariantParagraphs('protect-witnesses', 50, [
    ['lagi sekarang, Naya,', 'lagi sekarang, Wulan,'],
  ])
  await patchVariantParagraphs('shadows-protect', 46, [
    ['malam ini, Naya,"', 'malam ini, Wulan,"'],
  ])

  console.log('PATCHING COMPLETE AND CLEAN.')
}

main().catch((e) => {
  console.error('FAILED:', e)
  process.exit(1)
})
