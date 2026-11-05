#Requires -Version 5.1
#Requires -RunAsAdministrator
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$ExpectedComputerName,
  [Parameter(Mandatory)][string]$PublicCertificate,
  [string]$Subject = 'CN=HasarBotu Office Code Signing, O=HasarBotu Internal',
  [switch]$Renew
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($env:COMPUTERNAME -ine $ExpectedComputerName) { throw 'SIGNING_HOST_MISMATCH' }
if (Test-Path -LiteralPath $PublicCertificate) { throw 'PUBLIC_CERTIFICATE_ALREADY_EXISTS' }
$existing = @(Get-ChildItem Cert:/CurrentUser/My -CodeSigningCert | Where-Object { $_.Subject -ceq $Subject -and $_.HasPrivateKey -and $_.NotAfter -gt (Get-Date) })
if ($existing.Count -and -not $Renew) { throw 'SIGNING_IDENTITY_EXISTS_USE_EXPLICIT_RENEWAL' }
$directory = Split-Path ([IO.Path]::GetFullPath($PublicCertificate)) -Parent
if (-not (Test-Path -LiteralPath $directory -PathType Container)) { throw 'OUTPUT_DIRECTORY_REQUIRED' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
$security = [Security.AccessControl.FileSecurity]::new()
$security.SetAccessRuleProtection($true, $false)
$security.SetOwner($identity)
foreach ($sid in @($identity, [Security.Principal.SecurityIdentifier]::new('S-1-5-18'), [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))) {
  $security.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'Allow'))
}
# A code-signing-only, directly pinned trust anchor avoids introducing a general-purpose company CA.
$cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject $Subject -FriendlyName ('HasarBotu Office Signing ' + (Get-Date -Format yyyyMMdd-HHmmss)) -CertStoreLocation Cert:/CurrentUser/My -Provider 'Microsoft Software Key Storage Provider' -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 -KeyUsage DigitalSignature -KeyExportPolicy NonExportable -KeyUsageProperty Sign -SecurityDescriptor $security -NotAfter (Get-Date).AddYears(1)
$rsa = [Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($cert)
try {
  if ($rsa -isnot [Security.Cryptography.RSACng] -or $rsa.Key.ExportPolicy -ne [Security.Cryptography.CngExportPolicies]::None) { throw 'NONEXPORTABLE_CNG_KEY_REQUIRED' }
  $keyPath = Join-Path $env:APPDATA ('Microsoft/Crypto/Keys/' + $rsa.Key.UniqueName)
  Set-Acl -LiteralPath $keyPath -AclObject $security
  $acl = Get-Acl -LiteralPath $keyPath
  if (-not $acl.AreAccessRulesProtected) { throw 'PRIVATE_KEY_ACL_NOT_PROTECTED' }
  $allowed = @($identity.Value, 'S-1-5-18', 'S-1-5-32-544')
  foreach ($rule in $acl.Access) {
    if ($rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin $allowed) { throw 'PRIVATE_KEY_ACCESS_TOO_BROAD' }
  }
} finally { if ($rsa) { $rsa.Dispose() } }
Export-Certificate -Cert $cert -FilePath $PublicCertificate -Type CERT | Out-Null
$public = [Security.Cryptography.X509Certificates.X509Certificate2]::new([IO.File]::ReadAllBytes($PublicCertificate))
if ($public.HasPrivateKey) { throw 'PUBLIC_EXPORT_CONTAINS_PRIVATE_KEY' }
[ordered]@{ status = 'CREATED'; computer = $env:COMPUTERNAME; thumbprint = $cert.Thumbprint; subject = $cert.Subject; expires = $cert.NotAfter.ToUniversalTime().ToString('o'); privateKeyExportable = $false; keyAclRestricted = $true; publicCertificateSha256 = (Get-FileHash -LiteralPath $PublicCertificate -Algorithm SHA256).Hash.ToLowerInvariant(); trustInstalled = $false } | ConvertTo-Json
