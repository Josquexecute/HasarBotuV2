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

Write-Output "`n=== SUMMARY: $script:failures failure(s) ==="
if ($script:failures -gt 0) { exit 1 }
exit 0
