# Web UI

Frontend Vue 3 ini dipakai sebagai antarmuka pengguna untuk proyek `Local-LLM-DIY`. UI memungkinkan  melakukan chat dengan model lokal, mengelola percakapan, memilih model, serta memanfaatkan memori lintas percakapan.

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
