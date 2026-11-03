/**
 * Pembentuk pesan undangan referral.
 *
 * Fungsi murni supaya bisa diuji tanpa browser. Teks ditulis untuk penerima:
 * tidak menyebut imbalan, komisi, atau progres si pengundang.
 */

export interface ReferralInvite {
  url: string
  title: string
  text: string
}

export function buildReferralInvite(code: string, origin: string): ReferralInvite {
  const base = origin.replace(/\/+$/, '')
  const url = `${base}/r/${code}`
  return {
    url,
    title: 'Lakoku — kamu tokoh utamanya',
    text: [
      'Aku lagi baca novel interaktif di Lakoku. Kamu yang jadi tokoh utamanya:',
      'setiap pilihan mengubah jalan cerita, dan ada banyak akhir yang bisa kamu temukan.',
      `Coba jalurmu di sini: ${url}`,
    ].join(' '),
  }
}
