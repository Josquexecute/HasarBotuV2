@echo off
setlocal
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -Command "try { Start-Process -FilePath ($env:SystemRoot + '\System32\WindowsPowerShell\v1.0\powershell.exe') -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File C:\ProgramData\HasarBotu\office-management\server-start\start-office-server.ps1' -Verb RunAs -WindowStyle Normal -ErrorAction Stop } catch { Write-Host ('Baslatilamadi: ' + $_.Exception.Message); exit 1 }"
if errorlevel 1 (
  echo Yonetici izni verilmedi veya baslatici acilamadi.
  pause
  exit /b 1
)
exit /b 0
