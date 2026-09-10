# Persiapan Ollama

Dokumen ini menjelaskan cara menyiapkan Ollama agar server agent bisa berjalan dengan model chat dan embedding.

## Langkah 1: Instal Ollama

Unduh dan install Ollama sesuai sistem operasi . Setelah terinstall, jalankan:

```bash
ollama serve
```

## Langkah 2: Pull model chat

Pilih model yang cocok untuk percakapan. Contoh:

```bash
ollama pull llama3.2:latest
```

 juga bisa memakai model lain yang tersedia di Ollama, seperti Qwen, Mistral, atau model lokal lainnya.

## Langkah 3: Pull model embedding

Embedding dipakai untuk retrieval semantik. Contoh:

```bash
ollama pull nomic-embed-text:latest
```

## Langkah 4: Verifikasi server

Cek API version:

```bash
curl http://127.0.0.1:11434/api/version
```

Cek model yang sudah terunduh:

```bash
curl http://127.0.0.1:11434/api/tags
```

## Langkah 5: Konfigurasi environment

Pada file `agent-server/.env`, pastikan variabel berikut sudah sesuai:

```env
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_CHAT_MODEL=llama3.2:latest
OLLAMA_EMBED_MODEL=nomic-embed-text:latest
```

## Catatan penting

- Gunakan model chat yang benar-benar support chat, bukan model embedding seperti `nomic-embed-text`.
- Pastikan server Ollama aktif sebelum menjalankan `agent-server`.
- Jika error muncul saat fetching model, cek apakah Ollama sedang berjalan di port yang benar.

## Troubleshooting

### Ollama tidak bisa dijalankan

1. Cek apakah port 11434 sedang dipakai.
2. Cek apakah komponen Ollama sudah terinstal dengan benar.
3. Jalankan ulang `ollama serve`.

### Model tidak muncul di API

1. Jalankan `ollama pull <nama-model>`
2. Cek `curl http://127.0.0.1:11434/api/tags`
3. Pastikan nama model yang dikonfigurasi sesuai dengan yang ada di Ollama

## Model yang disarankan

- Chat: `llama3.2:latest`
- Embedding: `nomic-embed-text:latest`