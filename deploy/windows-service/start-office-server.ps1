#Requires -Version 5.1
[CmdletBinding()]
param([switch]$NoPause)

function Start-HasarBotuWindowsService {
    param([Parameter(Mandatory=$true)][string]$Name)
    $service = Get-Service -Name $Name -ErrorAction Stop
    $timeout = [TimeSpan]::FromSeconds(45)
    if ($service.Status -eq 'StopPending') { $service.WaitForStatus('Stopped', $timeout) }
    if ($service.Status -eq 'Stopped') {
        Write-Host "Başlatılıyor: $Name"
        try { $service.Start() }
        catch {
            # Windows automatic startup may win the race with this launcher.
            $service.Refresh()
            if ($service.Status -notin @('Running', 'StartPending')) { throw }
        }
    }
    if ($service.Status -notin @('Running', 'StartPending', 'Stopped')) {
        throw "Hizmet başlatılamadı: $Name ($($service.Status)). Hizmetler ekranını kontrol edin."
    }
    $service.WaitForStatus('Running', $timeout)
    $service.Refresh()
    Write-Host "[OK] $Name" -ForegroundColor Green
}

function Wait-HasarBotuHttpReady {
    param(
        [Parameter(Mandatory=$true)][string]$Uri,
        [int]$TimeoutSeconds = 60
    )
    $timer = [Diagnostics.Stopwatch]::StartNew()
    $lastError = $null
    do {
        try {
            $health = Invoke-RestMethod -Uri $Uri -TimeoutSec 3 -ErrorAction Stop
            if ($health.status -eq 'ok') { return }
            $lastError = [InvalidOperationException]::new('Sunucu henüz hazır yanıtı vermiyor.')
        }
        catch { $lastError = $_.Exception }
        if ($timer.Elapsed.TotalSeconds -ge $TimeoutSeconds) { break }
        # A running Windows service can precede its HTTP listener/database readiness.
        Start-Sleep -Milliseconds 500
    } while ($timer.Elapsed.TotalSeconds -lt $TimeoutSeconds)
    throw [TimeoutException]::new("Sunucu kontrolü zaman aşımına uğradı: $Uri", $lastError)
}

function Start-HasarBotuOfficeServer {
    $names = @('postgresql-x64-17', 'Tailscale', 'hasarbotu-api', 'hasarbotu-lan-https', 'hasarbotu-file-agent', 'hasarbotu-folder-discovery')
    foreach ($name in $names[0..2]) { Start-HasarBotuWindowsService -Name $name }
    Write-Host 'Merkezi sunucu yanıtı bekleniyor...'
    Wait-HasarBotuHttpReady -Uri 'http://127.0.0.1:3100/health'
    foreach ($name in $names[3..5]) { Start-HasarBotuWindowsService -Name $name }
    Write-Host 'Ofis HTTPS bağlantısı kontrol ediliyor...'
    Wait-HasarBotuHttpReady -Uri 'https://desktop-efn2g33.tail276cda.ts.net/health'
    $services = @(Get-Service -Name $names -ErrorAction Stop)
    $stopped = @($services | Where-Object { $_.Status -ne 'Running' })
    if ($stopped.Count) { throw "Kontrol sırasında hizmet durdu: $(($stopped.Name) -join ', ')" }
    return [ordered]@{
        status = 'PASS'
        checkedAt = [DateTime]::UtcNow.ToString('o')
        computer = $env:COMPUTERNAME
        administrator = $true
        apiHealthy = $true
        httpsHealthy = $true
        services = @($services | ForEach-Object { @{ name = $_.Name; status = [string]$_.Status } })
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    $ErrorActionPreference = 'Stop'
    $exitCode = 1
    try {
        $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
        $principal = [Security.Principal.WindowsPrincipal]::new($identity)
        if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
            throw 'Yönetici izni gerekiyor. Masaüstündeki HasarBotu Sunucuyu Başlat.cmd dosyasını açıp Windows izin ekranını onaylayın.'
        }
        if ($env:COMPUTERNAME -ne 'DESKTOP-EFN2G33') { throw 'Bu başlatıcı yalnız ofis sunucusu DESKTOP-EFN2G33 içindir.' }
        Write-Host 'HasarBotu - Sunucuyu Başlat' -ForegroundColor Cyan
        Write-Host ''
        $result = Start-HasarBotuOfficeServer
        [IO.File]::WriteAllText((Join-Path $PSScriptRoot 'last-start.json'), ($result | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
        Write-Host ''
        Write-Host 'SUNUCU HAZIR. HasarBotu uygulamasını açabilirsiniz.' -ForegroundColor Green
        $exitCode = 0
    }
    catch {
        $failure = $_.Exception.Message
        Write-Host ''
        Write-Host "BAŞLATILAMADI: $failure" -ForegroundColor Red
        Write-Host 'Bu pencereyi açık tutup hata mesajını iletebilirsiniz.'
        if ($principal -and $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) -and $env:COMPUTERNAME -eq 'DESKTOP-EFN2G33') {
            try {
                $report = @{ status = 'FAIL'; checkedAt = [DateTime]::UtcNow.ToString('o'); message = $failure }
                [IO.File]::WriteAllText((Join-Path $PSScriptRoot 'last-start.json'), ($report | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
            }
            catch { Write-Warning "Sonuç dosyası yazılamadı: $($_.Exception.Message)" }
        }
    }
    finally {
        if (-not $NoPause) { [void](Read-Host 'Pencereyi kapatmak için Enter') }
    }
    exit $exitCode
}
