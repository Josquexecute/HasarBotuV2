#Requires -Version 5.1
#Requires -RunAsAdministrator
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$ExpectedComputerName,
  [Parameter(Mandatory)][string]$PublicCertificate,
  [Parameter(Mandatory)][ValidatePattern('^[a-fA-F0-9]{40}$')][string]$Thumbprint,
  [Parameter(Mandatory)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$CertificateSha256,
  [ValidateSet('Trust', 'Revoke')][string]$Action = 'Trust'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($env:COMPUTERNAME -ine $ExpectedComputerName) { throw 'MANAGED_HOST_MISMATCH' }
if ((Get-FileHash -LiteralPath $PublicCertificate -Algorithm SHA256).Hash -ine $CertificateSha256) { throw 'CERTIFICATE_HASH_MISMATCH' }
$cert = [Security.Cryptography.X509Certificates.X509Certificate2]::new([IO.File]::ReadAllBytes($PublicCertificate))
if ($cert.HasPrivateKey -or $cert.Thumbprint -ine $Thumbprint -or $cert.Subject -cne $cert.Issuer) { throw 'PINNED_PUBLIC_SELF_SIGNED_CERTIFICATE_REQUIRED' }
$eku = @($cert.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.37' })
if ($eku.Count -ne 1 -or @($eku[0].EnhancedKeyUsages).Count -ne 1 -or $eku[0].EnhancedKeyUsages[0].Value -ne '1.3.6.1.5.5.7.3.3') { throw 'CODE_SIGNING_ONLY_EKU_REQUIRED' }
$constraints = @($cert.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.19' })
$usage = @($cert.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.15' })
if (@($constraints | Where-Object CertificateAuthority).Count -or $usage.Count -ne 1 -or $usage[0].KeyUsages -ne [Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature) { throw 'END_ENTITY_SIGNING_KEY_REQUIRED' }
if ($Action -eq 'Trust') {
  if ($cert.NotBefore -gt (Get-Date) -or $cert.NotAfter -le (Get-Date)) { throw 'CERTIFICATE_EXPIRED_OR_NOT_YET_VALID' }
  foreach ($location in @('LocalMachine', 'CurrentUser')) {
    if (Test-Path "Cert:/$location/Disallowed/$Thumbprint") { throw 'CERTIFICATE_EXPLICITLY_REVOKED' }
  }
  $added = @()
  try {
    foreach ($store in @('Root', 'TrustedPublisher')) {
      $path = "Cert:/LocalMachine/$store/$Thumbprint"
      if (-not (Test-Path $path)) {
        Import-Certificate -FilePath $PublicCertificate -CertStoreLocation "Cert:/LocalMachine/$store" | Out-Null
        $added += $path
      }
    }
    $chain = [Security.Cryptography.X509Certificates.X509Chain]::new()
    try {
      $chain.ChainPolicy.RevocationMode = [Security.Cryptography.X509Certificates.X509RevocationMode]::Online
      if (-not $chain.Build($cert)) { throw 'TRUSTED_CERTIFICATE_CHAIN_INVALID' }
    } finally { $chain.Dispose() }
  } catch {
    foreach ($path in $added) { Remove-Item -LiteralPath $path }
    throw
  }
} else {
  # Explicit distrust is needed: this private pinned certificate has no public CA revocation service.
  Import-Certificate -FilePath $PublicCertificate -CertStoreLocation Cert:/LocalMachine/Disallowed | Out-Null
  foreach ($location in @('LocalMachine', 'CurrentUser')) {
    foreach ($store in @('Root', 'TrustedPublisher')) {
      $path = "Cert:/$location/$store/$Thumbprint"
      if (Test-Path $path) { Remove-Item -LiteralPath $path }
    }
  }
}
[ordered]@{ status = 'PASS'; action = $Action; computer = $env:COMPUTERNAME; thumbprint = $cert.Thumbprint; privateKeyImported = $false; rootTrusted = (Test-Path "Cert:/LocalMachine/Root/$Thumbprint"); publisherTrusted = (Test-Path "Cert:/LocalMachine/TrustedPublisher/$Thumbprint"); explicitlyDistrusted = (Test-Path "Cert:/LocalMachine/Disallowed/$Thumbprint") } | ConvertTo-Json
