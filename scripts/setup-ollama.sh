#!/usr/bin/env bash
set -euo pipefail

# Setup Ollama untuk Local-LLM-DIY
# Penggunaan:
#   ./scripts/setup-ollama.sh [chat-model] [embed-model]
#
# Contoh:
#   ./scripts/setup-ollama.sh llama3.2:latest nomic-embed-text:latest

CHAT_MODEL="${1:-llama3.2:latest}"
EMBED_MODEL="${2:-nomic-embed-text:latest}"

if ! command -v ollama >/dev/null 2>&1; then
  echo "[ERROR] Ollama tidak ditemukan di PATH."
  echo "Pastikan Ollama sudah terinstall dan bisa dijalankan dari terminal."
  exit 1
fi

echo "[1/3] Menjalankan server Ollama..."
ollama serve >/tmp/local-llm-ollama.log 2>&1 &
OLLAMA_PID=$!
sleep 3

if ! curl -fsS http://127.0.0.1:11434/api/version >/tmp/local-llm-ollama-version.txt 2>/dev/null; then
  echo "[ERROR] Ollama gagal dijalankan. Cek log di /tmp/local-llm-ollama.log"
  exit 1
fi

echo "[2/3] Mengunduh model chat: $CHAT_MODEL"
ollama pull "$CHAT_MODEL"

echo "[3/3] Mengunduh model embedding: $EMBED_MODEL"
ollama pull "$EMBED_MODEL"

echo

echo "Setup selesai. Model yang tersedia:"
echo "  - Chat     : $CHAT_MODEL"
echo "  - Embedding: $EMBED_MODEL"
echo

echo "Untuk melihat model yang sudah ada, jalankan:"
echo "  ollama list"
echo "Untuk menghentikan server Ollama, jalankan:"
echo "  kill $OLLAMA_PID"
