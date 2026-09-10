# Local LLM Agent Server

Backend Node.js + TypeScript ini berfungsi sebagai server agent lokal yang menghubungkan `web-ui`, Ollama, SQLite, dan vector store lokal untuk kebutuhan chat, retrieval, serta memori percakapan.

## Ringkasan cepat

Server ini menangani:

- chat dengan model lokal melalui Ollama
- ingest dokumen ke vector store
- retrieval hybrid (semantic + keyword)
- penyimpanan raw history ke SQLite
- ringkasan sesi dan fakta sesi
- endpoint API untuk frontend dan client lain

## Struktur folder

```text
agent-server/
├── src/
│   ├── config.ts              # konfigurasi environment dan validasi
│   ├── types.ts               # kontrak domain bersama
│   ├── ollama.ts              # client chat, embedding, dan health check ke Ollama
│   ├── chunker.ts             # pemecah chunk berdasarkan paragraf dan kalimat
│   ├── vector-store.ts        # vector store lokal berbasis JSON
│   ├── memory-core.ts         # SQLite + memori hybrid (raw log, summary, facts)
│   ├── ingestion.ts           # dokumen -> chunks -> embeddings
│   ├── retriever.ts           # pencarian similarity
│   ├── orchestrator.ts        # alur RAG + tool calling
│   ├── routes.ts              # endpoint HTTP
│   ├── server.ts              # composition root Express
│   └── tools/
│       ├── registry.ts        # definisi tool yang dikirim ke Ollama
│       └── executor.ts        # handler tool yang diizinkan
├── data/
│   ├── memory_core.sqlite     # raw history percakapan
│   └── vector-store.json      # indeks semantik lokal
├── package.json
├── tsconfig.json
├── README.md
└── dist/                     # hasil build TypeScript
```

## Arsitektur kerja

### 1. Memori raw SQLite

`data/memory_core.sqlite` adalah sumber utama riwayat percakapan. Tiap chat user dan assistant disimpan secara permanen ke tabel `conversations`.

```sql
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  sender TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}'
);
```

### 2. Vector store lokal

`data/vector-store.json` dipakai sebagai indeks semantik untuk pencarian relevan. File ini dapat dibangun ulang kembali dari SQLite, sehingga portable dan tidak bergantung pada layanan vector database pihak ketiga.

### 3. Retrieval hybrid

Server melakukan pencarian dengan kombinasi:

- semantic search menggunakan embedding dari Ollama
- keyword overlap dari pesan raw
- ringkasan sesi dan fakta sesi jika tersedia

Jika model embedding tidak tersedia, sistem tetap dapat melakukan retrieval berbasis kata kunci.

### 4. Orchestrator

`orchestrator.ts` melakukan:

1. menambahkan pesan user terbaru ke memori
2. mencari konteks relevan
3. membangun prompt sistem + konteks
4. mengirim permintaan ke Ollama
5. menjalankan tool bila model mengajukannya
6. menyimpan response assistant ke memori

## Setup cepat

```bash
cd agent-server
npm install
ollama pull llama3.2:latest
ollama pull nomic-embed-text:latest
npm run dev
```

Pastikan variabel `OLLAMA_CHAT_MODEL` dan `OLLAMA_EMBED_MODEL` sudah benar di environment.

## Konfigurasi utama

Buat file `.env` berdasarkan environment yang dibutuhkan, lalu atur variabel berikut:

- `OLLAMA_BASE_URL` : URL server Ollama aktif
- `OLLAMA_CHAT_MODEL` : model chat, misalnya `llama3.2:latest`
- `OLLAMA_EMBED_MODEL` : model embedding, misalnya `nomic-embed-text:latest`
- `MEMORY_ROOT` : folder data lokal
- `VECTOR_STORE_PATH` : lokasi file vector store
- `MEMORY_DB_PATH` : lokasi file SQLite memori
- `MAX_RETRIEVED_CHUNKS` : jumlah hasil retrieval maksimal
- `RAG_MIN_SCORE` : ambang skor retrieval
- `MAX_TOOL_ROUNDS` : batas aman perulangan tool call
- `CORS_ORIGIN` : origin frontend yang diizinkan

## Endpoint API

### 1. Health check

```bash
curl http://127.0.0.1:8787/api/health
```

### 2. Ingest dokumen

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

Body request dapat mencakup:

- `messages` : daftar pesan chat
- `conversationId` : ID sesi untuk memisahkan percakapan
- `model` : model yang dipilih
- `stream` : bila `true`, server akan mengembalikan stream NDJSON

### 4. Streaming chat

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

## Perilaku memori

Server ini menyimpan semua input dari user dan output assistant ke SQLite. Itu artinya:

- riwayat obrolan tetap tersimpan secara lokal
- retriever dapat mencari konteks lama saat chat baru datang
- sesi yang berbeda dapat dipisahkan dengan `conversationId`

## Validasi dan build

```bash
npm run typecheck
npm run build
```

## Dokumen terkait

- [README utama](../README.md)
- [README web-ui](../web-ui/README.md)
- [docs/client-integration.md](../docs/client-integration.md)
- [docs/memory-architecture.md](../docs/memory-architecture.md)
- [docs/ollama-setup.md](../docs/ollama-setup.md)
- [docs/os-network-config.md](../docs/os-network-config.md)
- [docs/universal-central-memory.md](../docs/universal-central-memory.md)
