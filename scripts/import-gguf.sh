#!/usr/bin/env bash
set -euo pipefail

# Import model GGUF ke Ollama
# Penggunaan:
#   ./scripts/import-gguf.sh <path-to-model.gguf> <model-name>
#
# Contoh:
#   ./scripts/import-gguf.sh ./models/llama-3.1-8b-instruct-q4_k_m.gguf llama3.1:8b

if [ "$#" -lt 2 ]; then
  echo "[ERROR] Penggunaan salah."
  echo "  ./scripts/import-gguf.sh <path-to-model.gguf> <model-name>"
  exit 1
fi

GGUF_PATH="$1"
MODEL_NAME="$2"

if ! command -v ollama >/dev/null 2>&1; then
  echo "[ERROR] Ollama tidak ditemukan di PATH."
  exit 1
fi

if [ ! -f "$GGUF_PATH" ]; then
  echo "[ERROR] File GGUF tidak ditemukan: $GGUF_PATH"
  exit 1
fi

TMP_FILE=$(mktemp)
trap 'rm -f "$TMP_FILE"' EXIT

cat > "$TMP_FILE" <<EOF
FROM $GGUF_PATH
TEMPLATE """{{ .Prompt }}"""
SYSTEM """Model ini diimport dari file GGUF untuk penggunaan lokal di Ollama."""
EOF

echo "[1/2] Membuat model $MODEL_NAME dari $GGUF_PATH"
ollama create "$MODEL_NAME" -f "$TMP_FILE"

echo "[2/2] Verifikasi model berhasil dibuat"
ollama list | grep "$MODEL_NAME" || true

echo

echo "Model siap digunakan. Contoh pemanggilan:"
echo "  ollama run $MODEL_NAME"
