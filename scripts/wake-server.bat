@echo off
set MAC= # MAC address PC Server
set BROADCAST= # broadcast address PC Server
set SERVER_IP= # IP address PC Server

powershell -NoProfile -ExecutionPolicy Bypass -Command "& { " ^
    "$ip = '%SERVER_IP%';" ^
    "$mac = '%MAC%';" ^
    "$bc = '%BROADCAST%';" ^
    "Write-Host 'Memeriksa status PC Server (' $ip ')...';" ^
    "if (Test-Connection -ComputerName $ip -Count 1 -Quiet) { Write-Host '[STATUS] PC Server SUDAH NYALA / ONLINE dari awal!' -ForegroundColor Green; exit }" ^
    "Write-Host 'PC Server tidak merespons ping. Mengirim paket Wake-on-LAN...';" ^
    "try {" ^
    "   $m = $mac -replace '[:\-]','';" ^
    "   $bytes = [byte[]](@(255)*6 + ($m -split '(..)' | Where-Object {$_} | ForEach-Object {[byte]('0x' + $_)})*16);" ^
    "   $client = New-Object System.Net.Sockets.UdpClient;" ^
    "   $client.Connect([System.Net.IPAddress]::Parse($bc), 9);" ^
    "   $sent = $client.Send($bytes, $bytes.Length);" ^
    "   $client.Close();" ^
    "   if ($sent -eq 102) { Write-Host '[BERHASIL] Magic Packet terkirim ke kabel LAN.' -ForegroundColor Green; Write-Host 'Menunggu PC Server booting...' }" ^
    "   else { Write-Host '[GAGAL] Ukuran paket tidak sesuai.' -ForegroundColor Red; exit }" ^
    "} catch { Write-Host '[GAGAL] Gagal mengirim paket WoL.' -ForegroundColor Red; exit }" ^
    "$online = $false;" ^
    "for ($i = 1; $i -le 15; $i++) {" ^
    "   Start-Sleep -Seconds 2;" ^
    "   if (Test-Connection -ComputerName $ip -Count 1 -Quiet) { $online = $true; break }" ^
    "}" ^
    "if ($online) { Write-Host '[STATUS] PC Server SEKARANG SUDAH NYALA / ONLINE!' -ForegroundColor Green }" ^
    "else { Write-Host '[STATUS] Server belum merespons ping (' $ip ').' -ForegroundColor Yellow }" ^
"}"

echo.
pause