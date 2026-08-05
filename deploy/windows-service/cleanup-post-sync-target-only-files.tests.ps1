#Requires -Version 5.1
# Dependency-free test script (no Pester) for cleanup-post-sync-target-only-files.ps1.
# Builds synthetic source/target/pCloud-DB fixtures under $env:TEMP; never
# touches real HasarBotu data. Run: powershell -File .\cleanup-post-sync-target-only-files.tests.ps1

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

function New-CleanupTestFixture {
    # One combined fixture: a genuine orphan candidate ('extra.jpg', no source,
    # no live pCloud object) plus one non-'extra' entry (a content_mismatch)
    # that this tool must completely ignore. Also creates a second candidate
    # ('found-live.jpg') whose relative path DOES have a live pCloud file row,
    # to prove the fresh re-probe backs off when pCloud disagrees with the
    # report snapshot.
    param([bool]$AddSourceForOrphan = $false)

    $root = Join-Path $env:TEMP ("hasarbotu-cleanup-fixture-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
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
    $orphanBytes = $soi + ([byte[]]((1..30) | ForEach-Object { ($_ * 3) % 250 })) + $eoi
    $orphanPath = Join-Path $targetCaseDir 'extra.jpg'
    [System.IO.File]::WriteAllBytes($orphanPath, $orphanBytes)
    $orphanSha256 = (Get-FileHash -LiteralPath $orphanPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($AddSourceForOrphan) {
        [System.IO.File]::WriteAllBytes((Join-Path $caseDir 'extra.jpg'), $orphanBytes)
    }

    $foundLiveBytes = $soi + ([byte[]]((1..20) | ForEach-Object { ($_ * 7) % 250 })) + $eoi
    $foundLivePath = Join-Path $targetCaseDir 'found-live.jpg'
    [System.IO.File]::WriteAllBytes($foundLivePath, $foundLiveBytes)
    $foundLiveSha256 = (Get-FileHash -LiteralPath $foundLivePath -Algorithm SHA256).Hash.ToLowerInvariant()

    $mismatchSourceBytes = $soi + ([byte[]]((1..10) | ForEach-Object { ($_ * 11) % 250 })) + $eoi
    $mismatchTargetBytes = $soi + ([byte[]]((1..15) | ForEach-Object { ($_ * 13) % 250 })) + $eoi
    [System.IO.File]::WriteAllBytes((Join-Path $caseDir 'mismatch.jpg'), $mismatchSourceBytes)
    [System.IO.File]::WriteAllBytes((Join-Path $targetCaseDir 'mismatch.jpg'), $mismatchTargetBytes)
    $mismatchSourceSha256 = (Get-FileHash -LiteralPath (Join-Path $caseDir 'mismatch.jpg') -Algorithm SHA256).Hash.ToLowerInvariant()
    $mismatchTargetSha256 = (Get-FileHash -LiteralPath (Join-Path $targetCaseDir 'mismatch.jpg') -Algorithm SHA256).Hash.ToLowerInvariant()

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

    # pCloud DB: 'extra.jpg' has NO file row (genuine orphan, found:false).
    # 'found-live.jpg' DOES have a live file row (pCloud disagrees with the
    # report's snapshot -- must block).
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
INSERT INTO file VALUES (9001, 201, 'found-live.jpg', $($foundLiveBytes.Length), 5001, 0, 1700000000, 1700000000);
"@
    foreach ($i in 1..10) { $sql += "`nINSERT INTO file VALUES ($(3000 + $i), 101, 'ghost-{0:D2}.tmp', 0, $(4000 + $i), 1, $(10 + $i), $(20 + $i));" -f $i }
    $sqlPath = Join-Path $root 'setup.sql'
    [System.IO.File]::WriteAllText($sqlPath, $sql, [System.Text.UTF8Encoding]::new($false))
    node -e "const { DatabaseSync } = require('node:sqlite'); const fs = require('node:fs'); const db = new DatabaseSync('$($dbPath.Replace('\', '\\\\'))'); db.exec(fs.readFileSync('$($sqlPath.Replace('\', '\\\\'))', 'utf8')); db.close();"

    $reportEntries = @(
        [ordered]@{
            RelativePath = 'DAVA\HASAR\extra.jpg'; Classification = 'extra'; Currency = 'target_only_no_source_counterpart'
            Source = $null
            Target = [ordered]@{ FullPath = $orphanPath; Size = $orphanBytes.Length; Sha256 = $orphanSha256 }
            PCloud = [ordered]@{ found = $false }
        },
        [ordered]@{
            RelativePath = 'DAVA\HASAR\found-live.jpg'; Classification = 'extra'; Currency = 'target_only_no_source_counterpart'
            Source = $null
            Target = [ordered]@{ FullPath = $foundLivePath; Size = $foundLiveBytes.Length; Sha256 = $foundLiveSha256 }
            PCloud = [ordered]@{ found = $false }
        },
        [ordered]@{
            RelativePath = 'DAVA\HASAR\mismatch.jpg'; Classification = 'content_mismatch'; Currency = 'source_current_target_superseded'
            Source = [ordered]@{ FullPath = (Join-Path $caseDir 'mismatch.jpg'); Size = $mismatchSourceBytes.Length; Sha256 = $mismatchSourceSha256 }
            Target = [ordered]@{ FullPath = (Join-Path $targetCaseDir 'mismatch.jpg'); Size = $mismatchTargetBytes.Length; Sha256 = $mismatchTargetSha256 }
            PCloud = [ordered]@{ found = $false }
        }
    )
    $forensicsReport = [ordered]@{
        SchemaVersion = 'pcloud-post-sync-diff-forensics/1.0.0'; Status = 'ok'; ReadOnly = $true
        GeneratedAtUtc = [DateTime]::UtcNow.ToString('o'); Entries = $reportEntries
    }
    $reportPath = Join-Path $root 'diff-forensics-report.json'
    [System.IO.File]::WriteAllText($reportPath, ($forensicsReport | ConvertTo-Json -Depth 10), [System.Text.UTF8Encoding]::new($false))
    $reportHash = (Get-FileHash -LiteralPath $reportPath -Algorithm SHA256).Hash.ToLowerInvariant()
    Set-TestAdminOnlyFile $reportPath

    return [pscustomobject]@{
        Root = $root; SourceRoot = $sourceRoot; TargetRoot = $targetRoot; ManifestPath = $manifestPath
        DbPath = $dbPath; ReportPath = $reportPath; ReportHash = $reportHash
        OrphanPath = $orphanPath; OrphanSha256 = $orphanSha256
        FoundLivePath = $foundLivePath; FoundLiveSha256 = $foundLiveSha256
        MismatchTargetPath = (Join-Path $targetCaseDir 'mismatch.jpg'); MismatchTargetSha256 = $mismatchTargetSha256
    }
}

$cleanupScript = Join-Path $PSScriptRoot 'cleanup-post-sync-target-only-files.ps1'

Write-Output '=== TEST 1: PREVIEW mode makes zero writes, ignores non-extra entries, backs off on live-pCloud disagreement ==='
$f1 = New-CleanupTestFixture
$out1 = & $cleanupScript -SourceRoot $f1.SourceRoot -TargetRoot $f1.TargetRoot -GhostExclusionManifestPath $f1.ManifestPath -PCloudLocalDatabasePath $f1.DbPath -ForensicsReportPath $f1.ReportPath -ForensicsReportSha256 $f1.ReportHash -BackupDirectory (Join-Path $f1.Root 'backups') 2>&1
$json1 = $out1 | Out-String | ConvertFrom-Json
Assert-True ($json1.OverallStatus -eq 'partial_or_blocked') "Preview OverallStatus reflects the found-live blocker (got: $($json1.OverallStatus))"
Assert-True ($json1.WouldDeleteCount -eq 1) "Preview WouldDeleteCount is 1 (only the genuine orphan, got: $($json1.WouldDeleteCount))"
Assert-True ($json1.BlockedCount -eq 1) "Preview BlockedCount is 1 (found-live.jpg, got: $($json1.BlockedCount))"
Assert-True (@($json1.PerFile).Count -eq 2) "Preview PerFile has exactly 2 entries (mismatch.jpg never appears, got: $(@($json1.PerFile).Count))"
$foundLiveResult = @($json1.PerFile | Where-Object { $_.Name -eq 'DAVA\HASAR\found-live.jpg' })
Assert-True ($foundLiveResult.Count -eq 1 -and $foundLiveResult[0].Blockers -contains 'PCLOUD_OBJECT_NOW_FOUND') "found-live.jpg blocked with PCLOUD_OBJECT_NOW_FOUND"
Assert-True (Test-Path $f1.OrphanPath) "Orphan target file still exists after preview (zero writes)"
Assert-True (-not (Test-Path (Join-Path $f1.Root 'backups'))) "No backup directory created during preview"
Remove-Item $f1.Root -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== TEST 2: -Apply backs up (outside sync root) + deletes ONLY the genuine orphan; found-live.jpg untouched ==="
$f2 = New-CleanupTestFixture
$backupDir2 = Join-Path $f2.Root 'backups'
$out2 = & $cleanupScript -SourceRoot $f2.SourceRoot -TargetRoot $f2.TargetRoot -GhostExclusionManifestPath $f2.ManifestPath -PCloudLocalDatabasePath $f2.DbPath -ForensicsReportPath $f2.ReportPath -ForensicsReportSha256 $f2.ReportHash -BackupDirectory $backupDir2 -Apply 2>&1
$json2 = $out2 | Out-String | ConvertFrom-Json
Assert-True ($json2.DeletedCount -eq 1) "Apply DeletedCount is 1 (got: $($json2.DeletedCount))"
Assert-True ($json2.BlockedCount -eq 1) "Apply BlockedCount is 1 (got: $($json2.BlockedCount))"
Assert-True (-not (Test-Path $f2.OrphanPath)) "Genuine orphan target file is GONE after apply"
Assert-True (Test-Path $f2.FoundLivePath) "found-live.jpg (blocked) still exists, untouched"
Assert-True (Test-Path $f2.MismatchTargetPath) "mismatch.jpg (not this tool's concern) still exists, untouched"
$backupFiles2 = @(Get-ChildItem -Path $backupDir2 -Filter '*.orphan-target.bak' -ErrorAction SilentlyContinue)
Assert-True ($backupFiles2.Count -eq 1) "Exactly one backup file created"
if ($backupFiles2.Count -eq 1) {
    Assert-True ((Get-FileHash -LiteralPath $backupFiles2[0].FullName -Algorithm SHA256).Hash.ToLowerInvariant() -eq $f2.OrphanSha256) "Backup preserves the ORIGINAL orphan content"
}
Remove-Item $f2.Root -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== TEST 3: source re-appearing since the forensics snapshot blocks the file (never deleted) ==="
$f3 = New-CleanupTestFixture -AddSourceForOrphan $true
$out3 = & $cleanupScript -SourceRoot $f3.SourceRoot -TargetRoot $f3.TargetRoot -GhostExclusionManifestPath $f3.ManifestPath -PCloudLocalDatabasePath $f3.DbPath -ForensicsReportPath $f3.ReportPath -ForensicsReportSha256 $f3.ReportHash -BackupDirectory (Join-Path $f3.Root 'backups') -Apply 2>&1
$json3 = $out3 | Out-String | ConvertFrom-Json
Assert-True ($json3.DeletedCount -eq 0) "Apply DeletedCount is 0 when source has reappeared (got: $($json3.DeletedCount))"
Assert-True (Test-Path $f3.OrphanPath) "Target file untouched when source has reappeared"
Remove-Item $f3.Root -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== TEST 4: target content changed since forensics snapshot blocks the file (never deleted) ==="
$f4 = New-CleanupTestFixture
Start-Sleep -Milliseconds 50
[System.IO.File]::WriteAllBytes($f4.OrphanPath, [byte[]]@(0xFF, 0xD8, 1, 2, 3, 0xFF, 0xD9))
$out4 = & $cleanupScript -SourceRoot $f4.SourceRoot -TargetRoot $f4.TargetRoot -GhostExclusionManifestPath $f4.ManifestPath -PCloudLocalDatabasePath $f4.DbPath -ForensicsReportPath $f4.ReportPath -ForensicsReportSha256 $f4.ReportHash -BackupDirectory (Join-Path $f4.Root 'backups') -Apply 2>&1
$json4 = $out4 | Out-String | ConvertFrom-Json
Assert-True ($json4.DeletedCount -eq 0) "Apply DeletedCount is 0 when target changed since forensics (got: $($json4.DeletedCount))"
Assert-True (Test-Path $f4.OrphanPath) "Target file untouched when its content changed since the forensics snapshot"
Remove-Item $f4.Root -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== TEST 5: backup directory inside the sync root is rejected fail-closed ==="
$f5 = New-CleanupTestFixture
$out5 = & $cleanupScript -SourceRoot $f5.SourceRoot -TargetRoot $f5.TargetRoot -GhostExclusionManifestPath $f5.ManifestPath -PCloudLocalDatabasePath $f5.DbPath -ForensicsReportPath $f5.ReportPath -ForensicsReportSha256 $f5.ReportHash -BackupDirectory (Join-Path $f5.TargetRoot 'backups-inside') 2>&1
$json5 = $out5 | Out-String | ConvertFrom-Json
Assert-True ($json5.Status -eq 'error' -and $json5.ErrorCode -eq 'BACKUP_DIRECTORY_INSIDE_SYNC_ROOT') "Backup directory inside sync root rejected (got: $($json5.ErrorCode))"
Remove-Item $f5.Root -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== TEST 6: re-running -Apply after a successful delete blocks (file no longer found), zero errors ==="
$f6 = New-CleanupTestFixture
& $cleanupScript -SourceRoot $f6.SourceRoot -TargetRoot $f6.TargetRoot -GhostExclusionManifestPath $f6.ManifestPath -PCloudLocalDatabasePath $f6.DbPath -ForensicsReportPath $f6.ReportPath -ForensicsReportSha256 $f6.ReportHash -BackupDirectory (Join-Path $f6.Root 'backups') -Apply 2>&1 | Out-Null
$out6b = & $cleanupScript -SourceRoot $f6.SourceRoot -TargetRoot $f6.TargetRoot -GhostExclusionManifestPath $f6.ManifestPath -PCloudLocalDatabasePath $f6.DbPath -ForensicsReportPath $f6.ReportPath -ForensicsReportSha256 $f6.ReportHash -BackupDirectory (Join-Path $f6.Root 'backups2') -Apply 2>&1
$json6b = $out6b | Out-String | ConvertFrom-Json
Assert-True ($json6b.DeletedCount -eq 0) "Second apply run deletes nothing (already gone)"
Remove-Item $f6.Root -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "`n=== SUMMARY: $script:failures failure(s) ==="
if ($script:failures -gt 0) { exit 1 }
exit 0
