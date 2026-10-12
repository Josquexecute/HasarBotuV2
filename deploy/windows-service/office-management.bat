@echo off
setlocal
pushd "%~dp0"
if errorlevel 1 exit /b 1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0enable-office-management.ps1" -Apply
set "CHECK_EXIT=%ERRORLEVEL%"
echo.
if "%CHECK_EXIT%"=="0" (
  echo Yerel SSH kontrolu gecti. Uzak baglanti kabulunu henuz tamamlamadik.
) else (
  echo Islem tamamlanamadi. Hata raporunu iletin.
  echo Bu BAT dosyasina sag tiklayip Yonetici olarak calistir secin.
)
echo Rapor: %~dp0ofis-yonetim-sonucu.json
pause
popd
exit /b %CHECK_EXIT%
