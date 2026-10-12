@echo off
setlocal
pushd "%~dp0"
if errorlevel 1 exit /b 1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0inspect-office-readiness.ps1"
set "CHECK_EXIT=%ERRORLEVEL%"
if "%CHECK_EXIT%"=="0" if not exist "%~dp0ofis-kontrol-sonucu.json" set "CHECK_EXIT=1"
echo.
if "%CHECK_EXIT%"=="0" (
  echo Rapor: %~dp0ofis-kontrol-sonucu.json
) else (
  echo Kontrol tamamlanamadi veya bir engel bulundu.
  echo Yukaridaki hata ya da kontrol sonucunu iletin.
)
echo Bu islem servis kurmaz ve evraklara yazmaz.
pause
popd
exit /b %CHECK_EXIT%
