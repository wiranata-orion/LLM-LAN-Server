# Konfigurasi Jaringan dan OS

Dokumen ini menjelaskan konfigurasi jaringan lokal agar server Ollama dan server agent bisa diakses dengan stabil oleh client lain atau UI.

## Tujuan utama

- pastikan server berjalan di alamat IP yang konsisten
- aktifkan akses antar perangkat di jaringan lokal
- hindari masalah CORS dan hostname mismatch

## 1. Konfigurasi IP statis

Untuk jaringan rumah atau lab lokal, disarankan memakai IP statis pada mesin yang menjalankan Ollama dan agent.

### Windows

Buka pengaturan jaringan dan ubah konfigurasi IPv4 ke:

- IP: sesuaikan dengan jaringan lokal
- Subnet mask: biasanya `255.255.255.0`
- Gateway: router lokal
- DNS: router atau DNS publik

## 2. Layanan Ollama

Pastikan `ollama serve` berjalan secara permanen. Jika  memakai Windows, bisa diatur agar layanan berjalan otomatis saat start-up.

## 3. CORS dan origin frontend

Server agent membaca `CORS_ORIGIN` dari environment.

Contoh:

```env
CORS_ORIGIN=http://localhost:5173
```

Jika UI berjalan di port lain, tambahkan origin tersebut ke konfigurasi.

## 4. Akses dari perangkat lain

Jika client dijalankan di perangkat lain di jaringan lokal, gunakan URL server yang benar, misalnya:

```text
http://192.168.1.50:8787/api
```

Pastikan firewall tidak memblokir:

- port `8787` untuk agent-server
- port `11434` untuk Ollama

## 5. Firewall dan keamanan

Untuk mencegah akses tidak sah:

- batasi akses pada subnet lokal
- gunakan IP statis
- hindari membuka port secara publik tanpa kebutuhan

## 6. Troubleshooting

### Client tidak bisa terhubung

Cek:

1. apakah mesin target hidup
2. apakah port terbuka
3. apakah firewall memblokir koneksi
4. apakah URL benar

### UI tidak bisa menghubungi server

Pastikan:

- `OLLAMA_BASE_URL` benar
- `CORS_ORIGIN` mencakup origin frontend
- model chat/embedding sudah terunduh di Ollama

## 7. Rekomendasi deployment

Untuk penggunaan lokal yang stabil:

- pakai IP statis
- gunakan SSD
- aktifkan logging di server
- simpan data memori di folder yang konsisten