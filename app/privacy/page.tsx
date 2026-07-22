import type { Metadata } from 'next'
import Link from 'next/link'
import { LegalPage } from '@/components/legal/legal-page'

export const metadata: Metadata = {
  title: 'Kebijakan Privasi — Lakoku',
  description: 'Bagaimana Lakoku mengumpulkan, memakai, dan melindungi data pengguna.',
  robots: { index: true, follow: true },
}

export default function PrivacyPage() {
  return (
    <LegalPage title="Kebijakan Privasi" updated="22 Juli 2026">
      <p>
        Kebijakan ini menjelaskan bagaimana <strong className="text-foreground">Lakoku</strong>{' '}
        (&quot;kami&quot;) menangani informasi saat kamu memakai situs{' '}
        <a href="https://lakoku.biz.id">https://lakoku.biz.id</a> dan layanan
        terkait (novel interaktif, akun, kredit, dan fitur AI).
      </p>

      <h2>1. Data yang kami kumpulkan</h2>
      <ul>
        <li>
          <strong className="text-foreground">Akun:</strong> email, nama tampilan, dan (jika login
          Google) nama serta foto profil yang diberikan Google.
        </li>
        <li>
          <strong className="text-foreground">Konten &amp; progres:</strong> cerita yang kamu buat
          atau mainkan, pilihan bab, status baca, draf onboarding/selera (taste profile), dan data
          serupa yang diperlukan agar cerita tersimpan.
        </li>
        <li>
          <strong className="text-foreground">Transaksi (jika dipakai):</strong> status top-up
          kredit / pembayaran melalui penyedia pembayaran (kami tidak menyimpan nomor kartu penuh
          di server app).
        </li>
        <li>
          <strong className="text-foreground">Teknis:</strong> cookie/sesi autentikasi, log error
          operasional, dan metadata permintaan yang wajar untuk keamanan serta keandalan layanan.
        </li>
      </ul>

      <h2>2. Cara kami memakai data</h2>
      <ul>
        <li>Menyediakan login, menyimpan progres cerita, dan menampilkan konten personal.</li>
        <li>Menjalankan pembuatan prosa/pilihan cerita lewat model AI sesuai fitur yang kamu gunakan.</li>
        <li>Memproses kredit/entitlement dan mencegah penyalahgunaan.</li>
        <li>Memperbaiki bug, memantau kesehatan sistem, dan memenuhi kewajiban hukum yang berlaku.</li>
      </ul>

      <h2>3. Login dengan Google</h2>
      <p>
        Jika kamu memilih <strong className="text-foreground">Masuk dengan Google</strong>, Google
        membagikan data dasar profil (umumnya email, nama, dan foto) kepada penyedia autentikasi
        kami sesuai persetujuan di layar Google. Kami memakai data itu untuk membuat/menghubungkan
        akun Lakoku. Kebijakan Google terpisah berlaku untuk layanan Google.
      </p>

      <h2>4. Penyimpanan &amp; pemroses</h2>
      <p>
        Data akun dan aplikasi disimpan lewat infrastruktur cloud yang kami gunakan (termasuk
        database/auth terkelola). Data dapat diproses di wilayah server penyedia. Akses internal
        dibatasi untuk keperluan operasional.
      </p>

      <h2>5. Cookie &amp; sesi</h2>
      <p>
        Kami memakai cookie/sesi yang diperlukan agar kamu tetap masuk dan agar alur keamanan
        (misalnya OAuth) berfungsi. Menolak cookie penting dapat membuat login atau fitur akun tidak
        berjalan.
      </p>

      <h2>6. Berbagi data</h2>
      <p>Kami tidak menjual data pribadimu. Data dapat dibagikan terbatas kepada:</p>
      <ul>
        <li>Penyedia infrastruktur (hosting, auth, database, AI gateway) untuk menjalankan layanan.</li>
        <li>Penyedia pembayaran untuk transaksi yang kamu mulai.</li>
        <li>Otoritas hukum bila diwajibkan peraturan yang berlaku.</li>
      </ul>

      <h2>7. Retensi</h2>
      <p>
        Data akun dan progres disimpan selama akun aktif atau selama diperlukan untuk menyediakan
        layanan, menyelesaikan sengketa, dan memenuhi kewajiban hukum. Kamu dapat meminta penghapusan
        akun melalui kontak di bawah; sebagian log keamanan dapat dipertahankan sementara.
      </p>

      <h2>8. Keamanan</h2>
      <p>
        Kami menerapkan kontrol wajar (HTTPS, kontrol akses, sesi terautentikasi). Tidak ada metode
        transmisi/penyimpanan yang 100% aman; gunakan kata sandi unik jika memakai login email.
      </p>

      <h2>9. Anak di bawah umur</h2>
      <p>
        Layanan tidak ditujukan untuk anak di bawah usia yang diizinkan hukum setempat untuk
        menyetujui pemrosesan data tanpa wali. Jika kamu yakin kami memegang data anak tanpa dasar
        yang sah, hubungi kami.
      </p>

      <h2>10. Perubahan</h2>
      <p>
        Kebijakan ini dapat diperbarui. Tanggal &quot;Terakhir diperbarui&quot; di atas akan diubah.
        Penggunaan berkelanjutan setelah perubahan berarti kamu memahami versi terbaru.
      </p>

      <h2>11. Kontak</h2>
      <p>
        Pertanyaan privasi: hubungi pengelola Lakoku melalui kanal dukungan yang tertera di situs
        atau email dukungan yang kamu gunakan untuk operasional project. Lihat juga{' '}
        <Link href="/terms">Syarat Layanan</Link>.
      </p>
    </LegalPage>
  )
}
