import { spawn } from 'node:child_process'
import { fileLockInfoSchema, type FileLockInfo } from '@hasarbotu/contracts'
import { lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'

// Runs outside the agent so an unresponsive network filesystem cannot block its lease.
// DELETE probes never modify files; only sharing violations count as lock evidence.
const WORKER = String.raw`
$ErrorActionPreference='Stop'
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class LockProbe {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
  [StructLayout(LayoutKind.Sequential)] struct IO_STATUS_BLOCK { public IntPtr status; public UIntPtr information; }
  [DllImport("ntdll.dll")] static extern int NtQueryInformationFile(SafeFileHandle file, out IO_STATUS_BLOCK status, IntPtr buffer, uint length, int infoClass);
  [StructLayout(LayoutKind.Sequential)] struct UNIQUE_PROCESS { public uint pid; public System.Runtime.InteropServices.ComTypes.FILETIME start; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct PROCESS_INFO {
    public UNIQUE_PROCESS process;
    [MarshalAs(UnmanagedType.ByValTStr,SizeConst=256)] public string name;
    [MarshalAs(UnmanagedType.ByValTStr,SizeConst=64)] public string service;
    public uint type, status, session;
    [MarshalAs(UnmanagedType.Bool)] public bool restartable;
  }
  [DllImport("rstrtmgr.dll",CharSet=CharSet.Unicode)] static extern int RmStartSession(out uint session, uint flags, string key);
  [DllImport("rstrtmgr.dll",CharSet=CharSet.Unicode)] static extern int RmRegisterResources(uint session, uint count, string[] files, uint applications, IntPtr apps, uint services, IntPtr names);
  [DllImport("rstrtmgr.dll")] static extern int RmGetList(uint session, out uint needed, ref uint count, [In,Out] PROCESS_INFO[] info, ref uint reasons);
  [DllImport("rstrtmgr.dll")] static extern int RmEndSession(uint session);
  public static bool Blocked(string path) {
    using(var file=CreateFile(path,0x10000,7,IntPtr.Zero,3,0x02000000,IntPtr.Zero)) {
      if(!file.IsInvalid) return false;
      int code=Marshal.GetLastWin32Error(); return code==32 || code==33;
    }
  }
  public static int[] Owners(string path, bool directory) {
    var ids=new HashSet<int>();
    // Unlike Restart Manager, this query can also identify directory handles.
    using(var file=CreateFile(path,0,7,IntPtr.Zero,3,0x02000000,IntPtr.Zero)) {
      if(!file.IsInvalid) {
        IntPtr buffer=Marshal.AllocHGlobal(8192);
        try {
          IO_STATUS_BLOCK status;
          if(NtQueryInformationFile(file,out status,buffer,8192,47)==0) {
            int count=Marshal.ReadInt32(buffer);
            for(int i=0;i<Math.Min(count,512);i++) {
              long id=Marshal.ReadIntPtr(buffer,IntPtr.Size*(i+1)).ToInt64();
              if(id>0 && id<=int.MaxValue && id!=Process.GetCurrentProcess().Id) ids.Add((int)id);
            }
          }
        } finally { Marshal.FreeHGlobal(buffer); }
      }
    }
    if(!directory) {
      uint session;
      if(RmStartSession(out session,0,Guid.NewGuid().ToString("N"))==0) {
        try {
          if(RmRegisterResources(session,1,new[]{path},0,IntPtr.Zero,0,IntPtr.Zero)==0) {
            uint needed,count=0,reasons=0;
            int code=RmGetList(session,out needed,ref count,null,ref reasons);
            if(code==234 && needed<=512) {
              var info=new PROCESS_INFO[needed];count=needed;
              if(RmGetList(session,out needed,ref count,info,ref reasons)==0)
                for(int i=0;i<count;i++) ids.Add((int)info[i].process.pid);
            }
          }
        } finally { RmEndSession(session); }
      }
    }
    var result=new int[ids.Count];ids.CopyTo(result);return result;
  }
}
'@
$request=ConvertFrom-Json -InputObject ([Console]::In.ReadToEnd())
$ids=@{};$blocked=0;$unavailable=$false
foreach($entry in $request.entries) {
  if([LockProbe]::Blocked($entry.path)) {
    $blocked++
    foreach($processId in [LockProbe]::Owners($entry.path,$entry.directory)) {
      try { $p=[Diagnostics.Process]::GetProcessById($processId);$ids[[string]$processId]=@{pid=$processId;name=$p.ProcessName} }
      catch [ArgumentException] { $unavailable=$true }
      catch [InvalidOperationException] { $unavailable=$true }
      catch [ComponentModel.Win32Exception] { $unavailable=$true }
    }
  }
}
@{blocked=$blocked;applications=@($ids.Values | Select-Object -First 8);truncated=($unavailable -or $ids.Count -gt 8)} | ConvertTo-Json -Compress -Depth 4
`

export async function diagnoseWindowsLocks(directory: string): Promise<FileLockInfo | undefined> {
  if (process.platform !== 'win32') return undefined
  const entries: { path: string; directory: boolean }[] = []
  let truncated = false
  async function walk(path: string): Promise<void> {
    if (entries.length >= 2048) { truncated = true; return }
    const info = await lstat(path)
    if (info.isSymbolicLink()) return
    entries.push({ path, directory: info.isDirectory() })
    if (info.isDirectory()) for (const name of await readdir(path)) await walk(join(path, name))
  }
  try {
    await walk(directory)
    return await new Promise(resolve => {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(WORKER, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] })
      let output = ''
      const finish = (result?: FileLockInfo) => { clearTimeout(timer); resolve(result) }
      const timer = setTimeout(() => { child.kill(); finish() }, 12_000)
      child.on('error', () => finish())
      child.stdin.on('error', () => finish())
      child.stdout.on('data', chunk => { output += String(chunk); if (output.length > 8192) { child.kill(); finish() } })
      child.on('close', code => {
        if (code !== 0) return finish()
        try {
          const raw = JSON.parse(output.replace(/^\uFEFF/u, '')) as { blocked: number; applications: unknown; truncated: boolean }
          if (!raw.blocked) return finish()
          const parsed = fileLockInfoSchema.safeParse({ applications: raw.applications, truncated: truncated || raw.truncated })
          finish(parsed.success ? parsed.data : undefined)
        } catch { finish() }
      })
      child.stdin.end(JSON.stringify({ entries }))
    })
  } catch {
    // Diagnostics are best effort; the failed move and its error remain authoritative.
    return undefined
  }
}
