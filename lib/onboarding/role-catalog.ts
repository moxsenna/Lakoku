/**
 * Protagonist role catalog per genre — plan §8.4.
 * Stable IDs + Indonesian labels.
 */
import type { GenreId } from '@/lib/taste-profile/schema'

export type RoleEntry = { id: string; label: string }

export const ROLE_CATALOG_BY_GENRE: Record<string, readonly RoleEntry[]> = {
  family_drama: [
    { id: 'role_family_overlooked_heir', label: 'Pewaris yang selama ini selalu diremehkan' },
    { id: 'role_family_returning_child', label: 'Anak yang pulang setelah lama menghilang' },
    { id: 'role_family_parent_rebuilding', label: 'Orang tua yang berusaha membangun hidup kembali' },
    { id: 'role_family_outsider', label: 'Orang luar yang tiba-tiba masuk ke keluarga berpengaruh' },
  ],
  romance: [
    { id: 'role_romance_rebuilding_life', label: 'Seseorang yang sedang membangun hidup setelah patah hati' },
    { id: 'role_romance_old_friend', label: 'Sahabat lama yang kembali pada waktu yang tidak tepat' },
    { id: 'role_romance_reluctant_partner', label: 'Pasangan dalam kesepakatan yang tidak pernah direncanakan' },
    { id: 'role_romance_ambitious_outsider', label: 'Pendatang ambisius yang jatuh hati pada dunia yang berbeda' },
  ],
  mystery: [
    { id: 'role_mystery_unexpected_heir', label: 'Pewaris tak terduga dari keluarga penuh rahasia' },
    { id: 'role_mystery_returning_witness', label: 'Saksi lama yang kembali untuk mencari jawaban' },
    { id: 'role_mystery_archive_keeper', label: 'Penjaga arsip yang menemukan bukti terlarang' },
    { id: 'role_mystery_family_outsider', label: 'Orang luar yang terseret ke dalam rahasia keluarga' },
  ],
  fantasy_kingdom: [
    { id: 'role_fantasy_hidden_heir', label: 'Pewaris tersembunyi yang diburu banyak pihak' },
    { id: 'role_fantasy_royal_guard', label: 'Pengawal kerajaan yang harus memilih kesetiaan' },
    { id: 'role_fantasy_forbidden_mage', label: 'Pengguna sihir terlarang yang menyembunyikan kekuatan' },
    { id: 'role_fantasy_diplomat', label: 'Utusan kerajaan yang terjebak di antara dua pihak' },
  ],
  slice_of_life: [
    { id: 'role_slice_newcomer', label: 'Pendatang baru yang ingin memulai dari nol' },
    { id: 'role_slice_returning_home', label: 'Seseorang yang pulang setelah hidupnya berantakan' },
    { id: 'role_slice_small_business', label: 'Pemilik usaha kecil yang mempertaruhkan impian terakhir' },
    { id: 'role_slice_teacher_artist', label: 'Pengajar atau seniman yang kehilangan arah hidup' },
  ],
  survival_thriller: [
    { id: 'role_thriller_survivor', label: 'Penyintas yang tahu sesuatu yang seharusnya tetap terkubur' },
    { id: 'role_thriller_witness', label: 'Saksi yang menjadi target setelah melihat terlalu banyak' },
    { id: 'role_thriller_rescuer', label: 'Penolong yang masuk terlalu jauh ke dalam bahaya' },
    { id: 'role_thriller_fugitive', label: 'Buronan yang harus membuktikan bahwa dirinya dijebak' },
  ],
}

export const ROLE_LABEL: Record<string, string> = {}
for (const entries of Object.values(ROLE_CATALOG_BY_GENRE)) {
  for (const e of entries) ROLE_LABEL[e.id] = e.label
}

/** 3 from primary + 1 from secondary, dedupe by id. */
export function buildRoleOptions(
  primary: GenreId | null,
  secondary: GenreId | null,
): RoleEntry[] {
  const result: RoleEntry[] = []
  const seen = new Set<string>()

  const primaryRoles = primary ? ROLE_CATALOG_BY_GENRE[primary] ?? [] : []
  for (const r of primaryRoles) {
    if (result.length >= 3) break
    if (seen.has(r.id)) continue
    seen.add(r.id)
    result.push(r)
  }

  const secondaryRoles = secondary ? ROLE_CATALOG_BY_GENRE[secondary] ?? [] : []
  for (const r of secondaryRoles) {
    if (result.length >= 4) break
    if (seen.has(r.id)) continue
    seen.add(r.id)
    result.push(r)
  }

  // Fill if still short
  if (result.length < 4) {
    for (const entries of Object.values(ROLE_CATALOG_BY_GENRE)) {
      for (const r of entries) {
        if (result.length >= 4) break
        if (seen.has(r.id)) continue
        seen.add(r.id)
        result.push(r)
      }
      if (result.length >= 4) break
    }
  }

  return result
}

export const RELATIONSHIP_OPTIONS: RoleEntry[] = [
  { id: 'relationship_family', label: 'Keluarga yang retak, tetapi masih ingin diselamatkan' },
  { id: 'relationship_uncertain_ally', label: 'Sekutu yang belum sepenuhnya bisa dipercaya' },
  { id: 'relationship_slow_romance', label: 'Seseorang yang perlahan menjadi cinta' },
  { id: 'relationship_rival', label: 'Rival yang terus memaksaku berubah' },
  { id: 'relationship_self_growth', label: 'Fokus pada perjalanan dan pemulihan diriku sendiri' },
]

export const AGENCY_OPTIONS: RoleEntry[] = [
  { id: 'agency_observe', label: 'Mengamati dulu, lalu bergerak saat sudah yakin' },
  { id: 'agency_direct', label: 'Menghadapi masalah secara langsung' },
  { id: 'agency_protective', label: 'Melindungi orang lain meski harus berkorban' },
  { id: 'agency_strategic', label: 'Menyusun rencana dan menyimpan kartu terakhir' },
]

export const RELATIONSHIP_LABEL: Record<string, string> = Object.fromEntries(
  RELATIONSHIP_OPTIONS.map((o) => [o.id, o.label]),
)
export const AGENCY_LABEL: Record<string, string> = Object.fromEntries(
  AGENCY_OPTIONS.map((o) => [o.id, o.label]),
)
