#Requires -Version 5.1
#Requires -RunAsAdministrator
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$work = Join-Path ([IO.Path]::GetTempPath()) ('hb-signing-' + [Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($work) | Out-Null
$certificate = Join-Path $work 'public.cer'
$thumbprint = $null
$passed = 0
function Assert-SigningTest([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
  $script:passed++
}
try {
  $result = & "$PSScriptRoot/initialize-office-signing.ps1" -ExpectedComputerName $env:COMPUTERNAME -PublicCertificate $certificate -Subject ('CN=HasarBotu Lifecycle Test ' + [Guid]::NewGuid().ToString('N')) | ConvertFrom-Json
  $thumbprint = $result.thumbprint
  Assert-SigningTest ($result.keyAclRestricted -and -not $result.privateKeyExportable) 'Key protection failed'
  $cert = Get-Item "Cert:/CurrentUser/My/$thumbprint"
  $rsa = [Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($cert)
  try {
    $denied = $false
    try { $null = $rsa.ExportParameters($true) } catch [Security.Cryptography.CryptographicException] { $denied = $true }
    Assert-SigningTest $denied 'Private key export was allowed'
  } finally { $rsa.Dispose() }
  $arguments = @{ ExpectedComputerName = $env:COMPUTERNAME; PublicCertificate = $certificate; Thumbprint = $thumbprint; CertificateSha256 = $result.publicCertificateSha256 }
  $rejected = $false
  $trust = & "$PSScriptRoot/set-office-signing-trust.ps1" @arguments -Action Trust | ConvertFrom-Json
  $trusted = $trust.rootTrusted -and $trust.publisherTrusted -and -not $trust.privateKeyImported
  Assert-SigningTest $trusted 'Public certificate trust failed'
  $scriptFile = Join-Path $work 'fixture.ps1'
  [IO.File]::WriteAllText($scriptFile, "Write-Output 'fixture'`r`n", [Text.UTF8Encoding]::new($true))
  $signed = Set-AuthenticodeSignature -LiteralPath $scriptFile -Certificate $cert -HashAlgorithm SHA256
  Assert-SigningTest ($signed.Status -eq 'Valid') 'Trusted signature was not valid'
  [IO.File]::WriteAllText($scriptFile, ([IO.File]::ReadAllText($scriptFile).Replace("'fixture'", "'changed'")), [Text.UTF8Encoding]::new($true))
  Assert-SigningTest ((Get-AuthenticodeSignature -LiteralPath $scriptFile).Status -eq 'HashMismatch') 'Tampered signature accepted'
  $wrong = $arguments.Clone(); $wrong.ExpectedComputerName = 'NOT-THIS-MANAGED-HOST'
  try { & "$PSScriptRoot/set-office-signing-trust.ps1" @wrong | Out-Null } catch { $rejected = $_.Exception.Message -eq 'MANAGED_HOST_MISMATCH' }
  Assert-SigningTest $rejected 'Wrong host was accepted'
  $wrong = $arguments.Clone(); $wrong.CertificateSha256 = '0' * 64; $rejected = $false
  try { & "$PSScriptRoot/set-office-signing-trust.ps1" @wrong | Out-Null } catch { $rejected = $_.Exception.Message -eq 'CERTIFICATE_HASH_MISMATCH' }
  Assert-SigningTest $rejected 'Wrong certificate hash accepted'
  $revoked = & "$PSScriptRoot/set-office-signing-trust.ps1" @arguments -Action Revoke | ConvertFrom-Json
  Assert-SigningTest ($revoked.explicitlyDistrusted -and -not $revoked.rootTrusted -and -not $revoked.publisherTrusted) 'Revocation failed'
  $rejected = $false
  try { & "$PSScriptRoot/set-office-signing-trust.ps1" @arguments | Out-Null } catch { $rejected = $_.Exception.Message -eq 'CERTIFICATE_EXPLICITLY_REVOKED' }
  Assert-SigningTest $rejected 'Revoked signer was trusted again'
  $revokedSignature = Set-AuthenticodeSignature -LiteralPath $scriptFile -Certificate $cert -HashAlgorithm SHA256
  Assert-SigningTest ($revokedSignature.Status -ne 'Valid') 'Revoked publisher signature accepted'
  Write-Output "$passed/$passed PASS"
} finally {
  if ($thumbprint) {
    foreach ($location in @('LocalMachine', 'CurrentUser')) {
      foreach ($store in @('Root', 'TrustedPublisher', 'Disallowed')) {
        $path = "Cert:/$location/$store/$thumbprint"
        if (Test-Path $path) { Remove-Item -LiteralPath $path }
      }
    }
    if (Test-Path "Cert:/CurrentUser/My/$thumbprint") { Remove-Item -LiteralPath "Cert:/CurrentUser/My/$thumbprint" -DeleteKey }
  }
  $resolved = [IO.Path]::GetFullPath($work)
  if ($resolved.StartsWith([IO.Path]::GetTempPath(), [StringComparison]::OrdinalIgnoreCase) -and (Split-Path $resolved -Leaf) -match '^hb-signing-[a-f0-9]{32}$') { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
