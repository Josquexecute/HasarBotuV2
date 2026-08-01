# HB-2026-128: D8BeforeSync'in tam kaynak hash gecisinin (6460 dosya,
# ~76-80s) hemen ardindan pCloud yerel data.db/-wal/-shm dosyalari icin
# sinirli (bounded) bir sakinlik penceresi bekler. Amac: yogun G/C
# sonrasi pCloud'un yerel DB'yi hala mesgul tuttugu kisa pencerede
# withConsistentPcloudDatabase'in (Node cekirdegi, degistirilmedi) sabit
# sayida yeniden denemesinin hemen tukenmesini onlemek.
#
# Bu dosya yalniz fonksiyon tanimlari icerir; yan etkili ust seviye kod
# YOKTUR. Bu yuzden hem gercek preflight script'i tarafindan hem de
# test script'i tarafindan guvenle "dot-source" edilebilir. Dosya/DB
# yazma islemi YAPMAZ; yalniz varlik + boyut + LastWriteTimeUtc okur.

Set-StrictMode -Version Latest

function Get-PCloudDatabaseFileState {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$PCloudDatabasePath
    )

    $directory = [System.IO.Path]::GetDirectoryName($PCloudDatabasePath)
    $baseName = [System.IO.Path]::GetFileName($PCloudDatabasePath)
    $names = @($baseName, "$baseName-wal", "$baseName-shm")

    $state = [ordered]@{}
    foreach ($name in $names) {
        $fullPath = Join-Path $directory $name
        $info = [System.IO.FileInfo]::new($fullPath)
        $info.Refresh()
        $state[$name] = if ($info.Exists) {
            '{0}|{1}' -f $info.Length, $info.LastWriteTimeUtc.Ticks
        }
        else {
            'MISSING'
        }
    }
    return [pscustomobject]$state
}

function Test-PCloudDatabaseStateEqual {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        $Left,

        [Parameter(Mandatory)]
        $Right
    )

    $leftNames = @($Left.PSObject.Properties.Name)
    $rightNames = @($Right.PSObject.Properties.Name)
    if (@(Compare-Object $leftNames $rightNames).Count -ne 0) {
        return $false
    }
    foreach ($name in $leftNames) {
        if ($Left.$name -ne $Right.$name) {
            return $false
        }
    }
    return $true
}

function Wait-PCloudDatabaseQuiescence {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$PCloudDatabasePath,

        [ValidateRange(0, 60)]
        [int]$PollSeconds = 5,

        [ValidateRange(1, 10)]
        [int]$RequiredConsecutiveStable = 3,

        [ValidateRange(0, 3600)]
        [int]$MaximumSeconds = 180,

        # Testability hooks only: production call sites never override
        # these and get the real file sampler / real sleep / real clock.
        [scriptblock]$SampleState = { param($Path) Get-PCloudDatabaseFileState $Path },
        [scriptblock]$Sleep = { param($Seconds) Start-Sleep -Seconds $Seconds },
        [scriptblock]$UtcNow = { [DateTime]::UtcNow }
    )

    $deadlineUtc = (& $UtcNow).AddSeconds($MaximumSeconds)
    $previousState = & $SampleState $PCloudDatabasePath
    $consecutiveStableCount = 1
    $resetCount = 0

    while ($true) {
        if ($consecutiveStableCount -ge $RequiredConsecutiveStable) {
            return [pscustomobject]@{
                Status = 'pass'
                ConsecutiveStableCount = $consecutiveStableCount
                ResetCount = $resetCount
            }
        }
        if ((& $UtcNow) -ge $deadlineUtc) {
            return [pscustomobject]@{
                Status = 'timeout'
                ConsecutiveStableCount = $consecutiveStableCount
                ResetCount = $resetCount
            }
        }

        & $Sleep $PollSeconds
        $currentState = & $SampleState $PCloudDatabasePath
        if (Test-PCloudDatabaseStateEqual $previousState $currentState) {
            $consecutiveStableCount++
        }
        else {
            $consecutiveStableCount = 1
            $resetCount++
        }
        $previousState = $currentState
    }
}
