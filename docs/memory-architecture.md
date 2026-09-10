# Arsitektur Memori

Dokumen ini menjelaskan bagaimana memori bekerja pada proyek ini dan bagaimana data disimpan serta diambil.

## Konsep utama

Proyek ini memakai kombinasi memori raw, fakta sesi, ringkasan sesi, dan vector store lokal.

### 1. Raw conversation log

Semua pesan user dan assistant disimpan ke SQLite di `agent-server/data/memory_core.sqlite`.

Tabel utama:

```sql
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  sender TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}'
);
```

Database ini berfungsi sebagai sumber kebenaran untuk riwayat percakapan.

### 2. Session summary

Saat jumlah pesan mencapai ambang tertentu, server membuat ringkasan sesi dan menyimpannya ke tabel `session_summaries`.

Tujuan:

- menjaga konteks ringkas
- mengurangi token yang dibawa setiap kali chat baru
- membantu model memahami inti percakapan

### 3. Structured facts

Server juga dapat menyimpan fakta terstruktur pada `facts` untuk sesi tertentu. Meskipun fitur ini masih berguna, desain saat ini mengutamakan riwayat percakapan sebagai sumber utama ingatan.

### 4. Vector store

File `agent-server/data/vector-store.json` berisi embedding lokal yang digunakan untuk pencarian semantik.

Vector store ini bersifat dapat dibangun ulang dari SQLite, sehingga data raw tetap aman dan portabel.

## Alur penyimpanan

Ketika chat masuk:

1. user message ditambahkan ke SQLite
2. server memanggil retrieval terhadap memori sebelumnya
3. model menerima konteks relevan
4. assistant response disimpan kembali ke SQLite

## Alur retrieval

Retrieval memakai pendekatan hybrid:

- semantic similarity via embedding
- keyword overlap
- ringkasan sesi dan fakta sesi

Dengan begitu, hasil retrieval lebih kuat daripada sekadar pencarian kata kunci murni.

## Perbedaan antara memori lokal dan memori UI

### Memori server

- disimpan di SQLite
- bersifat persisten
- melacak message raw dan summary

### Memori UI

Pada web UI, aplikasi juga punya mekanisme memori lintas percakapan berbasis localStorage dan file global memory.

Ini berarti, ketika folder penyimpanan tidak dipilih, UI tetap bisa menyimpan interaksi sebelumnya di browser sehingga chat berikutnya tetap punya konteks.

## Praktik terbaik

- jangan menghapus `memory_core.sqlite` secara sembarangan jika  ingin menjaga memori
- jika ingin reset memori, baru hapus file data dan mulai percakapan baru
- gunakan `conversationId` secara konsisten agar sesi tetap terisolasi

## Diagram alur sederhana

```text
User message
   -> append to SQLite
   -> search related memory
   -> build context
   -> send to Ollama
   -> append assistant response
```