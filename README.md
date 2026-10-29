# Monitoring Presensi Al-Bahjah

Dashboard web untuk memantau presensi karyawan dari mesin sidik jari ZKTeco. Aplikasi ini membantu operator melihat log kehadiran, mengelola data karyawan dan admin, melakukan sinkronisasi mesin, serta mengunduh laporan.

## Fitur utama

- Dasbor pemantauan log scan dan ringkasan kehadiran hari ini.
- Sinkronisasi data pengguna dan log dari mesin ZKTeco.
- Status koneksi mesin absensi tanpa mengekspos IP internal ke browser.
- Pengelolaan karyawan dan pemetaan UID perangkat.
- Pengelolaan akun admin dengan peran `superadmin`, `sdm`, dan `admin`.
- Pembatasan data per departemen untuk peran manager.
- Catatan izin/cuti, laporan Excel, dan halaman cetak PDF.
- Login berbasis cookie JWT dan proteksi rute aplikasi.

## Teknologi

- Next.js 16 (App Router) dan React 19
- MySQL melalui `mysql2`
- ZKTeco melalui `node-zklib`
- Tailwind CSS 4 dan Recharts
- PM2 untuk menjalankan proses production

## Persyaratan

- Node.js 20 atau lebih baru
- npm
- MySQL 8 atau yang kompatibel
- Akses jaringan dari server aplikasi ke mesin ZKTeco

## Instalasi lokal

1. Clone repository lalu pasang dependensi.

   ```bash
   git clone https://github.com/rzarxx/monitoring-presensi-albahjah.git
   cd monitoring-presensi-albahjah
   npm ci
   ```

2. Buat file environment dari template.

   ```bash
   cp .env.example .env
   ```

   Pada Windows PowerShell gunakan:

   ```powershell
   Copy-Item .env.example .env
   ```

3. Isi `.env` dengan kredensial database, alamat mesin, akun bootstrap, dan `JWT_SECRET` yang kuat. Jangan pernah commit file `.env`.

4. Siapkan database kosong lalu buat tabel awal.

   ```bash
   node scripts/init-db.js
   ```

   > Peringatan: perintah ini menghapus tabel `admins`, `employees`, `attendance_logs`, dan `leaves` pada database yang dikonfigurasi. Gunakan hanya pada database baru atau setelah backup terverifikasi.

5. Jalankan mode pengembangan.

   ```bash
   npm run dev
   ```

   Buka `http://localhost:3000` lalu masuk memakai akun yang telah dibuat.

## Mengaktifkan multi-mesin

Untuk database yang sudah berisi data, lakukan backup database terlebih dahulu. Kemudian jalankan migrasi non-destruktif berikut satu kali:

```bash
npm run migrate:devices
```

Migrasi membuat segment, perangkat, dan pemetaan pengguna perangkat. Semua log lama dipertahankan dan dipetakan ke mesin `LEGACY-01`; tidak ada tabel presensi yang dihapus. Setelah itu, masuk sebagai Super Admin ke menu **Mesin** untuk membuat segment dan menambahkan perangkat Solution X105 atau X103. Data dasbor, sinkronisasi, statistik, serta ekspor dipilih per mesin.

## Konfigurasi environment

| Variabel | Kegunaan |
| --- | --- |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Koneksi MySQL. |
| `ZK_IP`, `ZK_PORT` | Alamat mesin ZKTeco. |
| `MOCK_ZK` | Gunakan `true` hanya untuk data contoh lokal. |
| `ADMIN_USER`, `ADMIN_PASSWORD` | Akun bootstrap saat tabel admin belum berisi data. Gunakan nilai yang kuat. |
| `JWT_SECRET` | Kunci penandatanganan sesi JWT; wajib unik dan rahasia. |
| `NEXT_PUBLIC_APP_URL` | URL publik aplikasi, misalnya `https://absensi.example.org`. Nilai ini dipakai saat build untuk metadata publik. |
| `SYNC_CRON_TOKEN` | Token rahasia khusus cron server untuk memulai sinkronisasi incremental. Jangan gunakan atau ekspos sebagai token pengguna. |

