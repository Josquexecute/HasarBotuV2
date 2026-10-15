param([Parameter(Mandatory=$true)][int]$ExpectedProcessId)
$ErrorActionPreference='Stop'
if($ExpectedProcessId -le 0){throw 'INVALID_OWNED_PROCESS_ID'}
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class HBPackageSmokeWindows {
 public delegate bool EnumProc(IntPtr hwnd, IntPtr value);
 [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr value);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint id);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd,StringBuilder text,int count);
 [DllImport("user32.dll")] static extern bool PostMessage(IntPtr hwnd,uint message,IntPtr wparam,IntPtr lparam);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
 public static bool Hidden(uint expectedId) {
  bool found=false,visible=false;
  EnumWindows(delegate(IntPtr hwnd,IntPtr value) {
   uint id;GetWindowThreadProcessId(hwnd,out id);
   if(id!=expectedId)return true;
   var title=new StringBuilder(256);GetWindowText(hwnd,title,title.Capacity);
   if(title.ToString()=="HasarBotu V2"){found=true;visible=IsWindowVisible(hwnd);}
   return true;
  },IntPtr.Zero);
  return found && !visible;
 }
 public static int Close(uint expectedId) {
  int closed=0;
  EnumWindows(delegate(IntPtr hwnd,IntPtr value) {
   uint id;GetWindowThreadProcessId(hwnd,out id);
   if(id!=expectedId)return true;
   var title=new StringBuilder(256);GetWindowText(hwnd,title,title.Capacity);
   if(title.ToString()=="HasarBotu V2" && PostMessage(hwnd,0x0010,IntPtr.Zero,IntPtr.Zero))closed++;
   return true;
  },IntPtr.Zero);
  return closed;
 }
}
'@
$closed=0;$deadline=[DateTime]::UtcNow.AddSeconds(12)
do{$closed=[HBPackageSmokeWindows]::Close([uint32]$ExpectedProcessId);if($closed -eq 0){Start-Sleep -Milliseconds 100}}while($closed -eq 0 -and [DateTime]::UtcNow -lt $deadline)
if($closed -lt 1){throw 'OWNED_APP_WINDOW_NOT_FOUND'}
$deadline=[DateTime]::UtcNow.AddSeconds(5)
do {if([HBPackageSmokeWindows]::Hidden([uint32]$ExpectedProcessId)){exit 0};Start-Sleep -Milliseconds 100}while([DateTime]::UtcNow -lt $deadline)
throw 'CLOSE_DID_NOT_HIDE_OWNED_APP_TO_TRAY'
