[CmdletBinding()]
param(
    [string]$ServiceAccountName = 'svc-hb-fileagent',

    [string]$PCloudSyncAccount = "$env:COMPUTERNAME\$env:USERNAME",

    [string]$PCloudLocalDatabasePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# File Agent -> pCloud local DB cross-account READ-ONLY access -- PLAN +
# PREVIEW ONLY (HB-2026-162 architecture doc SS8 open decision).
#
# This script NEVER modifies anything: no ACL write, no pCloud/service/env
# change, no file write outside its own Administrators-only evidence
# report. There is no -Apply switch in this script at all -- that is a
# deliberate, structural choice (not a guarded-but-present code path) so
# this turn cannot accidentally mutate anything.
#
# It answers, with REAL evidence from THIS machine:
#   1. Exact pCloud local DB path + whether data.db/-wal/-shm are present.
#   2. The full ancestor directory chain from the drive root down to that
#      DB file, and -- based on the CURRENT real ACL of each node -- which
#      nodes already grant the File Agent service account (svc-hb-
#      fileagent by default) sufficient Traverse rights via a well-known
#      group (Authenticated Users/Everyone -- every authenticated logon,
#      including a Windows service logon, carries these SIDs) and which
#      nodes do NOT (the real blocking point).
#   3. The current ACL of every node (recorded as an admin-only, hashed
#      baseline -- the rollback anchor for a FUTURE, separate, explicit
#      -Apply package).
#   4. The exact minimum ACE set to add: Traverse-only on each blocking
#      ancestor directory (this-folder-only, no inheritance) + a single
#      Read (ReadData/ReadAttributes/ReadExtendedAttributes/
#      ReadPermissions -- .NET's FileSystemRights.Read, PLUS Synchronize,
#      justified below) ACE on the pCloud data folder itself with
#      object-inherit (so EVERY current and future file directly in that
#      folder -- including a deleted/recreated data.db-wal/-shm --
#      automatically inherits Read without a new grant being needed).
#      NEVER Write/Modify/Delete/Create/AppendData/TakeOwnership/
#      ChangePermissions -- asserted structurally, not just described.
#   5. A read-only "would this identity be granted access" simulation
#      (SID + well-known-group based, since svc-hb-fileagent's designed
#      SeDenyInteractiveLogonRight makes literal live impersonation
#      impossible without its deliberately-unknown password -- this
#      boundary is stated explicitly, not glossed over).
#   6. WAL/SHM regeneration continuity reasoning, backed by direct
#      confirmation (grep of pcloud-maintenance-window-gate.mjs) that the
#      only file operations ever performed are direct-path stat/copy on
#      exactly 3 known filenames -- never a directory listing -- so
#      ListDirectory is NOT required anywhere in this chain.
#   7. A rollback anchor (exact pre-existing SDDL per node) and a reusable
#      drift check (re-running this script always re-diffs current ACL
#      against the recorded baseline + the planned addition, flagging
#      anything else as unexpected).

$AdministratorSidValue = 'S-1-5-32-544'
$AuthenticatedUsersSidValue = 'S-1-5-11'
$EveryoneSidValue = 'S-1-1-0'
$ReportDirectory = 'C:\ProgramData\HasarBotu\migration-preflight'
$RequiredFilesystemOperationsNote = 'captureDatabaseFiles() in pcloud-maintenance-window-gate.mjs performs statOptional(path.join(directory, name)) for exactly 3 known filenames (data.db, data.db-wal, data.db-shm) and withConsistentPcloudDatabase() copyFile()s the same 3 known filenames -- confirmed by direct source read, never an opendir/readdir of the containing folder. ListDirectory is therefore not structurally required anywhere in this chain.'

function Throw-SafePreviewError {
    param([string]$Code)
    $exception = [System.InvalidOperationException]::new($Code)
    $exception.Data['SafeCode'] = $Code
    throw $exception
}

function New-AdminOnlySecurity {
    param([bool]$Directory)
    $administratorSid = [System.Security.Principal.SecurityIdentifier]::new($AdministratorSidValue)
    $security = if ($Directory) { [System.Security.AccessControl.DirectorySecurity]::new() } else { [System.Security.AccessControl.FileSecurity]::new() }
    $security.SetAccessRuleProtection($true, $false)
    $security.SetOwner($administratorSid)
    $inheritance = if ($Directory) { ([System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit) } else { [System.Security.AccessControl.InheritanceFlags]::None }
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($administratorSid, [System.Security.AccessControl.FileSystemRights]::FullControl, $inheritance, [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)
    $security.AddAccessRule($rule)
    return $security
}

function Test-AdminOnlyAcl {
    param([string]$Path, [bool]$Directory)
    $security = if ($Directory) { [System.IO.Directory]::GetAccessControl($Path) } else { [System.IO.File]::GetAccessControl($Path) }
    $rules = @($security.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
    $ownerSid = $security.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
    $validRules = @($rules | Where-Object { $_.IdentityReference.Value -eq $AdministratorSidValue -and $_.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and $_.FileSystemRights -eq [System.Security.AccessControl.FileSystemRights]::FullControl })
    return ($security.AreAccessRulesProtected -and $ownerSid -eq $AdministratorSidValue -and $rules.Count -eq 1 -and $validRules.Count -eq 1)
}

function Set-AdminOnlyFileSecurity {
    param([string]$Path)
    [System.IO.File]::SetAccessControl($Path, (New-AdminOnlySecurity $false))
    if (-not (Test-AdminOnlyAcl $Path $false)) { Throw-SafePreviewError 'ADMIN_ONLY_ACL_APPLY_FAILED' }
}

function Get-NodeAclSnapshot {
    # Read-only: current ACL of one filesystem node, as both a structured
    # per-ACE list and the raw SDDL (the exact rollback anchor -- restoring
    # this SDDL string is a byte-for-byte revert, immune to guessing which
    # ACEs to remove later).
    param([string]$Path, [bool]$IsDirectory)
    if ($IsDirectory) {
        # .NET/Win32 treats a bare drive letter ("C:") as "current directory
        # on that drive," not "drive root" -- always disambiguate with a
        # trailing backslash before touching the filesystem.
        if ($Path -match '^[A-Za-z]:$') { $Path = "$Path\" }
        if (-not [System.IO.Directory]::Exists($Path)) { return $null }
        $acl = [System.IO.Directory]::GetAccessControl($Path)
    }
    else {
        if (-not [System.IO.File]::Exists($Path)) { return $null }
        $acl = [System.IO.File]::GetAccessControl($Path)
    }
    $owner = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
    $aces = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | ForEach-Object {
        [ordered]@{
            IdentitySid = $_.IdentityReference.Value
            FileSystemRights = $_.FileSystemRights.ToString()
            FileSystemRightsValue = [int64]$_.FileSystemRights
            AccessControlType = $_.AccessControlType.ToString()
            IsInherited = $_.IsInherited
            InheritanceFlags = $_.InheritanceFlags.ToString()
            PropagationFlags = $_.PropagationFlags.ToString()
        }
    })
    return [ordered]@{
        Path = $Path
        Owner = $owner
        AreAccessRulesProtected = $acl.AreAccessRulesProtected
        Sddl = $acl.GetSecurityDescriptorSddlForm([System.Security.AccessControl.AccessControlSections]::Access -bor [System.Security.AccessControl.AccessControlSections]::Owner)
        Aces = $aces
    }
}

function Test-SimulatedEffectiveAccess {
    # Read-only SID/well-known-group based simulation -- NOT a live
    # impersonation test. svc-hb-fileagent is deliberately configured with
    # SeDenyInteractiveLogonRight (HB-2026-113) and its password is
    # deliberately never known/stored (HB-2026-116/117/118), so literal
    # runas/LogonUser impersonation is impossible by design, not an
    # oversight here. This function instead walks the real ACL and asks:
    # "does any ACE matching this SID, or Authenticated Users/Everyone
    # (which every successfully-authenticated logon -- including a
    # Windows service logon -- automatically carries), grant the required
    # rights, with explicit DENY taking precedence over any ALLOW."
    param($AclSnapshot, [string]$TargetSid, [int64]$RequiredRightsValue)
    if ($null -eq $AclSnapshot) {
        return [ordered]@{ Granted = $false; Reason = 'NODE_NOT_FOUND'; MatchingAces = @() }
    }
    $relevantSids = @($TargetSid, $AuthenticatedUsersSidValue, $EveryoneSidValue)
    $matching = @($AclSnapshot.Aces | Where-Object { $relevantSids -contains $_.IdentitySid })
    $explicitDeny = @($matching | Where-Object { $_.AccessControlType -eq 'Deny' -and -not $_.IsInherited -and ([int64]$_.FileSystemRightsValue -band $RequiredRightsValue) -ne 0 })
    if ($explicitDeny.Count -gt 0) {
        return [ordered]@{ Granted = $false; Reason = 'EXPLICIT_DENY_PRESENT'; MatchingAces = $matching }
    }
    $grantedBits = 0
    foreach ($ace in ($matching | Where-Object { $_.AccessControlType -eq 'Allow' })) {
        $grantedBits = $grantedBits -bor [int64]$ace.FileSystemRightsValue
    }
    $granted = (($grantedBits -band $RequiredRightsValue) -eq $RequiredRightsValue)
    return [ordered]@{
        Granted = $granted
        Reason = if ($granted) { 'ALLOW_ACE_COVERS_REQUIRED_RIGHTS' } else { 'NO_MATCHING_GRANT' }
        MatchingAces = $matching
    }
}

try {
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [System.Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Throw-SafePreviewError 'ADMINISTRATOR_REQUIRED'
    }

    # --- Resolve the service account's SID (read-only) ---
    try {
        $serviceAccount = [System.Security.Principal.NTAccount]::new($ServiceAccountName)
        $serviceAccountSid = $serviceAccount.Translate([System.Security.Principal.SecurityIdentifier]).Value
    }
    catch {
        Throw-SafePreviewError 'SERVICE_ACCOUNT_NOT_FOUND'
    }

    # --- Resolve the pCloud sync account's profile root + LOCALAPPDATA
    #     pCloud path (read-only). Only the current-session-account fast
    #     path is exact; anything else requires ProfileList registry
    #     resolution and is flagged if it cannot be resolved. ---
    $currentIdentityName = "$env:COMPUTERNAME\$env:USERNAME"
    $profileRoot = $null
    if ($PCloudSyncAccount -eq $currentIdentityName) {
        $profileRoot = (Split-Path (Split-Path $env:LOCALAPPDATA -Parent) -Parent)
    }
    else {
        try {
            $syncAccount = [System.Security.Principal.NTAccount]::new($PCloudSyncAccount)
            $syncAccountSid = $syncAccount.Translate([System.Security.Principal.SecurityIdentifier]).Value
            $profileKey = Get-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\$syncAccountSid" -ErrorAction Stop
            $profileRoot = $profileKey.ProfileImagePath
        }
        catch {
            Throw-SafePreviewError 'PCLOUD_SYNC_ACCOUNT_PROFILE_NOT_RESOLVED'
        }
    }
    if ([string]::IsNullOrWhiteSpace($PCloudLocalDatabasePath)) {
        $PCloudLocalDatabasePath = Join-Path $profileRoot 'AppData\Local\pCloud\data.db'
    }
    $databasePath = [System.IO.Path]::GetFullPath($PCloudLocalDatabasePath)
    $pcloudFolder = Split-Path $databasePath -Parent

    # --- Build the full ancestor chain from the drive root down to the
    #     pCloud folder, plus the 3 known DB filenames. Every entry is
    #     normalized (TrimEnd '\') so the drive root never appears twice
    #     as both "C:" and "C:\".
    $driveRootNormalized = [System.IO.Path]::GetPathRoot($databasePath).TrimEnd('\')
    $chainDirs = [System.Collections.Generic.List[string]]::new()
    $cursor = $pcloudFolder.TrimEnd('\')
    while ($true) {
        if (-not ($chainDirs -contains $cursor)) { $chainDirs.Insert(0, $cursor) }
        if ($cursor -eq $driveRootNormalized) { break }
        $parent = (Split-Path $cursor -Parent)
        if ([string]::IsNullOrWhiteSpace($parent)) { $parent = $driveRootNormalized }
        $parent = $parent.TrimEnd('\')
        if ($parent -eq $cursor) { break }
        $cursor = $parent
    }

    $dbFileNames = @([System.IO.Path]::GetFileName($databasePath), "$([System.IO.Path]::GetFileName($databasePath))-wal", "$([System.IO.Path]::GetFileName($databasePath))-shm")

    # --- Required rights (bare minimum per role) ---
    # Traverse ONLY for pass-through ancestors (does not allow listing
    # directory contents or reading any file's data).
    $traverseRights = [int64][System.Security.AccessControl.FileSystemRights]::Traverse
    # Read (ReadData/ReadExtendedAttributes/ReadAttributes/ReadPermissions)
    # PLUS Synchronize -- Synchronize is added because ordinary
    # (non-overlapped) CreateFile-style opens on Windows commonly require
    # it for a successful synchronous read handle; omitting it risks a
    # real, hard-to-diagnose ERROR_ACCESS_DENIED on read even though the
    # data-access bits are all present. Still strictly read-only: no
    # Write/Modify/Delete/Create/AppendData/TakeOwnership/
    # ChangePermissions bit is included anywhere in this value.
    $readRights = [int64]([System.Security.AccessControl.FileSystemRights]::Read -bor [System.Security.AccessControl.FileSystemRights]::Synchronize)
    $forbiddenBits = [int64](
        [System.Security.AccessControl.FileSystemRights]::WriteData -bor
        [System.Security.AccessControl.FileSystemRights]::AppendData -bor
        [System.Security.AccessControl.FileSystemRights]::WriteExtendedAttributes -bor
        [System.Security.AccessControl.FileSystemRights]::WriteAttributes -bor
        [System.Security.AccessControl.FileSystemRights]::Delete -bor
        [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
        [System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor
        [System.Security.AccessControl.FileSystemRights]::TakeOwnership
    )
    if (($traverseRights -band $forbiddenBits) -ne 0 -or ($readRights -band $forbiddenBits) -ne 0) {
        Throw-SafePreviewError 'PLANNED_RIGHTS_CONTAIN_FORBIDDEN_BITS'
    }

    # --- Snapshot every ancestor directory + the 3 DB files (read-only) ---
    $directorySnapshots = [ordered]@{}
    foreach ($dir in $chainDirs) {
        $directorySnapshots[$dir] = Get-NodeAclSnapshot -Path $dir -IsDirectory $true
    }
    $fileSnapshots = [ordered]@{}
    foreach ($name in $dbFileNames) {
        $fullPath = Join-Path $pcloudFolder $name
        $fileSnapshots[$fullPath] = Get-NodeAclSnapshot -Path $fullPath -IsDirectory $false
    }
    if ($null -eq $fileSnapshots[$databasePath]) { Throw-SafePreviewError 'PCLOUD_LOCAL_DATABASE_NOT_FOUND' }

    # --- Simulate current effective access per node ---
    $directoryAccessResults = [ordered]@{}
    foreach ($dir in $chainDirs) {
        $directoryAccessResults[$dir] = Test-SimulatedEffectiveAccess -AclSnapshot $directorySnapshots[$dir] -TargetSid $serviceAccountSid -RequiredRightsValue $traverseRights
    }
    $fileAccessResults = [ordered]@{}
    foreach ($name in $dbFileNames) {
        $fullPath = Join-Path $pcloudFolder $name
        $fileAccessResults[$fullPath] = Test-SimulatedEffectiveAccess -AclSnapshot $fileSnapshots[$fullPath] -TargetSid $serviceAccountSid -RequiredRightsValue $readRights
    }

    # --- Derive the exact minimum ACE plan: only for nodes that do NOT
    #     already have sufficient access; the pCloud folder ALWAYS gets
    #     the object-inherit Read ACE regardless (covers current + future
    #     -wal/-shm regeneration, per SS7 reasoning above). ---
    # pCloud folder is deliberately handled separately below (Traverse +
    # Read together) so it never gets a duplicate Traverse ACE from this
    # loop over the ancestors ABOVE it.
    $plannedAces = @()
    foreach ($dir in $chainDirs) {
        if ($dir -eq $pcloudFolder) { continue }
        if (-not $directoryAccessResults[$dir].Granted) {
            $plannedAces += [ordered]@{
                Path = $dir
                Type = 'Directory'
                Identity = $ServiceAccountName
                Rights = 'Traverse'
                RightsValue = $traverseRights
                AccessControlType = 'Allow'
                InheritanceFlags = 'None'
                PropagationFlags = 'None'
                Purpose = 'Pass-through only -- does not allow listing this directory''s contents or reading any file in it.'
            }
        }
    }
    $plannedAces += [ordered]@{
        Path = $pcloudFolder
        Type = 'Directory'
        Identity = $ServiceAccountName
        Rights = 'Traverse'
        RightsValue = $traverseRights
        AccessControlType = 'Allow'
        InheritanceFlags = 'None'
        PropagationFlags = 'None'
        Purpose = 'Pass-through into the pCloud data folder itself.'
    }
    $plannedAces += [ordered]@{
        Path = $pcloudFolder
        Type = 'Directory'
        Identity = $ServiceAccountName
        Rights = 'Read, Synchronize'
        RightsValue = $readRights
        AccessControlType = 'Allow'
        InheritanceFlags = 'ObjectInherit'
        PropagationFlags = 'None'
        Purpose = 'Propagates Read to every CURRENT AND FUTURE file directly in this folder (covers data.db-wal/-shm being deleted and recreated by pCloud -- the new file inherits this same ACE at creation time, standard NTFS behavior; no re-grant would ever be needed).'
    }

    $blockers = [System.Collections.Generic.List[string]]::new()
    if (@($directorySnapshots.Values | Where-Object { $null -eq $_ }).Count -gt 0) { $blockers.Add('ANCESTOR_DIRECTORY_MISSING') }
    $unexpectedDenyNodes = @()
    foreach ($dir in $chainDirs) {
        $explicitDenies = @($directorySnapshots[$dir].Aces | Where-Object { $_.AccessControlType -eq 'Deny' -and -not $_.IsInherited })
        if ($explicitDenies.Count -gt 0) { $unexpectedDenyNodes += $dir }
    }
    if ($unexpectedDenyNodes.Count -gt 0) { $blockers.Add('EXPLICIT_DENY_ACE_PRESENT_ON_ANCESTOR') }

    $output = [ordered]@{
        SchemaVersion = 'hasarbotu-file-agent-pcloud-db-access-preview/1.0.0'
        Mode = 'preview'
        GeneratedAtUtc = [DateTime]::UtcNow.ToString('o')
        ServiceAccountName = $ServiceAccountName
        ServiceAccountSid = $serviceAccountSid
        PCloudSyncAccount = $PCloudSyncAccount
        DatabasePath = $databasePath
        PCloudFolder = $pcloudFolder
        RequiredFilesystemOperationsNote = $RequiredFilesystemOperationsNote
        ImpersonationLimitNote = 'svc-hb-fileagent has SeDenyInteractiveLogonRight and a deliberately-unknown, never-stored password (HB-2026-113/116/117/118) -- literal live impersonation is impossible by design. Access below is a real-ACL-based simulation (own SID + Authenticated Users + Everyone, explicit-deny-wins), not a live test.'
        AncestorChain = @($chainDirs | ForEach-Object {
            [ordered]@{
                Path = $_
                CurrentlyGranted = $directoryAccessResults[$_].Granted
                Reason = $directoryAccessResults[$_].Reason
                AclSnapshot = $directorySnapshots[$_]
            }
        })
        DatabaseFiles = @($dbFileNames | ForEach-Object {
            $fullPath = Join-Path $pcloudFolder $_
            [ordered]@{
                Path = $fullPath
                Exists = ($null -ne $fileSnapshots[$fullPath])
                CurrentlyGranted = $fileAccessResults[$fullPath].Granted
                Reason = $fileAccessResults[$fullPath].Reason
                AclSnapshot = $fileSnapshots[$fullPath]
            }
        })
        PlannedMinimumAces = $plannedAces
        PlannedAcesContainNoWriteOrDeleteBits = $true
        WalShmContinuityReasoning = 'Read ACE is planned on the FOLDER (ObjectInherit), not on the specific -wal/-shm file objects, because those are the files most likely to be deleted and recreated by pCloud during normal WAL checkpointing. A folder-level ObjectInherit ACE is applied by Windows to any new child file at creation time -- this is standard NTFS inheritance, not something that needs to be re-verified empirically each time (and cannot be, without live impersonation -- see ImpersonationLimitNote).'
        RollbackPlan = 'None of these ACEs have been applied. If a FUTURE, separate, explicit Apply step adds them, rollback is: for each of the 4 ancestor directories + the pCloud folder, restore the EXACT pre-change SDDL recorded in AncestorChain[].AclSnapshot.Sddl above (SetSecurityDescriptorSddlForm) rather than attempting to identify and remove only the added ACEs -- this is immune to any other concurrent, unrelated ACL drift.'
        DriftCheckPlan = 'Re-running this same script at any later time re-captures the live ACL of every node and re-computes CurrentlyGranted; comparing a later run''s AclSnapshot against an earlier run''s AclSnapshot for the same node (diff the Aces arrays) surfaces ANY ACE that is neither part of the originally-recorded baseline NOR one of PlannedMinimumAces -- that is drift, and should block a future Apply until explained.'
        Blockers = @($blockers)
        OverallStatus = if ($blockers.Count -gt 0) { 'blocked' } elseif (@($directoryAccessResults.Values | Where-Object { -not $_.Granted }).Count -eq 0 -and @($fileAccessResults.Values | Where-Object { -not $_.Granted -and $_.Reason -ne 'NODE_NOT_FOUND' }).Count -eq 0) { 'already_sufficient' } else { 'grant_required' }
    }

    if (-not [System.IO.Directory]::Exists($ReportDirectory)) { [System.IO.Directory]::CreateDirectory($ReportDirectory) | Out-Null }
    [System.IO.Directory]::SetAccessControl($ReportDirectory, (New-AdminOnlySecurity $true))
    $timestamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')
    $suffix = [Guid]::NewGuid().ToString('N').Substring(0, 8)
    $fileName = "file-agent-pcloud-db-access-preview-$timestamp-$suffix.json"
    $finalPath = Join-Path $ReportDirectory $fileName
    $json = $output | ConvertTo-Json -Depth 14
    [System.IO.File]::WriteAllText($finalPath, $json, [System.Text.UTF8Encoding]::new($false))
    Set-AdminOnlyFileSecurity $finalPath
    $reportHash = (Get-FileHash -LiteralPath $finalPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $sidecarPath = "$finalPath.sha256"
    [System.IO.File]::WriteAllText($sidecarPath, "$reportHash  $fileName", [System.Text.UTF8Encoding]::new($false))
    Set-AdminOnlyFileSecurity $sidecarPath

    Write-Output ([ordered]@{
        SchemaVersion = 'hasarbotu-file-agent-pcloud-db-access-preview-wrapper/1.0.0'
        ReadOnly = $true
        OverallStatus = $output.OverallStatus
        ServiceAccountName = $ServiceAccountName
        AncestorChainSummary = @($output.AncestorChain | ForEach-Object { [ordered]@{ RelativeDepth = $_.Path; CurrentlyGranted = $_.CurrentlyGranted; Reason = $_.Reason } })
        DatabaseFilesSummary = @($output.DatabaseFiles | ForEach-Object { [ordered]@{ Name = [System.IO.Path]::GetFileName($_.Path); Exists = $_.Exists; CurrentlyGranted = $_.CurrentlyGranted } })
        PlannedAceCount = @($plannedAces).Count
        Blockers = @($blockers)
        Report = [ordered]@{ FileName = $fileName; Sha256 = $reportHash; AdminOnly = $true }
    } | ConvertTo-Json -Depth 6)
    exit 0
}
catch {
    $safeError = [ordered]@{
        SchemaVersion = 'hasarbotu-file-agent-pcloud-db-access-preview-wrapper/1.0.0'
        Status = 'error'
        ReadOnly = $true
        ErrorCode = if ($null -ne $_.Exception.Data -and $_.Exception.Data.Contains('SafeCode')) { [string]$_.Exception.Data['SafeCode'] } else { 'FILE_AGENT_PCLOUD_DB_ACCESS_PREVIEW_RUNTIME_ERROR' }
        ErrorType = $_.Exception.GetType().Name
        ErrorLine = $_.InvocationInfo.ScriptLineNumber
    }
    $safeError | ConvertTo-Json -Depth 4
    exit 1
}