## Cara menggunakan

1. Masuk ke halaman `/login`.
2. Pada dasbor, periksa status mesin dan gunakan **Sinkronkan** untuk menarik log terbaru.
3. Kelola UID, nama, dan departemen karyawan melalui menu **Karyawan**.
4. Superadmin dapat mengelola akun melalui menu **Admin**.
5. Filter dan unduh laporan dari dasbor dalam format Excel atau PDF.
6. Super Admin dapat membuka menu **Aktivitas** untuk memeriksa riwayat sinkronisasi dan error mesin tanpa akses terminal.

## Sinkronisasi terjadwal dan log operasional

Setelah deployment, jalankan migrasi non-destruktif berikut satu kali untuk membuat tabel audit operasional:

```bash
npm run migrate:operations
```

Lalu jadwalkan cron Linux setiap 15 menit. Simpan token hanya pada file environment yang dapat dibaca root, lalu gunakan nilainya sebagai header `Authorization`; jangan menaruh token dalam repository atau browser.

```cron
*/15 * * * * curl --fail --silent --show-error --max-time 30 -X POST https://presensi.example.org/api/cron/sync -H "Authorization: Bearer TOKEN_RAHASIA_CRON" -H "Content-Type: application/json" --data '{}'
```

Endpoint ini selalu menjalankan sync incremental untuk semua mesin aktif dan menggabungkan pemanggilan cron yang bertumpuk ke job yang sedang berjalan. Interval 15 menit adalah titik awal yang aman; naikkan menjadi 30 menit bila satu siklus belum selesai sebelum jadwal berikutnya. Jangan kembalikan auto-sync saat login, karena login banyak pengguna dapat memicu pembacaan mesin berulang.

## Struktur proyek

```text
app/                 Halaman Next.js, komponen, dan API route handlers
app/api/             Endpoint autentikasi, sinkronisasi, laporan, dan data
app/components/      Shell dashboard, modal, grafik, dan metrik
lib/                 Koneksi MySQL, sesi, dan integrasi ZKTeco
scripts/init-db.js   Inisialisasi ulang skema database (destruktif)
public/              Logo dan aset publik
proxy.js             Proteksi rute berbasis sesi JWT
```

## Build dan menjalankan production

Build menghasilkan bundle production di `.next`:

```bash
npm run build
npm run start
```

Untuk server yang menggunakan PM2, jangan menjalankan `npm run start` secara manual jika proses sudah dikelola PM2. Setelah perubahan source:

```bash
npm run build
pm2 restart presensi --update-env
pm2 status presensi
```

Lakukan hard refresh pada browser setelah deploy agar aset lama dari cache tidak tampil.

## Keamanan operasional

- Simpan semua kredensial hanya di `.env`; file tersebut sengaja diabaikan Git.
- Gunakan `JWT_SECRET` acak yang panjang dan ganti akun bootstrap sebelum aplikasi dipakai.
- Pastikan aplikasi memakai HTTPS. Cookie sesi production harus diamankan pada konfigurasi deployment.
- Jangan menjalankan `scripts/init-db.js` pada database production tanpa backup yang dapat dipulihkan.
- Batasi akses jaringan mesin ZKTeco hanya dari server aplikasi yang diperlukan.

## Perintah yang tersedia

| Perintah | Kegunaan |
| --- | --- |
| `npm run dev` | Menjalankan server pengembangan. |
| `npm run lint` | Memeriksa aturan ESLint. |
| `npm run build` | Membuat build production. |
| `npm run start` | Menjalankan build production secara langsung. |
| `npm run migrate:devices` | Menambahkan skema multi-mesin tanpa menghapus log lama. |
| `npm run migrate:operations` | Menambahkan tabel log operasional non-destruktif. |

## Lisensi

Belum ada lisensi publik yang ditetapkan. Hubungi pemilik repository sebelum menggunakan atau mendistribusikan ulang proyek ini.
