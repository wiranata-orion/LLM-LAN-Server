# Web UI

Frontend Vue 3 ini dipakai sebagai antarmuka pengguna untuk proyek `Local-LLM-DIY`. UI memungkinkan Anda melakukan chat dengan model lokal, mengelola percakapan, memilih model, serta memanfaatkan memori lintas percakapan.

## Fitur utama

- chat streaming ke server agent
- pemisahan percakapan per `conversationId`
- manajemen folder dan chat
- pemilihan model aktif
- penyimpanan percakapan lokal dan memori lintas sesi
- integrasi dengan backend API agent-server

## Teknologi yang dipakai

- Vue 3
- Vite
- JavaScript / TypeScript support via Vue SFC
- Fetch API untuk komunikasi ke backend
- localStorage untuk fallback memori browser

## Struktur folder

```text
web-ui/
├── src/
├── public/
├── index.html
├── package.json
├── vite.config.js
├── postcss.config.js
└── README.md
```

## Cara menjalankan

### Install dependency

```bash
cd web-ui
npm install
```

### Jalankan mode development

```bash
npm run dev
```

### Build produksi

```bash
npm run build
```

### Preview hasil build

```bash
npm run preview
```

## Konfigurasi umum

Aplikasi ini mengirim request ke backend melalui default URL berikut:

```text
http://127.0.0.1:8787/api
```

Jika Anda ingin mengubah endpoint backend, bisa gunakan environment variable berikut saat run dev/build:

```bash
VITE_AGENT_SERVER_URL=http://127.0.0.1:8787/api
```

## Cara kerja UI

Saat pengguna mengirim pesan:

1. UI menambahkan pesan user ke percakapan aktif.
2. UI mengirim pesan dan riwayat yang relevan ke `agent-server`.
3. Backend memproses chat, retrieval, dan memory.
4. UI menampilkan response secara streaming.
5. Percakapan disimpan kembali ke storage lokal maupun folder penyimpanan yang dipilih.

## Memori di UI

UI memiliki dua lapisan memori:

- `global_memory.json` untuk interaksi lintas percakapan
- `localStorage` sebagai fallback jika folder penyimpanan eksternal belum dipilih

Dengan mekanisme ini, chat baru dapat memanfaatkan konteks dari chat sebelumnya selama query relevan.

## Setting yang tersedia

Aplikasi mendukung beberapa setting seperti:

- model aktif
- engine aktif (`Laptop` atau `PC Server`)
- tema UI
- folder penyimpanan memori

Setting ini tersimpan di browser storage dan dapat diubah melalui modal settings.

## Troubleshooting

### UI tidak bisa terhubung ke backend

- pastikan `agent-server` sedang berjalan
- cek apakah URL backend sudah benar
- cek apakah Ollama juga aktif dan model sudah terunduh

### Chat tidak mengingat percakapan lama

- cek apakah memori storage aktif atau browser storage tersedia
- pastikan `conversationId` tidak berubah secara acak
- cek apakah query Anda relevan dengan interaksi sebelumnya

## Tautan terkait

- [README utama](../README.md)
- [README backend](../agent-server/README.md)
- [Folder docs](../docs)
