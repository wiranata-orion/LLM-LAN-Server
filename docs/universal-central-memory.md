# Memori Pusat Universal

Dokumen ini menjelaskan pendekatan memori lintas percakapan yang dipakai oleh UI dan sistem lokal ini.

## Tujuan

Tujuan utama dari memori pusat universal adalah agar model dapat menggunakan informasi dari percakapan lama ketika itu relevan dengan pertanyaan baru.

## Prinsip

1. Tidak semua konteks harus otomatis dijadikan instruksi baru.
2. Memori harus relevan dengan query sekarang.
3. Informasi lama hanya dipakai jika memang berguna untuk konteks saat ini.
4. Data lama tidak boleh dibangun ulang secara berlebihan.

## Komponen utama

### 1. Global memory

UI menyimpan `global_memory.json` untuk menampung:

- `permanent_instructions`
- `interactions`
- `updatedAt`

Data ini dapat dipakai sebagai sumber konteks lintas obrolan.

### 2. Interaksi sebelumnya

Setiap chat yang selesai disimpan sebagai daftar interaksi. Interaksi tersebut berisi:

- `conversationId`
- `role`
- `content`
- `timestamp`

### 3. Pencarian relevan

Saat chat baru masuk, UI mencari percakapan lama yang relevan dengan query sekarang. Hasilnya dipakai sebagai ringkasan konteks sebelum request dikirim ke server.

## Cara kerja di UI

Saat user mengirim pesan:

1. aplikasi menghimpun query saat ini
2. memanggil fungsi `buildMemoryMessages`
3. mengambil `global_memory` dan percakapan relevan
4. menambahkan konteks tersebut di awal pesan sistem
5. mengirim seluruh paket ke backend

## Fallback lokal

Jika folder penyimpanan eksternal tidak dipilih, UI bisa memakai storage browser (localStorage) sebagai fallback.

Dengan cara ini, obrolan lama tetap bisa dipakai bahkan tanpa folder memori terpilih.

## Keterbatasan

- Memori browser bisa hilang jika cache dibersihkan.
- `global_memory.json` bukan pengganti database raw SQLite.
- Retrieval masih bergantung pada query dan relevansi teks.

## Praktik terbaik

- gunakan `conversationId` yang konsisten
- simpan interaksi yang memang relevan
- hindari menyimpan instruksi permanan yang terlalu ambigu
- selalu verifikasi apakah informasi lama benar-benar relevan sebelum digunakan

## Ringkasan singkat

Memori pusat universal di proyek ini berfungsi sebagai lapisan konteks lintas percakapan, sedangkan SQLite tetap menjadi sumber data raw yang lebih kuat dan portabel.