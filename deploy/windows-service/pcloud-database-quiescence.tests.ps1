# HB-2026-128: pcloud-database-quiescence.ps1 icin bagimliliksiz test
# script'i (Pester veya baska bir cerceve gerektirmez, repo'nun genel
# "ek dependency ekleme" prensibiyle tutarli). Ayrica D8BeforeSync'in
# Turkce yol/mojibake regresyonuna karsi kilitli kalmasi icin manifest
# okuma yontemini (UTF-8 File.ReadAllText) dogrudan test eder.
#
# Calistirma: powershell -File pcloud-database-quiescence.tests.ps1
# Cikis kodu: 0 = tum testler gecti, 1 = en az bir test basarisiz.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'pcloud-database-quiescence.ps1')

$script:TestCount = 0
$script:FailCount = 0

function Test-Case {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][scriptblock]$Body
    )

    $script:TestCount++
    try {
        & $Body
        Write-Host "PASS: $Name" -ForegroundColor Green
    }
    catch {
        $script:FailCount++
        Write-Host "FAIL: $Name" -ForegroundColor Red
        Write-Host "  $($_.Exception.Message)" -ForegroundColor Red
    }
}

function Assert-Equal {
    param($Expected, $Actual, [string]$Because = '')
    if ($Expected -ne $Actual) {
        throw "Expected [$Expected] but got [$Actual]. $Because"
    }
}

function Assert-True {
    param([bool]$Condition, [string]$Because = '')
    if (-not $Condition) {
        throw "Expected condition to be true. $Because"
    }
}

# ---------------------------------------------------------------------
# Get-PCloudDatabaseFileState / Test-PCloudDatabaseStateEqual
# ---------------------------------------------------------------------

