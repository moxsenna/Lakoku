/**
 * M10-D1 authored bank registry.
 *
 * Every judge-visible paragraph is hand-authored per universe and rubric in
 * `./banks/*`. There is no prose generator: no template, no token substitution,
 * and no tier/rubric commentary may enter reader-visible text. Authoring rules
 * live in `./banks/AUTHORING_BRIEF.md` and reviewer inspection of those banks is
 * the final authority.
 */

import type { D1AuthoredBank, D1RubricId, D1UniverseId } from './corpus'

import { PESISIR_UTARA_D_R1 } from './banks/pesisir-utara-d-r1'
import { PESISIR_UTARA_D_R2 } from './banks/pesisir-utara-d-r2'
import { PESISIR_UTARA_D_R3 } from './banks/pesisir-utara-d-r3'
import { PESISIR_UTARA_D_R4 } from './banks/pesisir-utara-d-r4'
import { PESISIR_UTARA_D_R5 } from './banks/pesisir-utara-d-r5'
import { PESISIR_UTARA_D_R6 } from './banks/pesisir-utara-d-r6'
import { PESISIR_UTARA_D_R7 } from './banks/pesisir-utara-d-r7'
import { PESISIR_UTARA_D_R8 } from './banks/pesisir-utara-d-r8'
import { LEMBAH_AWAN_D_R1 } from './banks/lembah-awan-d-r1'
import { LEMBAH_AWAN_D_R2 } from './banks/lembah-awan-d-r2'
import { LEMBAH_AWAN_D_R3 } from './banks/lembah-awan-d-r3'
import { LEMBAH_AWAN_D_R4 } from './banks/lembah-awan-d-r4'
import { LEMBAH_AWAN_D_R5 } from './banks/lembah-awan-d-r5'
import { LEMBAH_AWAN_D_R6 } from './banks/lembah-awan-d-r6'
import { LEMBAH_AWAN_D_R7 } from './banks/lembah-awan-d-r7'
import { LEMBAH_AWAN_D_R8 } from './banks/lembah-awan-d-r8'

export const D1_AUTHORED_BANKS: Readonly<Record<D1UniverseId, Readonly<Record<D1RubricId, D1AuthoredBank>>>> = {
  'pesisir-utara': {
    'D-R1': PESISIR_UTARA_D_R1,
    'D-R2': PESISIR_UTARA_D_R2,
    'D-R3': PESISIR_UTARA_D_R3,
    'D-R4': PESISIR_UTARA_D_R4,
    'D-R5': PESISIR_UTARA_D_R5,
    'D-R6': PESISIR_UTARA_D_R6,
    'D-R7': PESISIR_UTARA_D_R7,
    'D-R8': PESISIR_UTARA_D_R8,
  },
  'lembah-awan': {
    'D-R1': LEMBAH_AWAN_D_R1,
    'D-R2': LEMBAH_AWAN_D_R2,
    'D-R3': LEMBAH_AWAN_D_R3,
    'D-R4': LEMBAH_AWAN_D_R4,
    'D-R5': LEMBAH_AWAN_D_R5,
    'D-R6': LEMBAH_AWAN_D_R6,
    'D-R7': LEMBAH_AWAN_D_R7,
    'D-R8': LEMBAH_AWAN_D_R8,
  },
}

/**
 * Structural context per universe. Descriptive only; never reader-visible and
 * never a statement about tier or rubric outcome.
 */
export const D1_UNIVERSE_CONTEXT: Readonly<Record<D1UniverseId, {
  storyPromise: string
  mainConflict: string
  finalDramaticQuestion: string
  activeThreadSummaries: readonly string[]
  resolvedThreadSummaries: readonly string[]
  payoffSchedule: readonly string[]
  lockedEndingKey: string
}>> = {
  'pesisir-utara': {
    storyPromise: 'Sari membongkar manifes palsu di Tanjung Rembang tanpa mewarisi cara Regent Damar.',
    mainConflict: 'Kantor izin pelabuhan memalsukan daftar muatan untuk menutupi awak yang dipaksa berlayar di jalur garam.',
    finalDramaticQuestion: 'Akankah Sari memilih keadilan yang sanggup ia pertanggungjawabkan setelah keluarganya ikut menandatangani diam?',
    activeThreadSummaries: [
      'Buku muatan jalur garam belum lengkap disalin.',
      'Latif masih terikat kontrak feri milik kantor izin.',
    ],
    resolvedThreadSummaries: ['Bu Hasnah berhenti menutupi selisih timbangan gudang.'],
    payoffSchedule: ['Cap lilin biru dipakai kembali saat sidang muatan.'],
    lockedEndingKey: 'tanjung-rembang-kesaksian-terbuka',
  },
  'lembah-awan': {
    storyPromise: 'Vina memulihkan lumbung benih Lembah Awan tanpa menukar giliran air tetangganya.',
    mainConflict: 'Mandor Bagas menjatah air terasering dan menyembunyikan benih tercemar di lumbung atas.',
    finalDramaticQuestion: 'Akankah Vina mempertahankan tanah keluarganya tanpa mengambil jatah orang lain?',
    activeThreadSummaries: [
      'Kartu jatah air terasering atas belum diperbarui.',
      'Danu masih memetik di kebun milik mandor.',
    ],
    resolvedThreadSummaries: ['Mbah Ripto menyerahkan catatan jam air lama.'],
    payoffSchedule: ['Karung benih bertanda kapur dibuka di depan warga.'],
    lockedEndingKey: 'lembah-awan-jatah-air-terbuka',
  },
}
