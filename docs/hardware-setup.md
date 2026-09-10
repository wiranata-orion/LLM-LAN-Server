# Persiapan Perangkat Keras

Dokumen ini membantu Anda memilih spesifikasi perangkat keras yang cocok untuk menjalankan model lokal dengan Ollama.

## Ringkasan cepat

Untuk penggunaan umum, biasanya cukup dengan:

- CPU modern dengan 8+ core
- RAM minimal 16 GB
- SSD NVMe atau SSD SATA yang cepat
- GPU NVIDIA dengan VRAM cukup jika Anda ingin performa lebih tinggi

## Pilihan deployment

### 1. Laptop/PC biasa

Cocok untuk:

- model kecil sampai menengah
- percakapan ringan
- eksperimen lokal

Rekomendasi:

- RAM 16 GB atau lebih
- SSD minimal 512 GB
- CPU quad-core atau lebih baik

### 2. Desktop dengan GPU

Cocok untuk:

- model menengah hingga besar
- penggunaan lebih sering
- batch inference atau multi-user ringan

Rekomendasi:

- GPU NVIDIA dengan VRAM 6 GB ke atas
- RAM 32 GB ke atas
- SSD NVMe untuk kecepatan loading model

### 3. Server mini atau NAS

Cocok untuk:

- layanan local yang selalu aktif
- akses dari beberapa client di jaringan lokal

Rekomendasi:

- RAM 32 GB
- CPU kuat atau GPU yang tersedia
- penyimpanan yang andal dan berkapasitas cukup

## Model yang cocok

- Model chat kecil: `llama3.2:latest`, `qwen2.5`, `mistral`
- Model embedding: `nomic-embed-text:latest`

Ukuran model akan memengaruhi kebutuhan RAM dan ruang penyimpanan. Jika model terlalu besar untuk perangkat Anda, pilih model yang lebih kecil.

## Tips performa

- Gunakan SSD, bukan HDD.
- Pastikan ruang swap cukup untuk model besar.
- Hindari menjalankan model terlalu banyak secara bersamaan.
- Pertimbangkan penggunaan GPU jika tersedia.

## Tips pendinginan

Jika Anda menjalankan model besar di komputer rumah:

- pastikan ventilasi cukup
- monitor suhu CPU dan GPU
- sesuaikan power limit jika perlu

## Keamanan dan stabilitas

- simpan data di folder yang aman
- jangan menjalankan server pada system drive jika ukuran model besar
- pastikan file SQLite dan vector-store tidak dipindah sembarangan saat server aktif

## Checklist setup cepat

1. Install Ollama
2. Unduh model chat dan embedding
3. Siapkan RAM dan SSD yang cukup
4. Jalankan `ollama serve`
5. Uji `curl http://127.0.0.1:11434/api/version`
6. Mulai server agent