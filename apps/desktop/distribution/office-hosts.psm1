Set-StrictMode -Version Latest

function Update-OfficeHostsContent {
 param([byte[]]$Bytes,[string]$Hostname,[string]$Address,[switch]$Remove)
 if($Hostname -notmatch '^[a-zA-Z0-9][a-zA-Z0-9.-]+$' -or $Address -notmatch '^(10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$'){throw 'INVALID_OFFICE_HOSTS_INPUT'}
 if($Bytes.Length -gt 1048576){throw 'HOSTS_SIZE_LIMIT'}
 if($Bytes.Length -ge 2 -and (($Bytes[0] -eq 255 -and $Bytes[1] -eq 254) -or ($Bytes[0] -eq 254 -and $Bytes[1] -eq 255))){throw 'UNSUPPORTED_HOSTS_ENCODING'}
 # Latin1 is a byte-preserving view. Only our ASCII block is changed; existing comments retain their encoding.
 $encoding=[Text.Encoding]::GetEncoding(28591)
 $text=$encoding.GetString($Bytes)
 $begin='# HasarBotu office connection BEGIN'
 $end='# HasarBotu office connection END'
 $pattern='(?m)^'+[regex]::Escape($begin)+'\r?\n[^\r\n]*\r?\n'+[regex]::Escape($end)+'(?:\r?\n|$)'
 $matches=[regex]::Matches($text,$pattern)
 if($matches.Count -gt 1){throw 'DUPLICATE_OWNED_HOSTS_BLOCK'}
 if(($text.Contains($begin) -or $text.Contains($end)) -and $matches.Count -ne 1){throw 'DAMAGED_OWNED_HOSTS_BLOCK'}
 $remaining=[regex]::Replace($text,$pattern,'')
 if($Remove){return ,($encoding.GetBytes($remaining))}
 foreach($line in ($remaining -split '\r?\n')){
  $parts=(($line -split '#',2)[0].Trim() -split '\s+')
  if($parts.Length -gt 1 -and @($parts[1..($parts.Length-1)]|Where-Object {$_ -ieq $Hostname}).Count){
   if($parts[0] -ne $Address){throw 'EXISTING_DNS_CONFLICT'}
   return ,($encoding.GetBytes($remaining))
  }
 }
 $newline=if($text.Contains("`r`n") -or -not $text){"`r`n"}else{"`n"}
 $block=$begin+$newline+$Address+' '+$Hostname+$newline+$end+$newline
 if($matches.Count -eq 1){$updated=[regex]::Replace($text,$pattern,[Text.RegularExpressions.MatchEvaluator]{param($match) $block})}
 else{$updated=$text+$(if($text -and -not $text.EndsWith("`n")){$newline})+$block}
 return ,($encoding.GetBytes($updated))
}

Export-ModuleMember -Function Update-OfficeHostsContent
