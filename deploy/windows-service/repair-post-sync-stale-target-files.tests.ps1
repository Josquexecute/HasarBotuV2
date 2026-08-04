#Requires -Version 5.1
# Dependency-free test script (no Pester) for repair-post-sync-stale-target-files.ps1.
# Builds synthetic source/target/pCloud-DB fixtures under $env:TEMP; never
# touches real HasarBotu data. Run: powershell -File .\repair-post-sync-stale-target-files.tests.ps1

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:failures = 0

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { Write-Output "FAIL: $Message"; $script:failures++ } else { Write-Output "OK: $Message" }
}

$adminSid = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
function Set-TestAdminOnlyFile {
    param([string]$Path)
    $sec = [System.Security.AccessControl.FileSecurity]::new()
    $sec.SetAccessRuleProtection($true, $false)
    $sec.SetOwner($adminSid)
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($adminSid, [System.Security.AccessControl.FileSystemRights]::FullControl, [System.Security.AccessControl.InheritanceFlags]::None, [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)
    $sec.AddAccessRule($rule)
    [System.IO.File]::SetAccessControl($Path, $sec)
}

function New-RepairTestFixture {
    param(
        [bool]$AddTaskReference = $false,
        [bool]$MutateSourceAfterSnapshot = $false,
        [bool]$WrapFilesArrayLikePS51Quirk = $false
    )

    $root = Join-Path $env:TEMP ("hasarbotu-repair-fixture-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Path $root -Force | Out-Null
    $sourceRoot = Join-Path $root 'KAYNAK'
    $targetRoot = Join-Path $root 'HEDEF'
    $ghostDir = Join-Path $sourceRoot 'ghost'
    $caseDir = Join-Path $sourceRoot 'DAVA\HASAR'
    $targetCaseDir = Join-Path $targetRoot 'DAVA\HASAR'
    New-Item -ItemType Directory -Path $ghostDir -Force | Out-Null
    New-Item -ItemType Directory -Path $caseDir -Force | Out-Null
    New-Item -ItemType Directory -Path $targetCaseDir -Force | Out-Null

    $soi = [byte[]]@(0xFF, 0xD8)
    $eoi = [byte[]]@(0xFF, 0xD9)
    $sourceBytes = $soi + ([byte[]](1..50 | ForEach-Object { $_ % 250 })) + $eoi
    $targetBytes = $soi + ([byte[]](1..500 | ForEach-Object { $_ % 250 })) + $eoi
    $sourceFilePath = Join-Path $caseDir 'foto.jpeg'
    $targetFilePath = Join-Path $targetCaseDir 'foto.jpeg'
    [System.IO.File]::WriteAllBytes($sourceFilePath, $sourceBytes)
    [System.IO.File]::WriteAllBytes($targetFilePath, $targetBytes)
    $sourceInfo = Get-Item $sourceFilePath
    $targetInfo = Get-Item $targetFilePath
    $sourceMtimeUnix = [long][Math]::Floor(([DateTimeOffset]$sourceInfo.LastWriteTimeUtc).ToUnixTimeSeconds())
    $targetMtimeUnix = [long][Math]::Floor(([DateTimeOffset]$targetInfo.LastWriteTimeUtc).ToUnixTimeSeconds())
    $sourceSha256 = (Get-FileHash -LiteralPath $sourceFilePath -Algorithm SHA256).Hash.ToLowerInvariant()
    $targetSha256 = (Get-FileHash -LiteralPath $targetFilePath -Algorithm SHA256).Hash.ToLowerInvariant()

    $entries = @()
    for ($i = 1; $i -le 10; $i++) {
        $n = "ghost-{0:D2}.tmp" -f $i
        [System.IO.File]::WriteAllBytes((Join-Path $ghostDir $n), [byte[]]@())
        $entries += [ordered]@{
            relativePath = "ghost\$n"; fileId = "$(1000 + $i)"; parentFolderId = '101'
            expectedMetadata = [ordered]@{ name = $n; sizeBytes = 0; hash = "$(2000 + $i)"; flags = 1; ctimeRaw = 10 + $i; mtimeRaw = 20 + $i }
        }
    }
    $manifest = [ordered]@{
        schemaVersion = 'storage-ghost-exclusion/1.0.0'; readOnly = $true; sourceRoot = $sourceRoot; entryCount = 10
        policy = [ordered]@{ matchMode = 'exact_windows_path_and_pcloud_file_id'; wildcardsAllowed = $false; extensionRulesAllowed = $false; folderRulesAllowed = $false }
        entries = $entries
    }
    $manifestPath = Join-Path $root 'ghost-manifest.json'
    [System.IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 6), [System.Text.UTF8Encoding]::new($false))
    $manifestHash = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
    [System.IO.File]::WriteAllText("$manifestPath.sha256", "$manifestHash  ghost-manifest.json", [System.Text.UTF8Encoding]::new($false))
    Set-TestAdminOnlyFile $manifestPath
    Set-TestAdminOnlyFile "$manifestPath.sha256"

    $dbPath = Join-Path $root 'data.db'
    $taskInsert = if ($AddTaskReference) { "INSERT INTO task (id, itemid) VALUES (1, 5001);" } else { '' }
    $sql = @"
PRAGMA journal_mode = WAL;
CREATE TABLE setting (id TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE folder (id INTEGER PRIMARY KEY, parentfolderid INTEGER NOT NULL, name TEXT NOT NULL, flags INTEGER NOT NULL, ctime INTEGER NOT NULL, mtime INTEGER NOT NULL, subdircnt INTEGER NOT NULL);
CREATE TABLE file (id INTEGER PRIMARY KEY, parentfolderid INTEGER NOT NULL, name TEXT NOT NULL, size INTEGER NOT NULL, hash INTEGER NOT NULL, flags INTEGER NOT NULL, ctime INTEGER NOT NULL, mtime INTEGER NOT NULL);
CREATE TABLE filerevision (fileid INTEGER NOT NULL, hash INTEGER NOT NULL, ctime INTEGER NOT NULL, size INTEGER NOT NULL);
CREATE TABLE task (id INTEGER PRIMARY KEY, type INTEGER, syncid INTEGER, newsyncid INTEGER, itemid INTEGER, localitemid INTEGER, newitemid INTEGER, inprogress INTEGER, name TEXT);
CREATE TABLE fstask (id INTEGER PRIMARY KEY, type INTEGER, status INTEGER, folderid INTEGER, sfolderid INTEGER, fileid INTEGER, text1 TEXT, text2 TEXT, int1 INTEGER, int2 INTEGER);
INSERT INTO setting (id, value) VALUES ('diffid', '100'), ('runstatus', '1');
INSERT INTO folder VALUES (100, 0, 'KAYNAK', 0, 1, 1, 1);
INSERT INTO folder VALUES (101, 100, 'ghost', 0, 1, 1, 0);
INSERT INTO folder VALUES (200, 100, 'DAVA', 0, 1, 1, 1);
INSERT INTO folder VALUES (201, 200, 'HASAR', 0, 1, 1, 0);
INSERT INTO file VALUES (5001, 201, 'foto.jpeg', $($sourceBytes.Length), 999, 0, $targetMtimeUnix, $sourceMtimeUnix);
INSERT INTO filerevision VALUES (5001, 888, $targetMtimeUnix, $($targetBytes.Length));
INSERT INTO filerevision VALUES (5001, 999, $sourceMtimeUnix, $($sourceBytes.Length));
$taskInsert
"@
    foreach ($i in 1..10) { $sql += "`nINSERT INTO file VALUES ($(1000 + $i), 101, 'ghost-{0:D2}.tmp', 0, $(2000 + $i), 1, $(10 + $i), $(20 + $i));" -f $i }
    $sqlPath = Join-Path $root 'setup.sql'
    [System.IO.File]::WriteAllText($sqlPath, $sql, [System.Text.UTF8Encoding]::new($false))
    node -e "const { DatabaseSync } = require('node:sqlite'); const fs = require('node:fs'); const db = new DatabaseSync('$($dbPath.Replace('\', '\\\\'))'); db.exec(fs.readFileSync('$($sqlPath.Replace('\', '\\\\'))', 'utf8')); db.close();"

    $fileRecord = [ordered]@{ Name = 'foto.jpeg'; Source = [ordered]@{ FullPath = $sourceFilePath; Sha256 = $sourceSha256 }; Target = [ordered]@{ FullPath = $targetFilePath; Sha256 = $targetSha256 } }
    # HB-2026-130: Windows PowerShell 5.1's ConvertFrom-Json/ConvertTo-Json
    # round-trip can wrap a previously-deserialized array reassigned as a
    # NEW object's property into { value: [...], Count: N } instead of a
    # plain JSON array -- reproduced against the real forensics report this
    # tool actually consumed. Cover both shapes so the fix (Get-NormalizedJsonArray)
    # has a regression test, without needing to alter the historical evidence file.
    $filesValue = if ($WrapFilesArrayLikePS51Quirk) {
        $inner = ConvertFrom-Json (ConvertTo-Json @($fileRecord) -Depth 6)
        [ordered]@{ Files = $inner }
    }
    else {
        [ordered]@{ Files = @($fileRecord) }
    }
    $forensicsReport = [ordered]@{
        SchemaVersion = 'hasarbotu-56aag629-hasar-version-forensics/1.0.0'
        Classification = [ordered]@{ 'foto.jpeg' = 'source_current_valid' }
    } + $filesValue
    $reportPath = Join-Path $root 'forensics-report.json'
    [System.IO.File]::WriteAllText($reportPath, ($forensicsReport | ConvertTo-Json -Depth 8), [System.Text.UTF8Encoding]::new($false))
    $reportHash = (Get-FileHash -LiteralPath $reportPath -Algorithm SHA256).Hash.ToLowerInvariant()
    Set-TestAdminOnlyFile $reportPath

    if ($MutateSourceAfterSnapshot) {
        Start-Sleep -Milliseconds 50
        [System.IO.File]::WriteAllBytes($sourceFilePath, $soi + ([byte[]](200..210 | ForEach-Object { $_ % 250 })) + $eoi)
    }

    return [pscustomobject]@{
        Root = $root; SourceRoot = $sourceRoot; TargetRoot = $targetRoot; ManifestPath = $manifestPath
        DbPath = $dbPath; ReportPath = $reportPath; ReportHash = $reportHash
        SourceFilePath = $sourceFilePath; TargetFilePath = $targetFilePath
        SourceSha256 = $sourceSha256; TargetSha256 = $targetSha256
    }
}

$repairScript = Join-Path $PSScriptRoot 'repair-post-sync-stale-target-files.ps1'

Write-Output '=== TEST 1: PREVIEW mode makes zero writes ==='
$f1 = New-RepairTestFixture
$out1 = & $repairScript -SourceRoot $f1.SourceRoot -TargetRoot $f1.TargetRoot -GhostExclusionManifestPath $f1.ManifestPath -PCloudLocalDatabasePath $f1.DbPath -ForensicsReportPath $f1.ReportPath -ForensicsReportSha256 $f1.ReportHash -BackupDirectory (Join-Path $f1.Root 'backups') 2>&1
$json1 = $out1 | Out-String | ConvertFrom-Json
Assert-True ($json1.OverallStatus -eq 'preview_ok') "Preview OverallStatus is preview_ok"
Assert-True ($json1.WouldApplyCount -eq 1) "Preview WouldApplyCount is 1"
Assert-True ((Get-FileHash -LiteralPath $f1.TargetFilePath -Algorithm SHA256).Hash.ToLowerInvariant() -eq $f1.TargetSha256) "Target unchanged after preview"
Assert-True (-not (Test-Path (Join-Path $f1.Root 'backups'))) "No backup directory created during preview"
Remove-Item $f1.Root -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== TEST 2: -Apply performs backup + atomic replace + post-verify ==="
$f2 = New-RepairTestFixture
$backupDir2 = Join-Path $f2.Root 'backups'
$out2 = & $repairScript -SourceRoot $f2.SourceRoot -TargetRoot $f2.TargetRoot -GhostExclusionManifestPath $f2.ManifestPath -PCloudLocalDatabasePath $f2.DbPath -ForensicsReportPath $f2.ReportPath -ForensicsReportSha256 $f2.ReportHash -BackupDirectory $backupDir2 -Apply 2>&1
$json2 = $out2 | Out-String | ConvertFrom-Json
Assert-True ($json2.OverallStatus -eq 'applied') "Apply OverallStatus is applied"
Assert-True ($json2.AppliedCount -eq 1) "Apply AppliedCount is 1"
Assert-True ((Get-FileHash -LiteralPath $f2.TargetFilePath -Algorithm SHA256).Hash.ToLowerInvariant() -eq $f2.SourceSha256) "Target now matches source content exactly"
Assert-True ((Get-FileHash -LiteralPath $f2.SourceFilePath -Algorithm SHA256).Hash.ToLowerInvariant() -eq $f2.SourceSha256) "Source untouched"
$backupFiles2 = @(Get-ChildItem -Path $backupDir2 -Filter '*.superseded.bak' -ErrorAction SilentlyContinue)
Assert-True ($backupFiles2.Count -eq 1) "Exactly one backup file created"
if ($backupFiles2.Count -eq 1) {
    Assert-True ((Get-FileHash -LiteralPath $backupFiles2[0].FullName -Algorithm SHA256).Hash.ToLowerInvariant() -eq $f2.TargetSha256) "Backup preserves the ORIGINAL superseded content"
}
$leftovers2 = @(Get-ChildItem -Path (Split-Path $f2.TargetFilePath -Parent) -Filter '*.hasarbotu-*.tmp' -ErrorAction SilentlyContinue)
Assert-True ($leftovers2.Count -eq 0) "No leftover staging temp files"
Remove-Item $f2.Root -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== TEST 3: task/fstask reference blocks the file, zero writes ==="
$f3 = New-RepairTestFixture -AddTaskReference $true
$out3 = & $repairScript -SourceRoot $f3.SourceRoot -TargetRoot $f3.TargetRoot -GhostExclusionManifestPath $f3.ManifestPath -PCloudLocalDatabasePath $f3.DbPath -ForensicsReportPath $f3.ReportPath -ForensicsReportSha256 $f3.ReportHash -BackupDirectory (Join-Path $f3.Root 'backups') -Apply 2>&1
$json3 = $out3 | Out-String | ConvertFrom-Json
Assert-True ($json3.OverallStatus -eq 'partial_or_blocked') "Task-reference case blocked"
Assert-True ((Get-FileHash -LiteralPath $f3.TargetFilePath -Algorithm SHA256).Hash.ToLowerInvariant() -eq $f3.TargetSha256) "Target untouched when task/fstask references the file"
Remove-Item $f3.Root -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== TEST 4: source changed since forensics snapshot blocks the file, zero writes ==="
$f4 = New-RepairTestFixture -MutateSourceAfterSnapshot $true
$out4 = & $repairScript -SourceRoot $f4.SourceRoot -TargetRoot $f4.TargetRoot -GhostExclusionManifestPath $f4.ManifestPath -PCloudLocalDatabasePath $f4.DbPath -ForensicsReportPath $f4.ReportPath -ForensicsReportSha256 $f4.ReportHash -BackupDirectory (Join-Path $f4.Root 'backups') -Apply 2>&1
$json4 = $out4 | Out-String | ConvertFrom-Json
Assert-True ($json4.OverallStatus -eq 'partial_or_blocked') "Source-changed case blocked"
Assert-True ((Get-FileHash -LiteralPath $f4.TargetFilePath -Algorithm SHA256).Hash.ToLowerInvariant() -eq $f4.TargetSha256) "Target untouched when source has changed since the forensics snapshot"
Remove-Item $f4.Root -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== TEST 5: re-running -Apply on an already-repaired file blocks (no longer the known superseded version) ==="
$f5 = New-RepairTestFixture
$backupDir5 = Join-Path $f5.Root 'backups'
& $repairScript -SourceRoot $f5.SourceRoot -TargetRoot $f5.TargetRoot -GhostExclusionManifestPath $f5.ManifestPath -PCloudLocalDatabasePath $f5.DbPath -ForensicsReportPath $f5.ReportPath -ForensicsReportSha256 $f5.ReportHash -BackupDirectory $backupDir5 -Apply 2>&1 | Out-Null
$out5b = & $repairScript -SourceRoot $f5.SourceRoot -TargetRoot $f5.TargetRoot -GhostExclusionManifestPath $f5.ManifestPath -PCloudLocalDatabasePath $f5.DbPath -ForensicsReportPath $f5.ReportPath -ForensicsReportSha256 $f5.ReportHash -BackupDirectory (Join-Path $f5.Root 'backups2') -Apply 2>&1
$json5b = $out5b | Out-String | ConvertFrom-Json
Assert-True ($json5b.OverallStatus -eq 'partial_or_blocked') "Second apply run on the same file blocks"
Remove-Item $f5.Root -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== TEST 6: PS 5.1 wrapped-array forensics report ({value:[...],Count:N}) shape is handled (HB-2026-130 regression) ==="
$f6 = New-RepairTestFixture -WrapFilesArrayLikePS51Quirk $true
$rawReport6 = Get-Content $f6.ReportPath -Raw
Assert-True ($rawReport6 -match '"Files":\s*\{\s*"value"') "Fixture actually reproduces the wrapped {value:[...],Count:N} shape"
$out6 = & $repairScript -SourceRoot $f6.SourceRoot -TargetRoot $f6.TargetRoot -GhostExclusionManifestPath $f6.ManifestPath -PCloudLocalDatabasePath $f6.DbPath -ForensicsReportPath $f6.ReportPath -ForensicsReportSha256 $f6.ReportHash -BackupDirectory (Join-Path $f6.Root 'backups') 2>&1
$json6 = $out6 | Out-String | ConvertFrom-Json
Assert-True ($json6.OverallStatus -eq 'preview_ok') "Wrapped-array report still parses correctly (OverallStatus preview_ok, got: $($json6.OverallStatus))"
Assert-True ($json6.WouldApplyCount -eq 1) "Wrapped-array report: WouldApplyCount is 1"
Remove-Item $f6.Root -Recurse -Force -ErrorAction SilentlyContinue

function New-DiffForensicsTestFixture {
    # HB-2026-149: one combined fixture exercising every branch of
    # Get-CandidateEntriesDiffForensics in a single run, mirroring the real
    # B10 scenario shape (several files, several outcomes, one report).
    # Only 'candidate.jpg' ever reaches the live pCloud re-probe (it is the
    # only genuine candidate), so only it gets matching real pCloud DB rows;
    # every other file's classification comes entirely from the report's own
    # embedded PCloud snapshot, exactly as the adapter is specified to behave.
    $root = Join-Path $env:TEMP ("hasarbotu-repair-diffschema-fixture-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Path $root -Force | Out-Null
    $sourceRoot = Join-Path $root 'KAYNAK'
    $targetRoot = Join-Path $root 'HEDEF'
    $ghostDir = Join-Path $sourceRoot 'ghost'
    $caseDir = Join-Path $sourceRoot 'DAVA\HASAR'
    $targetCaseDir = Join-Path $targetRoot 'DAVA\HASAR'
    New-Item -ItemType Directory -Path $ghostDir -Force | Out-Null
    New-Item -ItemType Directory -Path $caseDir -Force | Out-Null
    New-Item -ItemType Directory -Path $targetCaseDir -Force | Out-Null

    $soi = [byte[]]@(0xFF, 0xD8)
    $eoi = [byte[]]@(0xFF, 0xD9)
    function New-JpegBytes { param([int]$Seed, [int]$Length = 40)
        $soi + ([byte[]]((1..$Length) | ForEach-Object { ($_ * $Seed) % 250 })) + $eoi
    }
    function Write-Pair {
        # pcloud-stale-target-file-state.mjs requires a real directory
        # component in the relative path (RELATIVE_PATH_TOO_SHORT otherwise)
        # -- files live under DAVA\HASAR\, same as the legacy fixture above,
        # and RelativePath in the report is 'DAVA\HASAR\<name>' to match.
        param([string]$Name, [byte[]]$SourceBytes, [byte[]]$TargetBytes, [bool]$WriteSource = $true)
        $srcPath = Join-Path $caseDir $Name
        $tgtPath = Join-Path $targetCaseDir $Name
        if ($WriteSource) { [System.IO.File]::WriteAllBytes($srcPath, $SourceBytes) }
        [System.IO.File]::WriteAllBytes($tgtPath, $TargetBytes)
        return [pscustomobject]@{ SourcePath = $srcPath; TargetPath = $tgtPath; RelativePath = "DAVA\HASAR\$Name" }
    }

    # 1) candidate.jpg -- genuine repair candidate, gets real pCloud DB rows
    $candSourceBytes = New-JpegBytes -Seed 3 -Length 60
    $candTargetBytes = New-JpegBytes -Seed 7 -Length 20
    $candPair = Write-Pair -Name 'candidate.jpg' -SourceBytes $candSourceBytes -TargetBytes $candTargetBytes
    $candSourceSha256 = (Get-FileHash -LiteralPath $candPair.SourcePath -Algorithm SHA256).Hash.ToLowerInvariant()
    $candTargetSha256 = (Get-FileHash -LiteralPath $candPair.TargetPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $candSourceMtimeUnix = [long][Math]::Floor(([DateTimeOffset](Get-Item $candPair.SourcePath).LastWriteTimeUtc).ToUnixTimeSeconds())

    # 2) extra-only.jpg -- target-only, no source at all: must never be touched
    $extraTargetBytes = New-JpegBytes -Seed 11 -Length 15
    $extraPair = Write-Pair -Name 'extra-only.jpg' -SourceBytes $null -TargetBytes $extraTargetBytes -WriteSource $false
    $extraTargetSha256 = (Get-FileHash -LiteralPath $extraPair.TargetPath -Algorithm SHA256).Hash.ToLowerInvariant()

    # 3) same-content.jpg -- metadata_only, identical bytes both sides
    $sameBytes = New-JpegBytes -Seed 13 -Length 25
    $samePair = Write-Pair -Name 'same-content.jpg' -SourceBytes $sameBytes -TargetBytes $sameBytes
    $sameSha256 = (Get-FileHash -LiteralPath $samePair.SourcePath -Algorithm SHA256).Hash.ToLowerInvariant()

    # 4) no-revision-proof.jpg -- currency claims source-current, but pCloud's
    #    ONLY revision IS the current one (same hash) -- no DISTINCT superseded
    #    revision matches target's size, so this must be rejected even though
    #    sizes happen to line up
    $noRevSourceBytes = New-JpegBytes -Seed 17 -Length 30
    $noRevTargetBytes = New-JpegBytes -Seed 19 -Length 30
    $noRevPair = Write-Pair -Name 'no-revision-proof.jpg' -SourceBytes $noRevSourceBytes -TargetBytes $noRevTargetBytes
    $noRevSourceSha256 = (Get-FileHash -LiteralPath $noRevPair.SourcePath -Algorithm SHA256).Hash.ToLowerInvariant()
    $noRevTargetSha256 = (Get-FileHash -LiteralPath $noRevPair.TargetPath -Algorithm SHA256).Hash.ToLowerInvariant()

    # 5) reverse-currency.jpg -- Currency claims TARGET is current and SOURCE is
    #    superseded (the dangerous reverse case) -- must never be a candidate
    #    no matter what the rest of the PCloud data says
    $revSourceBytes = New-JpegBytes -Seed 23 -Length 30
    $revTargetBytes = New-JpegBytes -Seed 29 -Length 33
    $revPair = Write-Pair -Name 'reverse-currency.jpg' -SourceBytes $revSourceBytes -TargetBytes $revTargetBytes
    $revSourceSha256 = (Get-FileHash -LiteralPath $revPair.SourcePath -Algorithm SHA256).Hash.ToLowerInvariant()
    $revTargetSha256 = (Get-FileHash -LiteralPath $revPair.TargetPath -Algorithm SHA256).Hash.ToLowerInvariant()

    # 6) pending-task.jpg -- otherwise-perfect proof chain, but pCloud reports a
    #    live task/fstask reference -- must be rejected
    $pendSourceBytes = New-JpegBytes -Seed 31 -Length 50
    $pendTargetBytes = New-JpegBytes -Seed 37 -Length 18
    $pendPair = Write-Pair -Name 'pending-task.jpg' -SourceBytes $pendSourceBytes -TargetBytes $pendTargetBytes
    $pendSourceSha256 = (Get-FileHash -LiteralPath $pendPair.SourcePath -Algorithm SHA256).Hash.ToLowerInvariant()
    $pendTargetSha256 = (Get-FileHash -LiteralPath $pendPair.TargetPath -Algorithm SHA256).Hash.ToLowerInvariant()

    # 7) unknown-classification.jpg -- a real schema value ('missing') this
    #    adapter has no explicit handling for beyond fail-closed rejection
    $missingSourceBytes = New-JpegBytes -Seed 41 -Length 12
    $missingTargetBytes = New-JpegBytes -Seed 43 -Length 12
    $missingPair = Write-Pair -Name 'unknown-classification.jpg' -SourceBytes $missingSourceBytes -TargetBytes $missingTargetBytes
    $missingSourceSha256 = (Get-FileHash -LiteralPath $missingPair.SourcePath -Algorithm SHA256).Hash.ToLowerInvariant()
    $missingTargetSha256 = (Get-FileHash -LiteralPath $missingPair.TargetPath -Algorithm SHA256).Hash.ToLowerInvariant()

    $entries = @()
    for ($i = 1; $i -le 10; $i++) {
        $n = "ghost-{0:D2}.tmp" -f $i
        [System.IO.File]::WriteAllBytes((Join-Path $ghostDir $n), [byte[]]@())
        $entries += [ordered]@{
            relativePath = "ghost\$n"; fileId = "$(3000 + $i)"; parentFolderId = '101'
            expectedMetadata = [ordered]@{ name = $n; sizeBytes = 0; hash = "$(4000 + $i)"; flags = 1; ctimeRaw = 10 + $i; mtimeRaw = 20 + $i }
        }
    }
    $manifest = [ordered]@{
        schemaVersion = 'storage-ghost-exclusion/1.0.0'; readOnly = $true; sourceRoot = $sourceRoot; entryCount = 10
        policy = [ordered]@{ matchMode = 'exact_windows_path_and_pcloud_file_id'; wildcardsAllowed = $false; extensionRulesAllowed = $false; folderRulesAllowed = $false }
        entries = $entries
    }
    $manifestPath = Join-Path $root 'ghost-manifest.json'
    [System.IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 6), [System.Text.UTF8Encoding]::new($false))
    $manifestHash = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
    [System.IO.File]::WriteAllText("$manifestPath.sha256", "$manifestHash  ghost-manifest.json", [System.Text.UTF8Encoding]::new($false))
    Set-TestAdminOnlyFile $manifestPath
    Set-TestAdminOnlyFile "$manifestPath.sha256"

    $dbPath = Join-Path $root 'data.db'
    $sql = @"
PRAGMA journal_mode = WAL;
CREATE TABLE setting (id TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE folder (id INTEGER PRIMARY KEY, parentfolderid INTEGER NOT NULL, name TEXT NOT NULL, flags INTEGER NOT NULL, ctime INTEGER NOT NULL, mtime INTEGER NOT NULL, subdircnt INTEGER NOT NULL);
CREATE TABLE file (id INTEGER PRIMARY KEY, parentfolderid INTEGER NOT NULL, name TEXT NOT NULL, size INTEGER NOT NULL, hash INTEGER NOT NULL, flags INTEGER NOT NULL, ctime INTEGER NOT NULL, mtime INTEGER NOT NULL);
CREATE TABLE filerevision (fileid INTEGER NOT NULL, hash INTEGER NOT NULL, ctime INTEGER NOT NULL, size INTEGER NOT NULL);
CREATE TABLE task (id INTEGER PRIMARY KEY, type INTEGER, syncid INTEGER, newsyncid INTEGER, itemid INTEGER, localitemid INTEGER, newitemid INTEGER, inprogress INTEGER, name TEXT);
CREATE TABLE fstask (id INTEGER PRIMARY KEY, type INTEGER, status INTEGER, folderid INTEGER, sfolderid INTEGER, fileid INTEGER, text1 TEXT, text2 TEXT, int1 INTEGER, int2 INTEGER);
INSERT INTO setting (id, value) VALUES ('diffid', '100'), ('runstatus', '1');
INSERT INTO folder VALUES (100, 0, 'KAYNAK', 0, 1, 1, 1);
INSERT INTO folder VALUES (101, 100, 'ghost', 0, 1, 1, 0);
INSERT INTO folder VALUES (200, 100, 'DAVA', 0, 1, 1, 1);
INSERT INTO folder VALUES (201, 200, 'HASAR', 0, 1, 1, 0);
INSERT INTO file VALUES (6001, 201, 'candidate.jpg', $($candSourceBytes.Length), 9001, 0, $candSourceMtimeUnix, $candSourceMtimeUnix);
INSERT INTO filerevision VALUES (6001, 8001, $candSourceMtimeUnix, $($candTargetBytes.Length));
INSERT INTO filerevision VALUES (6001, 9001, $candSourceMtimeUnix, $($candSourceBytes.Length));
"@
    foreach ($i in 1..10) { $sql += "`nINSERT INTO file VALUES ($(3000 + $i), 101, 'ghost-{0:D2}.tmp', 0, $(4000 + $i), 1, $(10 + $i), $(20 + $i));" -f $i }
    $sqlPath = Join-Path $root 'setup.sql'
    [System.IO.File]::WriteAllText($sqlPath, $sql, [System.Text.UTF8Encoding]::new($false))
    node -e "const { DatabaseSync } = require('node:sqlite'); const fs = require('node:fs'); const db = new DatabaseSync('$($dbPath.Replace('\', '\\\\'))'); db.exec(fs.readFileSync('$($sqlPath.Replace('\', '\\\\'))', 'utf8')); db.close();"

    $entriesJson = @(
        [ordered]@{
            RelativePath = $candPair.RelativePath; Classification = 'content_mismatch'; Currency = 'source_current_target_superseded'
            Source = [ordered]@{ FullPath = $candPair.SourcePath; Size = $candSourceBytes.Length; Sha256 = $candSourceSha256 }
            Target = [ordered]@{ FullPath = $candPair.TargetPath; Size = $candTargetBytes.Length; Sha256 = $candTargetSha256 }
            PCloud = [ordered]@{
                found      = $true
                CurrentRow = [ordered]@{ size = $candSourceBytes.Length; hash = '9001'; flags = 0; ctime = $candSourceMtimeUnix; mtime = $candSourceMtimeUnix }
                Revisions  = @(
                    [ordered]@{ hash = '8001'; ctime = $candSourceMtimeUnix; size = $candTargetBytes.Length },
                    [ordered]@{ hash = '9001'; ctime = $candSourceMtimeUnix; size = $candSourceBytes.Length }
                )
                TaskReferenceCount = 0
            }
        },
        [ordered]@{
            RelativePath = $extraPair.RelativePath; Classification = 'extra'; Currency = 'target_only_no_source_counterpart'
            Source = $null
            Target = [ordered]@{ FullPath = $extraPair.TargetPath; Size = $extraTargetBytes.Length; Sha256 = $extraTargetSha256 }
            PCloud = [ordered]@{ found = $false }
        },
        [ordered]@{
            RelativePath = $samePair.RelativePath; Classification = 'metadata_only'; Currency = 'content_identical_metadata_differs'
            Source = [ordered]@{ FullPath = $samePair.SourcePath; Size = $sameBytes.Length; Sha256 = $sameSha256 }
            Target = [ordered]@{ FullPath = $samePair.TargetPath; Size = $sameBytes.Length; Sha256 = $sameSha256 }
            PCloud = [ordered]@{ found = $false }
        },
        [ordered]@{
            RelativePath = $noRevPair.RelativePath; Classification = 'content_mismatch'; Currency = 'source_current_target_superseded'
            Source = [ordered]@{ FullPath = $noRevPair.SourcePath; Size = $noRevSourceBytes.Length; Sha256 = $noRevSourceSha256 }
            Target = [ordered]@{ FullPath = $noRevPair.TargetPath; Size = $noRevTargetBytes.Length; Sha256 = $noRevTargetSha256 }
            PCloud = [ordered]@{
                found      = $true
                CurrentRow = [ordered]@{ size = $noRevSourceBytes.Length; hash = '9002'; flags = 0; ctime = 1700000000; mtime = 1700000000 }
                Revisions  = @( [ordered]@{ hash = '9002'; ctime = 1700000000; size = $noRevSourceBytes.Length } )
                TaskReferenceCount = 0
            }
        },
        [ordered]@{
            RelativePath = $revPair.RelativePath; Classification = 'content_mismatch'; Currency = 'target_current_source_superseded'
            Source = [ordered]@{ FullPath = $revPair.SourcePath; Size = $revSourceBytes.Length; Sha256 = $revSourceSha256 }
            Target = [ordered]@{ FullPath = $revPair.TargetPath; Size = $revTargetBytes.Length; Sha256 = $revTargetSha256 }
            PCloud = [ordered]@{
                found      = $true
                CurrentRow = [ordered]@{ size = $revTargetBytes.Length; hash = '9003'; flags = 0; ctime = 1700000000; mtime = 1700000000 }
                Revisions  = @(
                    [ordered]@{ hash = '8003'; ctime = 1699999999; size = $revSourceBytes.Length },
                    [ordered]@{ hash = '9003'; ctime = 1700000000; size = $revTargetBytes.Length }
                )
                TaskReferenceCount = 0
            }
        },
        [ordered]@{
            RelativePath = $pendPair.RelativePath; Classification = 'content_mismatch'; Currency = 'source_current_target_superseded'
            Source = [ordered]@{ FullPath = $pendPair.SourcePath; Size = $pendSourceBytes.Length; Sha256 = $pendSourceSha256 }
            Target = [ordered]@{ FullPath = $pendPair.TargetPath; Size = $pendTargetBytes.Length; Sha256 = $pendTargetSha256 }
            PCloud = [ordered]@{
                found      = $true
                CurrentRow = [ordered]@{ size = $pendSourceBytes.Length; hash = '9004'; flags = 0; ctime = 1700000000; mtime = 1700000000 }
                Revisions  = @(
                    [ordered]@{ hash = '8004'; ctime = 1699999999; size = $pendTargetBytes.Length },
                    [ordered]@{ hash = '9004'; ctime = 1700000000; size = $pendSourceBytes.Length }
                )
                TaskReferenceCount = 1
            }
        },
        [ordered]@{
            RelativePath = $missingPair.RelativePath; Classification = 'missing'; Currency = 'target_missing_source_only'
            Source = [ordered]@{ FullPath = $missingPair.SourcePath; Size = $missingSourceBytes.Length; Sha256 = $missingSourceSha256 }
            Target = [ordered]@{ FullPath = $missingPair.TargetPath; Size = $missingTargetBytes.Length; Sha256 = $missingTargetSha256 }
            PCloud = [ordered]@{ found = $false }
        }
    )
    $forensicsReport = [ordered]@{
        SchemaVersion  = 'pcloud-post-sync-diff-forensics/1.0.0'
        Status         = 'ok'
        ReadOnly       = $true
        GeneratedAtUtc = [DateTime]::UtcNow.ToString('o')
        Entries        = $entriesJson
    }
    $reportPath = Join-Path $root 'diff-forensics-report.json'
    [System.IO.File]::WriteAllText($reportPath, ($forensicsReport | ConvertTo-Json -Depth 10), [System.Text.UTF8Encoding]::new($false))
    $reportHash = (Get-FileHash -LiteralPath $reportPath -Algorithm SHA256).Hash.ToLowerInvariant()
    Set-TestAdminOnlyFile $reportPath

    return [pscustomobject]@{
        Root = $root; SourceRoot = $sourceRoot; TargetRoot = $targetRoot; ManifestPath = $manifestPath
        DbPath = $dbPath; ReportPath = $reportPath; ReportHash = $reportHash
        CandidateSourcePath = $candPair.SourcePath; CandidateTargetPath = $candPair.TargetPath; CandidateSourceSha256 = $candSourceSha256
        ExtraTargetPath = $extraPair.TargetPath; ExtraTargetSha256 = $extraTargetSha256
        SameContentTargetPath = $samePair.TargetPath; SameContentSha256 = $sameSha256
        NoRevTargetPath = $noRevPair.TargetPath; NoRevTargetSha256 = $noRevTargetSha256
        RevTargetPath = $revPair.TargetPath; RevTargetSha256 = $revTargetSha256
        PendTargetPath = $pendPair.TargetPath; PendTargetSha256 = $pendTargetSha256
        UnknownTargetPath = $missingPair.TargetPath; UnknownTargetSha256 = $missingTargetSha256
    }
}

Write-Output "`n=== TEST 7: diff-forensics schema (HB-2026-149) -- PREVIEW classifies all 7 entries into exactly the right bucket ==="
$f7 = New-DiffForensicsTestFixture
$out7 = & $repairScript -SourceRoot $f7.SourceRoot -TargetRoot $f7.TargetRoot -GhostExclusionManifestPath $f7.ManifestPath -PCloudLocalDatabasePath $f7.DbPath -ForensicsReportPath $f7.ReportPath -ForensicsReportSha256 $f7.ReportHash -BackupDirectory (Join-Path $f7.Root 'backups') 2>&1
$json7 = $out7 | Out-String | ConvertFrom-Json
Assert-True ($json7.OverallStatus -eq 'preview_ok') "7 entries: OverallStatus is preview_ok (got: $($json7.OverallStatus))"
Assert-True ($json7.WouldApplyCount -eq 1) "7 entries: exactly 1 repair candidate (got: $($json7.WouldApplyCount))"
Assert-True ($json7.ClassificationBlockedCount -eq 5) "7 entries: exactly 5 classification-blocked (got: $($json7.ClassificationBlockedCount))"
Assert-True ($json7.OutOfScopeCount -eq 1) "7 entries: exactly 1 out-of-scope (got: $($json7.OutOfScopeCount))"
Assert-True (-not (Test-Path (Join-Path $f7.Root 'backups'))) "7 entries: no backup directory created during preview"
$candidateResult7 = @($json7.PerFile | Where-Object { $_.Name -eq 'DAVA\HASAR\candidate.jpg' })
Assert-True ($candidateResult7.Count -eq 1 -and $candidateResult7[0].Status -eq 'would_apply') "candidate.jpg is the sole would_apply entry"
$blockedNames7 = @($json7.ClassificationBlocked | ForEach-Object { $_.Name })
foreach ($expectedBlocked in @('extra-only.jpg', 'no-revision-proof.jpg', 'reverse-currency.jpg', 'pending-task.jpg', 'unknown-classification.jpg')) {
    Assert-True ($blockedNames7 -contains "DAVA\HASAR\$expectedBlocked") "ClassificationBlocked contains $expectedBlocked"
}
$extraReason7 = ($json7.ClassificationBlocked | Where-Object { $_.Name -eq 'DAVA\HASAR\extra-only.jpg' }).Reason
Assert-True ($extraReason7 -eq 'TARGET_ONLY_NO_SOURCE_COUNTERPART') "extra-only.jpg reason is TARGET_ONLY_NO_SOURCE_COUNTERPART (got: $extraReason7)"
$revReason7 = ($json7.ClassificationBlocked | Where-Object { $_.Name -eq 'DAVA\HASAR\reverse-currency.jpg' }).Reason
Assert-True ($revReason7 -eq 'CURRENCY_NOT_SOURCE_CURRENT_TARGET_SUPERSEDED') "reverse-currency.jpg reason is CURRENCY_NOT_SOURCE_CURRENT_TARGET_SUPERSEDED (got: $revReason7)"
$noRevReason7 = ($json7.ClassificationBlocked | Where-Object { $_.Name -eq 'DAVA\HASAR\no-revision-proof.jpg' }).Reason
Assert-True ($noRevReason7 -eq 'NO_DISTINCT_SUPERSEDED_REVISION_MATCHING_TARGET') "no-revision-proof.jpg reason is NO_DISTINCT_SUPERSEDED_REVISION_MATCHING_TARGET (got: $noRevReason7)"
$pendReason7 = ($json7.ClassificationBlocked | Where-Object { $_.Name -eq 'DAVA\HASAR\pending-task.jpg' }).Reason
Assert-True ($pendReason7 -eq 'PCLOUD_TASK_REFERENCE_FOUND') "pending-task.jpg reason is PCLOUD_TASK_REFERENCE_FOUND (got: $pendReason7)"
$outOfScopeNames7 = @($json7.OutOfScope | ForEach-Object { $_.Name })
Assert-True ($outOfScopeNames7 -contains 'DAVA\HASAR\same-content.jpg') "OutOfScope contains same-content.jpg"
Remove-Item $f7.Root -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== TEST 8: diff-forensics schema -- APPLY touches ONLY the proven candidate; every other file is byte-identical afterward ==="
$f8 = New-DiffForensicsTestFixture
$backupDir8 = Join-Path $f8.Root 'backups'
$out8 = & $repairScript -SourceRoot $f8.SourceRoot -TargetRoot $f8.TargetRoot -GhostExclusionManifestPath $f8.ManifestPath -PCloudLocalDatabasePath $f8.DbPath -ForensicsReportPath $f8.ReportPath -ForensicsReportSha256 $f8.ReportHash -BackupDirectory $backupDir8 -Apply 2>&1
$json8 = $out8 | Out-String | ConvertFrom-Json
Assert-True ($json8.AppliedCount -eq 1) "Apply: exactly 1 file applied (got: $($json8.AppliedCount))"
Assert-True ($json8.ClassificationBlockedCount -eq 5) "Apply: exactly 5 classification-blocked (got: $($json8.ClassificationBlockedCount))"
Assert-True ($json8.OutOfScopeCount -eq 1) "Apply: exactly 1 out-of-scope (got: $($json8.OutOfScopeCount))"
Assert-True ((Get-FileHash -LiteralPath $f8.CandidateTargetPath -Algorithm SHA256).Hash.ToLowerInvariant() -eq $f8.CandidateSourceSha256) "candidate.jpg target now matches source content"
Assert-True ((Get-FileHash -LiteralPath $f8.ExtraTargetPath -Algorithm SHA256).Hash.ToLowerInvariant() -eq $f8.ExtraTargetSha256) "extra-only.jpg target UNCHANGED (never had a source to copy from)"
Assert-True ((Get-FileHash -LiteralPath $f8.SameContentTargetPath -Algorithm SHA256).Hash.ToLowerInvariant() -eq $f8.SameContentSha256) "same-content.jpg target UNCHANGED (out of scope)"
Assert-True ((Get-FileHash -LiteralPath $f8.NoRevTargetPath -Algorithm SHA256).Hash.ToLowerInvariant() -eq $f8.NoRevTargetSha256) "no-revision-proof.jpg target UNCHANGED (no revision proof)"
Assert-True ((Get-FileHash -LiteralPath $f8.RevTargetPath -Algorithm SHA256).Hash.ToLowerInvariant() -eq $f8.RevTargetSha256) "reverse-currency.jpg target UNCHANGED (wrong currency direction)"
Assert-True ((Get-FileHash -LiteralPath $f8.PendTargetPath -Algorithm SHA256).Hash.ToLowerInvariant() -eq $f8.PendTargetSha256) "pending-task.jpg target UNCHANGED (pCloud task reference)"
Assert-True ((Get-FileHash -LiteralPath $f8.UnknownTargetPath -Algorithm SHA256).Hash.ToLowerInvariant() -eq $f8.UnknownTargetSha256) "unknown-classification.jpg target UNCHANGED (unrecognized classification)"
$backupFiles8 = @(Get-ChildItem -Path $backupDir8 -Filter '*.superseded.bak' -ErrorAction SilentlyContinue)
Assert-True ($backupFiles8.Count -eq 1) "Apply: exactly one backup file created (only for the genuine candidate)"
Remove-Item $f8.Root -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== TEST 9: diff-forensics schema -- unrecognized SchemaVersion is still rejected fail-closed (both schemas known, nothing else) ==="
$f9 = New-DiffForensicsTestFixture
$mutatedReport9 = (Get-Content $f9.ReportPath -Raw) -replace 'pcloud-post-sync-diff-forensics/1\.0\.0', 'pcloud-post-sync-diff-forensics/9.9.9'
[System.IO.File]::WriteAllText($f9.ReportPath, $mutatedReport9, [System.Text.UTF8Encoding]::new($false))
Set-TestAdminOnlyFile $f9.ReportPath
$mutatedHash9 = (Get-FileHash -LiteralPath $f9.ReportPath -Algorithm SHA256).Hash.ToLowerInvariant()
$out9 = & $repairScript -SourceRoot $f9.SourceRoot -TargetRoot $f9.TargetRoot -GhostExclusionManifestPath $f9.ManifestPath -PCloudLocalDatabasePath $f9.DbPath -ForensicsReportPath $f9.ReportPath -ForensicsReportSha256 $mutatedHash9 -BackupDirectory (Join-Path $f9.Root 'backups') 2>&1
$json9 = $out9 | Out-String | ConvertFrom-Json
Assert-True ($json9.Status -eq 'error' -and $json9.ErrorCode -eq 'FORENSICS_REPORT_SCHEMA_INVALID') "Unknown schema version (even a future diff-forensics bump) is rejected fail-closed (got: $($json9.ErrorCode))"
Remove-Item $f9.Root -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== TEST 10: legacy 56AAG629 schema is UNCHANGED by the adapter addition (regression) ==="
$f10 = New-RepairTestFixture
$out10 = & $repairScript -SourceRoot $f10.SourceRoot -TargetRoot $f10.TargetRoot -GhostExclusionManifestPath $f10.ManifestPath -PCloudLocalDatabasePath $f10.DbPath -ForensicsReportPath $f10.ReportPath -ForensicsReportSha256 $f10.ReportHash -BackupDirectory (Join-Path $f10.Root 'backups') 2>&1
$json10 = $out10 | Out-String | ConvertFrom-Json
Assert-True ($json10.OverallStatus -eq 'preview_ok') "Legacy schema still preview_ok after adapter addition"
Assert-True ($json10.WouldApplyCount -eq 1) "Legacy schema still WouldApplyCount 1 after adapter addition"
Assert-True ($json10.ClassificationBlockedCount -eq 0) "Legacy schema reports ClassificationBlockedCount 0 (new field, always zero on the legacy path)"
Assert-True ($json10.OutOfScopeCount -eq 0) "Legacy schema reports OutOfScopeCount 0 (new field, always zero on the legacy path)"
Remove-Item $f10.Root -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== TEST 11: TARGET_NOT_PRIOR_REVISION is order-independent (HB-2026-149 regression -- real B10 data has TIED filerevision ctimes with the CURRENT revision returned first, not the superseded one) ==="
$root11 = Join-Path $env:TEMP ("hasarbotu-repair-tiedctime-fixture-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $root11 -Force | Out-Null
$sourceRoot11 = Join-Path $root11 'KAYNAK'
$targetRoot11 = Join-Path $root11 'HEDEF'
$ghostDir11 = Join-Path $sourceRoot11 'ghost'
$caseDir11 = Join-Path $sourceRoot11 'DAVA\HASAR'
$targetCaseDir11 = Join-Path $targetRoot11 'DAVA\HASAR'
New-Item -ItemType Directory -Path $ghostDir11 -Force | Out-Null
New-Item -ItemType Directory -Path $caseDir11 -Force | Out-Null
New-Item -ItemType Directory -Path $targetCaseDir11 -Force | Out-Null
$soi11 = [byte[]]@(0xFF, 0xD8)
$eoi11 = [byte[]]@(0xFF, 0xD9)
$src11Bytes = $soi11 + ([byte[]]((1..40) | ForEach-Object { ($_ * 5) % 250 })) + $eoi11
$tgt11Bytes = [byte[]]@()
$src11Path = Join-Path $caseDir11 'tied-ctime.jpg'
$tgt11Path = Join-Path $targetCaseDir11 'tied-ctime.jpg'
[System.IO.File]::WriteAllBytes($src11Path, $src11Bytes)
[System.IO.File]::WriteAllBytes($tgt11Path, $tgt11Bytes)
$src11Sha256 = (Get-FileHash -LiteralPath $src11Path -Algorithm SHA256).Hash.ToLowerInvariant()
$src11MtimeUnix = [long][Math]::Floor(([DateTimeOffset](Get-Item $src11Path).LastWriteTimeUtc).ToUnixTimeSeconds())

$entries11 = @()
for ($i = 1; $i -le 10; $i++) {
    $n = "ghost-{0:D2}.tmp" -f $i
    [System.IO.File]::WriteAllBytes((Join-Path $ghostDir11 $n), [byte[]]@())
    $entries11 += [ordered]@{
        relativePath = "ghost\$n"; fileId = "$(3000 + $i)"; parentFolderId = '101'
        expectedMetadata = [ordered]@{ name = $n; sizeBytes = 0; hash = "$(4000 + $i)"; flags = 1; ctimeRaw = 10 + $i; mtimeRaw = 20 + $i }
    }
}
$manifest11 = [ordered]@{
    schemaVersion = 'storage-ghost-exclusion/1.0.0'; readOnly = $true; sourceRoot = $sourceRoot11; entryCount = 10
    policy = [ordered]@{ matchMode = 'exact_windows_path_and_pcloud_file_id'; wildcardsAllowed = $false; extensionRulesAllowed = $false; folderRulesAllowed = $false }
    entries = $entries11
}
$manifestPath11 = Join-Path $root11 'ghost-manifest.json'
[System.IO.File]::WriteAllText($manifestPath11, ($manifest11 | ConvertTo-Json -Depth 6), [System.Text.UTF8Encoding]::new($false))
$manifestHash11 = (Get-FileHash -LiteralPath $manifestPath11 -Algorithm SHA256).Hash.ToLowerInvariant()
[System.IO.File]::WriteAllText("$manifestPath11.sha256", "$manifestHash11  ghost-manifest.json", [System.Text.UTF8Encoding]::new($false))
Set-TestAdminOnlyFile $manifestPath11
Set-TestAdminOnlyFile "$manifestPath11.sha256"

$dbPath11 = Join-Path $root11 'data.db'
# Both filerevision rows share the EXACT SAME ctime, and the CURRENT
# (source-matching, non-empty) row is inserted BEFORE the superseded
# (empty, target-matching) row -- reproducing the real B10 ordering that
# broke the old index-0-only check, since ORDER BY ctime ASC cannot break
# a tie.
$sql11 = @"
PRAGMA journal_mode = WAL;
CREATE TABLE setting (id TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE folder (id INTEGER PRIMARY KEY, parentfolderid INTEGER NOT NULL, name TEXT NOT NULL, flags INTEGER NOT NULL, ctime INTEGER NOT NULL, mtime INTEGER NOT NULL, subdircnt INTEGER NOT NULL);
CREATE TABLE file (id INTEGER PRIMARY KEY, parentfolderid INTEGER NOT NULL, name TEXT NOT NULL, size INTEGER NOT NULL, hash INTEGER NOT NULL, flags INTEGER NOT NULL, ctime INTEGER NOT NULL, mtime INTEGER NOT NULL);
CREATE TABLE filerevision (fileid INTEGER NOT NULL, hash INTEGER NOT NULL, ctime INTEGER NOT NULL, size INTEGER NOT NULL);
CREATE TABLE task (id INTEGER PRIMARY KEY, type INTEGER, syncid INTEGER, newsyncid INTEGER, itemid INTEGER, localitemid INTEGER, newitemid INTEGER, inprogress INTEGER, name TEXT);
CREATE TABLE fstask (id INTEGER PRIMARY KEY, type INTEGER, status INTEGER, folderid INTEGER, sfolderid INTEGER, fileid INTEGER, text1 TEXT, text2 TEXT, int1 INTEGER, int2 INTEGER);
INSERT INTO setting (id, value) VALUES ('diffid', '100'), ('runstatus', '1');
INSERT INTO folder VALUES (100, 0, 'KAYNAK', 0, 1, 1, 1);
INSERT INTO folder VALUES (101, 100, 'ghost', 0, 1, 1, 0);
INSERT INTO folder VALUES (200, 100, 'DAVA', 0, 1, 1, 1);
INSERT INTO folder VALUES (201, 200, 'HASAR', 0, 1, 1, 0);
INSERT INTO file VALUES (7001, 201, 'tied-ctime.jpg', $($src11Bytes.Length), 9101, 0, $src11MtimeUnix, $src11MtimeUnix);
INSERT INTO filerevision VALUES (7001, 9101, $src11MtimeUnix, $($src11Bytes.Length));
INSERT INTO filerevision VALUES (7001, 8101, $src11MtimeUnix, 0);
"@
foreach ($i in 1..10) { $sql11 += "`nINSERT INTO file VALUES ($(3000 + $i), 101, 'ghost-{0:D2}.tmp', 0, $(4000 + $i), 1, $(10 + $i), $(20 + $i));" -f $i }
$sqlPath11 = Join-Path $root11 'setup.sql'
[System.IO.File]::WriteAllText($sqlPath11, $sql11, [System.Text.UTF8Encoding]::new($false))
node -e "const { DatabaseSync } = require('node:sqlite'); const fs = require('node:fs'); const db = new DatabaseSync('$($dbPath11.Replace('\', '\\\\'))'); db.exec(fs.readFileSync('$($sqlPath11.Replace('\', '\\\\'))', 'utf8')); db.close();"

# Confirm the live probe really does return the CURRENT revision first for
# this fixture (i.e. that the fixture faithfully reproduces the real bug
# precondition, not just asserts the fix in the abstract).
$probeStdout11 = & node deploy\windows-service\pcloud-stale-target-file-state.mjs `
    '--source-root' $sourceRoot11 '--ghost-manifest' $manifestPath11 '--ghost-manifest-sha256' $manifestHash11 `
    '--pcloud-db' $dbPath11 '--relative-path' 'DAVA\HASAR\tied-ctime.jpg' | Out-String
$probeJson11 = $probeStdout11 | ConvertFrom-Json
Assert-True ($probeJson11.found -eq $true -and [int64]$probeJson11.revisions[0].size -eq $src11Bytes.Length) "Fixture precondition: live probe returns the CURRENT (non-empty) revision at index 0, reproducing the real ordering"

$reportEntries11 = @(
    [ordered]@{
        RelativePath = 'DAVA\HASAR\tied-ctime.jpg'; Classification = 'content_mismatch'; Currency = 'source_current_target_superseded'
        Source = [ordered]@{ FullPath = $src11Path; Size = $src11Bytes.Length; Sha256 = $src11Sha256 }
        Target = [ordered]@{ FullPath = $tgt11Path; Size = 0; Sha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' }
        PCloud = [ordered]@{
            found      = $true
            CurrentRow = [ordered]@{ size = $src11Bytes.Length; hash = '9101'; flags = 0; ctime = $src11MtimeUnix; mtime = $src11MtimeUnix }
            Revisions  = @(
                [ordered]@{ hash = '9101'; ctime = $src11MtimeUnix; size = $src11Bytes.Length },
                [ordered]@{ hash = '8101'; ctime = $src11MtimeUnix; size = 0 }
            )
            TaskReferenceCount = 0
        }
    }
)
$report11 = [ordered]@{
    SchemaVersion = 'pcloud-post-sync-diff-forensics/1.0.0'; Status = 'ok'; ReadOnly = $true
    GeneratedAtUtc = [DateTime]::UtcNow.ToString('o'); Entries = $reportEntries11
}
$reportPath11 = Join-Path $root11 'diff-forensics-report.json'
[System.IO.File]::WriteAllText($reportPath11, ($report11 | ConvertTo-Json -Depth 10), [System.Text.UTF8Encoding]::new($false))
$reportHash11 = (Get-FileHash -LiteralPath $reportPath11 -Algorithm SHA256).Hash.ToLowerInvariant()
Set-TestAdminOnlyFile $reportPath11

$backupDir11 = Join-Path $root11 'backups'
$out11 = & $repairScript -SourceRoot $sourceRoot11 -TargetRoot $targetRoot11 -GhostExclusionManifestPath $manifestPath11 -PCloudLocalDatabasePath $dbPath11 -ForensicsReportPath $reportPath11 -ForensicsReportSha256 $reportHash11 -BackupDirectory $backupDir11 -Apply 2>&1
$json11 = $out11 | Out-String | ConvertFrom-Json
Assert-True ($json11.AppliedCount -eq 1) "Tied-ctime, current-first revision order: Apply still succeeds (got AppliedCount: $($json11.AppliedCount), BlockedCount: $($json11.BlockedCount))"
Assert-True ((Get-FileHash -LiteralPath $tgt11Path -Algorithm SHA256).Hash.ToLowerInvariant() -eq $src11Sha256) "Tied-ctime case: target now matches source content"
Remove-Item $root11 -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== SUMMARY: $script:failures failure(s) ==="
if ($script:failures -gt 0) { exit 1 }
exit 0
