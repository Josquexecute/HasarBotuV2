$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot '../../distribution/office-hosts.psm1') -Force
$encoding=[Text.Encoding]::UTF8
$hostName='office.example.test';$address='192.168.1.100';$checks=0
function Assert([bool]$value){if(-not $value){throw 'OFFICE_HOSTS_REGRESSION'};$script:checks++}
$original=$encoding.GetBytes("# Türkçe yorum`r`n127.0.0.1 localhost`r`n10.10.1.5 other.example.test`r`n")
$added=Update-OfficeHostsContent $original $hostName $address
Assert ([Convert]::ToBase64String($added[0..($original.Length-1)]) -eq [Convert]::ToBase64String($original))
Assert ($encoding.GetString($added).Contains('192.168.1.100 office.example.test'))
$replay=Update-OfficeHostsContent $added $hostName $address
Assert ([Convert]::ToBase64String($replay) -eq [Convert]::ToBase64String($added))
$moved=Update-OfficeHostsContent $added $hostName '192.168.1.101'
Assert ($encoding.GetString($moved).Contains('192.168.1.101 office.example.test'))
Assert (-not $encoding.GetString($moved).Contains('192.168.1.100 office.example.test'))
$removed=Update-OfficeHostsContent $added $hostName $address -Remove
Assert ([Convert]::ToBase64String($removed) -eq [Convert]::ToBase64String($original))
$existing=$encoding.GetBytes("192.168.1.100 office.example.test another.example.test`n")
Assert ([Convert]::ToBase64String((Update-OfficeHostsContent $existing $hostName $address)) -eq [Convert]::ToBase64String($existing))
foreach($content in @('192.168.1.99 office.example.test',"# HasarBotu office connection BEGIN`n",($encoding.GetString($added)+$encoding.GetString($added)))){
 $failed=$false
 try{$null=Update-OfficeHostsContent ($encoding.GetBytes($content)) $hostName $address}catch{$failed=$true}
 Assert $failed
}
$bom=[byte[]](@(239,187,191)+$original)
$bomAdded=Update-OfficeHostsContent $bom $hostName $address
Assert ([Convert]::ToBase64String($bomAdded[0..($bom.Length-1)]) -eq [Convert]::ToBase64String($bom))
@{status='PASS';checks=$checks;systemHostsModified=$false}|ConvertTo-Json -Compress
