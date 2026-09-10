# Integrasi Client

Dokumen ini menjelaskan cara client berkomunikasi dengan server agent lokal. Proyek ini menyediakan endpoint HTTP di `http://127.0.0.1:8787/api` secara default.

## Endpoint utama

### 1. Health check

```bash
curl http://127.0.0.1:8787/api/health
```

Contoh respons:

```json
{
  "ok": true,
  "ollama": {
    "version": "0.6.0"
  }
}
```

### 2. Ingest dokumen

Endpoint ini menerima dokumen teks, memecahnya menjadi chunk, membuat embedding, lalu menyimpannya ke vector store lokal.

```bash
curl -X POST http://127.0.0.1:8787/api/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "documents": [
      {
        "source": "notes/profile.txt",
        "content": "Deployment LLM lokal berjalan di jaringan privat.",
        "metadata": { "category": "notes" }
      }
    ]
  }'
```

Respons:

```json
{
  "ok": true,
  "documents": 1,
  "chunks": 2,
  "embeddings": 2
}
```

### 3. Chat dengan agent

```bash
curl -X POST http://127.0.0.1:8787/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      { "role": "user", "content": "Apa yang ada di catatan deployment saya?" }
    ]
  }'
```

Body request dapat berisi:

- `messages`: daftar pesan chat yang sudah ada
- `conversationId`: ID sesi untuk memisahkan percakapan
- `model`: model chat yang dipilih
- `stream`: bila `true`, server akan mengembalikan stream NDJSON

Contoh respons non-stream:

```json
{
  "ok": true,
  "message": {
    "role": "assistant",
    "content": "Berdasarkan catatan lokal, deployment menggunakan Ollama di jaringan internal."
  },
  "toolRounds": 0,
  "retrievedChunks": 3
}
```

### 4. Streaming chat

Untuk UI interaktif, gunakan streaming agar token muncul satu per satu.

```bash
curl -N -X POST http://127.0.0.1:8787/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "stream": true,
    "messages": [
      { "role": "user", "content": "Ringkas catatan deployment saya." }
    ]
  }'
```

### 5. Ekspor memori

```bash
curl http://127.0.0.1:8787/api/memory/export -o memory.jsonl
```

### 6. Impor memori

```bash
curl -X POST http://127.0.0.1:8787/api/memory/import \
  -H "Content-Type: application/jsonl" \
  --data-binary @memory.jsonl
```

## Struktur percakapan

Gunakan `conversationId` agar satu sesi tetap terpisah dari sesi lain. Ini penting terutama saat  ingin memiliki beberapa obrolan yang independen.

## Catatan penting

- Server hanya menerima chat message yang valid.
- Retrieval memakai kombinasi semantic search dan keyword matching.
- Local vector store dapat dibangun ulang dari SQLite tanpa kehilangan raw history.
- Jika model embedding tidak tersedia, sistem tetap bisa melakukan keyword retrieval.

## Praktik terbaik

- Simpan `conversationId` di sisi client untuk memisahkan tema dan konteks.
- Gunakan `stream: true` untuk UX yang lebih terasa hidup.
- Pertahankan `memory_core.sqlite` dan `vector-store.json` jika  ingin memindahkan memori antar mesin.