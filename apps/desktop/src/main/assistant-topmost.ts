import { spawn } from 'node:child_process'
import type { BrowserWindow } from 'electron'

/** Windows keeps taskbar and floating app windows in the same topmost band.
 * Electron's creation flag alone does not restore their order after shell events.
 * An out-of-context WinEvent hook reorders without activation, timers or injection.
 */
export function guardAssistantTopmost(window: BrowserWindow): () => void {
  const raise = () => {
    if (window.isDestroyed() || !window.isVisible()) return
    window.setAlwaysOnTop(true, 'pop-up-menu')
    window.moveTop()
  }
  window.on('show', raise)
  if (process.platform !== 'win32') return () => { window.removeListener('show', raise) }
  const handle = window.getNativeWindowHandle().readBigUInt64LE().toString()
  const source = `
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
public static class TouchTopmost {
  delegate void WinEvent(IntPtr hook,uint evt,IntPtr hwnd,int obj,int child,uint thread,uint time);
  [StructLayout(LayoutKind.Sequential)] struct Rect { public int L,T,R,B; }
  [StructLayout(LayoutKind.Sequential)] struct Monitor { public int Size; public Rect Bounds,Work; public uint Flags; }
  [StructLayout(LayoutKind.Sequential)] struct Msg { public IntPtr H; public uint M; public UIntPtr W; public IntPtr L; public uint Time; public int X,Y; }
  [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint a,uint b,IntPtr module,WinEvent cb,uint pid,uint tid,uint flags);
  [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr hook);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h,IntPtr order,int x,int y,int w,int hgt,uint flags);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern IntPtr GetShellWindow();
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h,StringBuilder name,int max);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h,out Rect r);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h,uint flags);
  [DllImport("user32.dll",CharSet=CharSet.Auto)] static extern bool GetMonitorInfo(IntPtr h,ref Monitor m);
  [DllImport("user32.dll",EntryPoint="GetWindowLongPtrW")] static extern IntPtr GetWindowLongPtr(IntPtr h,int index);
  [DllImport("user32.dll")] static extern int GetMessage(out Msg m,IntPtr h,uint a,uint b);
  [DllImport("user32.dll")] static extern bool PostThreadMessage(uint tid,uint msg,UIntPtr w,IntPtr l);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  static IntPtr target;
  static WinEvent callback = Changed;
  static void Changed(IntPtr hook,uint evt,IntPtr hwnd,int obj,int child,uint thread,uint time) {
    bool taskbar = false;
    if (evt == 0x800B || evt == 0x8002) {
      if (obj != 0) return;
      if (hwnd != target && hwnd != GetForegroundWindow()) {
        var name = new StringBuilder(128); GetClassName(hwnd,name,name.Capacity);
        taskbar = name.ToString() == "Shell_TrayWnd" || name.ToString() == "Shell_SecondaryTrayWnd";
        if (!taskbar) return;
      }
    }
    Refresh(taskbar || evt != 0x800B);
  }
  static void Refresh(bool reorder) {
    if (!IsWindowVisible(target) || IsIconic(target)) return;
    IntPtr foreground = GetForegroundWindow();
    if (foreground == target) return;
    var monitor = MonitorFromWindow(foreground,2);
    var name = new StringBuilder(128); GetClassName(foreground,name,name.Capacity);
    bool desktop = foreground == GetShellWindow() || name.ToString() == "Progman" || name.ToString() == "WorkerW";
    Rect rect; var info = new Monitor(); info.Size = Marshal.SizeOf(info);
    bool fullscreen = !desktop && monitor == MonitorFromWindow(target,2) && GetMonitorInfo(monitor,ref info)
      && GetWindowRect(foreground,out rect) && (GetWindowLongPtr(foreground,-16).ToInt64() & 0x00C00000) == 0
      && rect.L <= info.Bounds.L && rect.T <= info.Bounds.T && rect.R >= info.Bounds.R && rect.B >= info.Bounds.B;
    // Respect full-screen apps and secure desktops. Never focus or close another app.
    bool topmost = (GetWindowLongPtr(target,-20).ToInt64() & 8) != 0;
    if (!reorder && topmost == !fullscreen) return;
    SetWindowPos(target,new IntPtr(fullscreen ? -2 : -1),0,0,0,0,0x0013);
  }
  public static void Run(long hwnd,int parent) {
    target = new IntPtr(hwnd);
    uint thread = GetCurrentThreadId();
    using (var process = Process.GetProcessById(parent)) {
      process.EnableRaisingEvents = true;
      process.Exited += (s,e) => PostThreadMessage(thread,0x0012,UIntPtr.Zero,IntPtr.Zero);
      var focus = SetWinEventHook(3,3,IntPtr.Zero,callback,0,0,0);
      var bounds = SetWinEventHook(0x800B,0x800B,IntPtr.Zero,callback,0,0,0);
      var show = SetWinEventHook(0x8002,0x8002,IntPtr.Zero,callback,0,0,0);
      if (focus == IntPtr.Zero || bounds == IntPtr.Zero || show == IntPtr.Zero) throw new Exception("Touch foreground hook unavailable");
      try { Refresh(true); Msg message; while (!process.HasExited && GetMessage(out message,IntPtr.Zero,0,0) > 0) {} }
      finally { UnhookWinEvent(focus); UnhookWinEvent(bounds); UnhookWinEvent(show); }
    }
  }
}`
  const script = `Add-Type -TypeDefinition @'\n${source}\n'@\n[TouchTopmost]::Run(${handle}, ${process.pid})`
  const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, stdio: 'ignore' })
  let stopped = false
  child.on('error', () => { if (!stopped) console.warn('Touch foreground hook could not start') })
  child.on('exit', code => { if (!stopped && code !== 0) console.warn('Touch foreground hook stopped unexpectedly') })
  return () => { stopped = true; window.removeListener('show', raise); child.kill() }
}
