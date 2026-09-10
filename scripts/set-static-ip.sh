#!/usr/bin/env bash
set -euo pipefail

# Set IP statis pada Linux dengan NetworkManager
# Penggunaan:
#   ./scripts/set-static-ip.sh <interface> <ip-address> <gateway> [dns1] [dns2]
#
# Contoh:
#   ./scripts/set-static-ip.sh eth0 192.168.1.50 192.168.1.1 8.8.8.8 1.1.1.1

if [ "$#" -lt 3 ]; then
  echo "[ERROR] Penggunaan salah."
  echo "  ./scripts/set-static-ip.sh <interface> <ip-address> <gateway> [dns1] [dns2]"
  echo
  echo "Contoh:"
  echo "  ./scripts/set-static-ip.sh eth0 192.168.1.50 192.168.1.1 8.8.8.8 1.1.1.1"
  exit 1
fi

INTERFACE="$1"
IP_ADDRESS="$2"
GATEWAY="$3"
DNS1="${4:-8.8.8.8}"
DNS2="${5:-1.1.1.1}"

if ! command -v nmcli >/dev/null 2>&1; then
  echo "[ERROR] nmcli tidak ditemukan. Script ini hanya mendukung Linux dengan NetworkManager."
  echo "Jika Anda memakai Windows, atur IP statis melalui Settings > Network & Internet > Ethernet."
  exit 1
fi

CONNECTION_NAME=$(nmcli -t -f DEVICE,NAME connection show 2>/dev/null | awk -v dev="$INTERFACE" '$1==dev {print $2; exit}')

if [ -z "$CONNECTION_NAME" ]; then
  echo "[ERROR] Tidak ditemukan koneksi aktif untuk interface $INTERFACE."
  exit 1
fi

echo "[1/3] Menetapkan IP statis pada interface $INTERFACE"
nmcli connection modify "$CONNECTION_NAME" \
  ipv4.method manual \
  ipv4.addresses "${IP_ADDRESS}/24" \
  ipv4.gateway "$GATEWAY" \
  ipv4.dns "${DNS1},${DNS2}" \
  ipv4.ignore-auto-dns no

echo "[2/3] Mengaktifkan koneksi ulang"
nmcli connection up "$CONNECTION_NAME"

echo "[3/3] Konfigurasi selesai"
echo

echo "Cek hasil konfigurasi dengan:"
echo "  nmcli device show $INTERFACE"
