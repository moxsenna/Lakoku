import type { Metadata } from 'next'
import Link from 'next/link'
import { LegalPage } from '@/components/legal/legal-page'

export const metadata: Metadata = {
  title: 'Syarat Layanan — Lakoku',
  description: 'Syarat penggunaan layanan novel interaktif Lakoku.',
  robots: { index: true, follow: true },
}

export default function TermsPage() {
  return (
    <LegalPage title="Syarat Layanan" updated="22 Juli 2026">
      <p>
        Dengan mengakses atau memakai <strong className="text-foreground">Lakoku</strong> di{' '}
        <a href="https://lakoku.appvibe.biz.id">https://lakoku.appvibe.biz.id</a> (&quot;Layanan&quot;),
        kamu menyetujui syarat ini. Jika tidak setuju, jangan gunakan Layanan.
      </p>

      <h2>1. Tentang layanan</h2>
      <p>
        Lakoku adalah platform novel interaktif: kamu membaca cerita, mengambil pilihan, dan (sesuai
        fitur) membuat atau melanjutkan cerita dengan bantuan model AI. Fitur dapat berubah seiring
        pengembangan.
      </p>

      <h2>2. Akun</h2>
      <ul>
        <li>Kamu bertanggung jawab menjaga kerahasiaan kredensial atau akses akun Google yang terhubung.</li>
        <li>Informasi akun harus akurat sepanjang wajar.</li>
        <li>Kami dapat menangguhkan atau menutup akun yang melanggar syarat atau membahayakan sistem.</li>
      </ul>

      <h2>3. Konten &amp; AI</h2>
      <ul>
        <li>
          Prosa, pilihan, dan keluaran AI bersifat fiksi dan dapat mengandung ketidakkonsistenan
          atau kesalahan. Jangan andalkan sebagai nasihat profesional, medis, hukum, atau finansial.
        </li>
        <li>
          Kamu tetap bertanggung jawab atas input yang kamu berikan (ide, premis, laporan, dll.) dan
          agar tidak melanggar hak pihak ketiga.
        </li>
        <li>
          Kami dapat memoderasi, membatasi, atau menghapus konten yang melanggar hukum, mengandung
          penyalahgunaan, atau merusak pengalaman pengguna lain / infrastruktur.
        </li>
      </ul>

      <h2>4. Penggunaan yang diizinkan</h2>
      <p>Kamu setuju untuk tidak:</p>
      <ul>
        <li>Menyalahgunakan API, melewati batas kredit/kuota, atau membebani sistem secara tidak wajar.</li>
        <li>Mencoba akses tanpa otorisasi, mengganggu keamanan, atau merekayasa balik di luar yang diizinkan hukum.</li>
        <li>Mengunggah malware, spam, atau materi ilegal.</li>
        <li>Menyamar sebagai orang/entitas lain dengan niat menipu.</li>
      </ul>

      <h2>5. Kredit &amp; pembayaran</h2>
      <p>
        Sebagian fitur dapat memakai kredit atau pembayaran. Harga, bonus, dan paket ditampilkan di
        antarmuka. Kecuali diwajibkan hukum, pembelian digital umumnya final setelah diproses.
        Penyedia pembayaran pihak ketiga dapat memiliki syarat terpisah.
      </p>

      <h2>6. Kekayaan intelektual</h2>
      <p>
        Merek, antarmuka, dan perangkat lunak Lakoku dilindungi. Kecuali dinyatakan lain, kamu
        mendapat lisensi terbatas, non-eksklusif, tidak dapat dipindahtangankan untuk memakai
        Layanan sesuai syarat ini. Hak atas keluaran cerita mengikuti kebijakan platform yang
        berlaku dan hukum yang relevan; kami dapat memakai data teknis agregat/anonim untuk
        memperbaiki Layanan.
      </p>

      <h2>7. Ketersediaan</h2>
      <p>
        Layanan disediakan &quot;sebagaimana adanya&quot;. Kami tidak menjamin uptime penuh, tidak
        adanya bug, atau bahwa keluaran AI selalu memenuhi harapan. Pemeliharaan atau gangguan dapat
        terjadi tanpa pemberitahuan sebelumnya.
      </p>

      <h2>8. Batasan tanggung jawab</h2>
      <p>
        Sejauh diizinkan hukum, Lakoku dan pengelolanya tidak bertanggung jawab atas kerugian tidak
        langsung, insidental, kehilangan data, atau kehilangan keuntungan yang timbul dari
        penggunaan atau ketidakmampuan memakai Layanan. Tanggung jawab agregat dibatasi sejauh
        maksimal yang diizinkan hukum setempat.
      </p>

      <h2>9. Penghentian</h2>
      <p>
        Kamu dapat berhenti memakai Layanan kapan saja. Kami dapat membatasi akses jika ada
        pelanggaran, risiko keamanan, atau kewajiban hukum. Bagian syarat yang secara sifatnya
        tetap berlaku (mis. batasan tanggung jawab) tetap berlaku setelah penghentian.
      </p>

      <h2>10. Perubahan syarat</h2>
      <p>
        Kami dapat memperbarui syarat ini. Tanggal pembaruan ditampilkan di bagian atas. Penggunaan
        setelah perubahan berarti penerimaan versi baru, kecuali hukum mewajibkan persetujuan
        eksplisit.
      </p>

      <h2>11. Privasi</h2>
      <p>
        Pemrosesan data pribadi dijelaskan di{' '}
        <Link href="/privacy">Kebijakan Privasi</Link>.
      </p>

      <h2>12. Hukum yang berlaku</h2>
      <p>
        Syarat ini ditafsirkan sesuai hukum yang berlaku di yurisdiksi tempat pengelola Layanan
        beroperasi, tanpa mengesampingkan hak konsumen wajib yang tidak dapat dikesampingkan.
      </p>

      <h2>13. Kontak</h2>
      <p>
        Pertanyaan tentang syarat ini: hubungi pengelola Lakoku melalui kanal dukungan di situs.
      </p>
    </LegalPage>
  )
}