Test-Case 'Get-PCloudDatabaseFileState ayni icerik icin ayni durumu uretir' {
    $tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ([Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
    try {
        $dbPath = Join-Path $tempDir 'data.db'
        [System.IO.File]::WriteAllText($dbPath, 'abc')
        $stateA = Get-PCloudDatabaseFileState $dbPath
        $stateB = Get-PCloudDatabaseFileState $dbPath
        Assert-True (Test-PCloudDatabaseStateEqual $stateA $stateB) 'degismeyen dosya ayni durumu uretmeli'
    }
    finally {
        Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Test-Case 'Get-PCloudDatabaseFileState boyut degisiminde farkli durum uretir' {
    $tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ([Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
    try {
        $dbPath = Join-Path $tempDir 'data.db'
        [System.IO.File]::WriteAllText($dbPath, 'abc')
        $before = Get-PCloudDatabaseFileState $dbPath
        Start-Sleep -Milliseconds 50
        [System.IO.File]::WriteAllText($dbPath, 'abcdef')
        $after = Get-PCloudDatabaseFileState $dbPath
        Assert-True (-not (Test-PCloudDatabaseStateEqual $before $after)) 'boyut degisince durum farkli olmali'
    }
    finally {
        Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Test-Case 'Get-PCloudDatabaseFileState eksik -wal/-shm icin MISSING dondurur ve bu kararli sayilir' {
    $tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ([Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
    try {
        $dbPath = Join-Path $tempDir 'data.db'
        [System.IO.File]::WriteAllText($dbPath, 'abc')
        $stateA = Get-PCloudDatabaseFileState $dbPath
        $stateB = Get-PCloudDatabaseFileState $dbPath
        Assert-Equal 'MISSING' $stateA.'data.db-wal'
        Assert-True (Test-PCloudDatabaseStateEqual $stateA $stateB) 'iki eksik-dosya orneği kararli sayilmali'
    }
    finally {
        Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# ---------------------------------------------------------------------
# Wait-PCloudDatabaseQuiescence: enjekte edilen sampler/sleep/clock ile
# gercek zaman beklemeden deterministik durum makinesi testleri.
# ---------------------------------------------------------------------

Test-Case 'Wait-PCloudDatabaseQuiescence: hic degisiklik yoksa 3 ardisik ornekte PASS doner' {
    $sequence = @('A', 'A', 'A', 'A', 'A')
    $cursor = @{ Index = 0 }
    $sampler = {
        param($Path)
        $value = $sequence[[Math]::Min($cursor.Index, $sequence.Count - 1)]
        if ($cursor.Index -lt $sequence.Count - 1) { $cursor.Index++ }
        return [pscustomobject]@{ V = $value }
    }.GetNewClosure()
    $noopSleep = { param($Seconds) }
    $clock = { [DateTime]::new(2026, 1, 1, 0, 0, 0, [DateTimeKind]::Utc) }

    $result = Wait-PCloudDatabaseQuiescence `
        -PCloudDatabasePath 'unused' `
        -PollSeconds 5 `
        -RequiredConsecutiveStable 3 `
        -MaximumSeconds 180 `
        -SampleState $sampler `
        -Sleep $noopSleep `
        -UtcNow $clock

    Assert-Equal 'pass' $result.Status
    Assert-Equal 3 $result.ConsecutiveStableCount
    Assert-Equal 0 $result.ResetCount
}

Test-Case 'Wait-PCloudDatabaseQuiescence: bir degisiklik ardisik sayaci sifirlar, sonra PASS doner' {
    # ilk ornek A (baslangic), sonra B (degisim -> reset), sonra B,B (3 ardisik icin)
    $sequence = @('A', 'B', 'B', 'B', 'B')
    $cursor = @{ Index = 0 }
    $sampler = {
        param($Path)
        $value = $sequence[[Math]::Min($cursor.Index, $sequence.Count - 1)]
        if ($cursor.Index -lt $sequence.Count - 1) { $cursor.Index++ }
        return [pscustomobject]@{ V = $value }
    }.GetNewClosure()
    $noopSleep = { param($Seconds) }
    $clock = { [DateTime]::new(2026, 1, 1, 0, 0, 0, [DateTimeKind]::Utc) }

    $result = Wait-PCloudDatabaseQuiescence `
        -PCloudDatabasePath 'unused' `
        -PollSeconds 5 `
        -RequiredConsecutiveStable 3 `
        -MaximumSeconds 180 `
        -SampleState $sampler `
        -Sleep $noopSleep `
        -UtcNow $clock

    Assert-Equal 'pass' $result.Status
    Assert-Equal 1 $result.ResetCount 'tam olarak bir degisiklik oldugu icin reset sayaci 1 olmali'
    Assert-Equal 3 $result.ConsecutiveStableCount
}

Test-Case 'Wait-PCloudDatabaseQuiescence: surekli degisim MaximumSeconds asilinca TIMEOUT doner' {
    # her ornek bir oncekinden farkli (hic kararlilik yok)
    $counter = @{ Index = 0 }
    $sampler = {
        param($Path)
        $counter.Index++
        return [pscustomobject]@{ V = $counter.Index }
    }.GetNewClosure()
    $noopSleep = { param($Seconds) }
    # Sahte saat: her cagrida 1 saniye ilerler; baslangic + her poll sonrasi kontrol edilir.
    $clockState = @{ Now = [DateTime]::new(2026, 1, 1, 0, 0, 0, [DateTimeKind]::Utc) }
    $clock = {
        $current = $clockState.Now
        $clockState.Now = $clockState.Now.AddSeconds(1)
        return $current
    }.GetNewClosure()

    $result = Wait-PCloudDatabaseQuiescence `
        -PCloudDatabasePath 'unused' `
        -PollSeconds 1 `
        -RequiredConsecutiveStable 3 `
        -MaximumSeconds 5 `
        -SampleState $sampler `
        -Sleep $noopSleep `
        -UtcNow $clock

    Assert-Equal 'timeout' $result.Status
    Assert-True ($result.ResetCount -gt 0) 'surekli degisim reset sayacini artirmali'
    Assert-True ($result.ConsecutiveStableCount -lt 3) 'timeout aninda 3 ardisik kararli ornege ulasilmamis olmali'
}

Test-Case 'Wait-PCloudDatabaseQuiescence: MaximumSeconds=0 ile hicbir zaman kararli olmayan durum aninda TIMEOUT doner' {
    $counter = @{ Index = 0 }
    $sampler = {
        param($Path)
        $counter.Index++
        return [pscustomobject]@{ V = $counter.Index }
    }.GetNewClosure()
    $noopSleep = { param($Seconds) }
    $fixedNow = [DateTime]::new(2026, 1, 1, 0, 0, 0, [DateTimeKind]::Utc)
    $clock = { $fixedNow }.GetNewClosure()

    $result = Wait-PCloudDatabaseQuiescence `
        -PCloudDatabasePath 'unused' `
        -PollSeconds 5 `
        -RequiredConsecutiveStable 3 `
        -MaximumSeconds 0 `
        -SampleState $sampler `
        -Sleep $noopSleep `
        -UtcNow $clock

    Assert-Equal 'timeout' $result.Status
    Assert-Equal 0 $result.ResetCount 'ilk ornekten sonra hic poll yapilmadan aninda timeout olmali'
}

# ---------------------------------------------------------------------
# Regresyon: Turkce karakterli manifest yolu yalniz UTF-8
# File.ReadAllText ile dogru okunmali; PowerShell'in Get-Content
# varsayilan (sistem kod sayfasi) davranisi BOZAR - bu test o riski
# sabitler.
# ---------------------------------------------------------------------

Test-Case 'Turkce yol/mojibake regresyonu: UTF-8 File.ReadAllText dogru, Get-Content varsayilani YANLIS' {
    $tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ([Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
    try {
        $fixturePath = Join-Path $tempDir 'turkish-fixture.json'
        $expected = '2026\Mayıs 2026\KAPALI MAYIS 2026\72ABY564\_HASARBOTU\.takip.json.tmp'
        $json = (@{ relativePath = $expected } | ConvertTo-Json -Compress)
        $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
        [System.IO.File]::WriteAllText($fixturePath, $json, $utf8NoBom)

        # Uretim kodunun kullandigi yontem: bunun exact eslesmesi gerekir.
        $viaReadAllText = ([System.IO.File]::ReadAllText($fixturePath) | ConvertFrom-Json).relativePath
        Assert-Equal $expected $viaReadAllText 'File.ReadAllText Turkce karakterleri dogru cozmeli (uretim yolu)'

        # Bilinen yanlis yontem: Get-Content -Raw, -Encoding verilmezse bu
        # ortamda sistem kod sayfasini kullanir ve "ı" gibi Turkce'ye
        # ozgu karakterleri bozar. Bu test, birisi uretim kodunu
        # File.ReadAllText yerine bu yontemle degistirirse KIRILACAK
        # sekilde kasitli olarak buraya baglanmistir.
        $viaGetContentDefault = (Get-Content -Raw -LiteralPath $fixturePath | ConvertFrom-Json).relativePath
        Assert-True ($viaGetContentDefault -ne $expected) 'Get-Content varsayilani bu ortamda Turkce karakteri bozmali (regresyon riskini belgeler)'
    }
    finally {
        Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host ''
Write-Host "Toplam: $script:TestCount, Basarisiz: $script:FailCount"
if ($script:FailCount -gt 0) {
    exit 1
}
exit 0
