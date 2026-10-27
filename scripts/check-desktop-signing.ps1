param(
  [ValidateSet('Preflight', 'Verify')][string]$Mode = 'Preflight',
  [string[]]$Artifacts = @(),
  [string]$Application,
  [string]$Installer
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$issues = [Collections.Generic.List[string]]::new()
$thumbprint = $env:HASARBOTU_SIGNING_CERT_SHA1
$publisher = $env:HASARBOTU_SIGNING_PUBLISHER
$timestamp = $env:HASARBOTU_SIGNING_TIMESTAMP_URL
$tool = $env:HASARBOTU_SIGNTOOL_PATH
if (-not $tool) {
  $candidates = @(Get-ChildItem -Path "${env:ProgramFiles(x86)}/Windows Kits/10/bin/*/x64/signtool.exe" -File -ErrorAction SilentlyContinue | Sort-Object FullName -Descending)
  if ($candidates.Count) { $tool = $candidates[0].FullName }
}
if (-not $tool -or -not (Test-Path -LiteralPath $tool -PathType Leaf)) { $issues.Add('Windows SDK SignTool is unavailable; set HASARBOTU_SIGNTOOL_PATH') }
if ($thumbprint -notmatch '^[a-fA-F0-9]{40}$') { $issues.Add('Explicit code-signing certificate thumbprint required') }
if (-not $publisher) { $issues.Add('Exact certificate publisher Subject required') }
[Uri]$timestampUri = $null
if (-not $timestamp -or -not [Uri]::TryCreate([string]$timestamp, [UriKind]::Absolute, [ref]$timestampUri) -or $timestampUri.Scheme -ne 'https' -or $timestampUri.UserInfo -or $timestampUri.Query -or $timestampUri.Fragment) { $issues.Add('HTTPS RFC3161 timestamp URL required') }
$usable = @(Get-ChildItem Cert:/CurrentUser/My | Where-Object {
  $_.HasPrivateKey -and $_.NotBefore -le (Get-Date) -and $_.NotAfter -gt (Get-Date) -and
  @($_.EnhancedKeyUsageList | Where-Object { [string]$_.ObjectId -eq '1.3.6.1.5.5.7.3.3' }).Count -gt 0
})
$selected = @($usable | Where-Object { $_.Thumbprint -eq $thumbprint -and $_.Subject -ceq $publisher })
if ($selected.Count -ne 1) { $issues.Add('No unique valid CurrentUser code-signing certificate with private key matches the requested identity') }
else {
  $chain = [Security.Cryptography.X509Certificates.X509Chain]::new()
  try {
    $chain.ChainPolicy.RevocationMode = [Security.Cryptography.X509Certificates.X509RevocationMode]::Online
    $chain.ChainPolicy.UrlRetrievalTimeout = [TimeSpan]::FromSeconds(15)
    if (-not $chain.Build($selected[0])) { $issues.Add('Publisher trust chain or online revocation validation failed') }
  } finally { $chain.Dispose() }
}
$verified = @()
if ($Mode -eq 'Verify') {
  if ($Application) { $Artifacts += $Application }
  if ($Installer) { $Artifacts += $Installer }
  if ($Artifacts.Count -lt 2) { $issues.Add('Application executable and final NSIS installer are both required') }
  foreach ($artifact in $Artifacts) {
    if (-not (Test-Path -LiteralPath $artifact -PathType Leaf)) { $issues.Add('Required artifact is missing'); continue }
    $signature = Get-AuthenticodeSignature -LiteralPath $artifact
    $valid = $signature.Status -eq 'Valid' -and $null -ne $signature.SignerCertificate -and
      $signature.SignerCertificate.Thumbprint -eq $thumbprint -and $null -ne $signature.TimeStamperCertificate
    if (-not $valid) { $issues.Add('Artifact signature, selected signer or trusted timestamp is invalid') }
    $toolValid = $false
    if ($tool -and (Test-Path -LiteralPath $tool -PathType Leaf)) {
      # /pa selects Authenticode policy, /all checks every signature, /tw warns on a missing timestamp.
      $null = & $tool verify /pa /all /tw $artifact 2>&1
      $toolValid = $LASTEXITCODE -eq 0
      if (-not $toolValid) { $issues.Add('SignTool verification failed or returned a warning') }
    }
    $verified += [ordered]@{ name = [IO.Path]::GetFileName($artifact); signatureStatus = [string]$signature.Status;
      timestampPresent = $null -ne $signature.TimeStamperCertificate; signToolVerified = $toolValid;
      bytes = (Get-Item -LiteralPath $artifact).Length; sha256 = (Get-FileHash -LiteralPath $artifact -Algorithm SHA256).Hash.ToLowerInvariant() }
  }
}
[ordered]@{ status = $(if ($issues.Count) { 'BLOCKED' } else { 'PASS' }); mode = $Mode;
  availableCodeSigningCertificates = $usable.Count; issues = @($issues); artifacts = $verified;
  signaturesCreated = 0; trustStoreModified = $false } | ConvertTo-Json -Depth 5
if ($issues.Count) { exit 2 }
