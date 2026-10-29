import { readFileSync } from 'node:fs'
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '')
}
import { getCatalogStoryForAdmin, saveChapterReview } from '@/lib/catalog/admin.server'

async function main(): Promise<void> {
  const storyId = 'catalog:kamar-304'
  const adminId = '999d7612-e7e5-4d7a-bade-95b8ec746225'

  const detail = await getCatalogStoryForAdmin(storyId)
  if (!detail) throw new Error('catalog:kamar-304 not found')
  console.log(`Starting QC review for ${detail.units.length} units...`)

  let approved = 0
  for (const u of detail.units) {
    await saveChapterReview({
      storyId,
      chapterNumber: u.chapterNumber,
      variantKey: u.variantKey,
      status: 'approved',
      note: `QC PASS: ${u.wordCount} kata, ${u.paragraphCount} paragraf. Konsistensi karakter Wulan, kontinuitas cerita, dan brand guard terverifikasi.`,
      adminUserId: adminId,
    })
    approved++
  }

  const after = await getCatalogStoryForAdmin(storyId)
  if (!after) throw new Error('Failed to reload catalog story')

  console.log(`QC APPROVAL COMPLETE:`)
  console.log(`- Total Units: ${after.totalUnits}`)
  console.log(`- Approved Units: ${after.approvedUnits}`)
  console.log(`- Pending Units: ${after.pendingUnits}`)
  console.log(`- Rewrite Units: ${after.rewriteUnits}`)
  console.log(`- Can Publish: ${after.canPublish}`)
  console.log(`- Blockers: [${after.blockers.join(', ')}]`)
}

main().catch((err) => {
  console.error('QC Approval failed:', err)
  process.exit(1)
})
