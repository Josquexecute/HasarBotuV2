import { spawn } from 'node:child_process'
import type { BrowserWindow } from 'electron'

/** Repair only Touch's order after an external foreground window covers it.
 * Never activate a window, demote Touch for fullscreen, or reposition the shell.
 * On Windows 11, fullscreen NOTOPMOST demotion also restores the taskbar above
 * the video. Keep Touch in its own topmost band; let Explorer manage the taskbar.
 * The out-of-context hook sleeps in GetMessage; it has no polling timer.
 */
export function guardAssistantTopmost(window: BrowserWindow): () => void {
  const raise = () => {
    if (window.isDestroyed() || !window.isVisible()) return
    window.moveTop()
  }
  window.setAlwaysOnTop(true, 'pop-up-menu')
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
  [StructLayout(LayoutKind.Sequential)] struct Msg { public IntPtr H; public uint M; public UIntPtr W; public IntPtr L; public uint Time; public int X,Y; }
  [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint a,uint b,IntPtr module,WinEvent cb,uint pid,uint tid,uint flags);
  [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr hook);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h,IntPtr order,int x,int y,int w,int hgt,uint flags);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern IntPtr GetDesktopWindow();
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h,StringBuilder name,int length);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h,uint command);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll",EntryPoint="GetWindowLongPtrW")] static extern IntPtr GetWindowLongPtr(IntPtr h,int index);
  [DllImport("user32.dll")] static extern int GetMessage(out Msg m,IntPtr h,uint a,uint b);
  [DllImport("user32.dll")] static extern bool PostThreadMessage(uint tid,uint msg,UIntPtr w,IntPtr l);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  static IntPtr target;
  static uint owner;
  const uint ObjectLocationChange = 0x800B, ObjectReorder = 0x8004, Foreground = 3;
  const uint NoSize = 1, NoMove = 2, NoActivate = 0x10, NoOwnerZOrder = 0x200;
  static WinEvent callback = Changed;
  static void Changed(IntPtr hook,uint evt,IntPtr hwnd,int obj,int child,uint thread,uint time) {
    // Top-level z-order changes are reported on the desktop container, including
    // its OBJID_CLIENT. They need not move or reactivate the foreground window.
    if (evt == ObjectReorder) {
      if (hwnd == GetDesktopWindow()) Refresh();
      return;
    }
    // Ignore our SetWindowPos notifications, child objects and background motion.
    if (hwnd == target || obj != 0 || child != 0) return;
    if (hwnd == IntPtr.Zero || hwnd != GetForegroundWindow()) return;
    Refresh();
  }
  static void Refresh() {
    if (!IsWindowVisible(target) || IsIconic(target)) return;
    IntPtr foreground = GetForegroundWindow();
    if (foreground == IntPtr.Zero || foreground == target) return;
    uint pid; GetWindowThreadProcessId(foreground,out pid);
    // Explicitly opened HasarBotu panels retain their own stacking and focus.
    if (pid == owner) return;
    bool topmost = (GetWindowLongPtr(target,-20).ToInt64() & 8) != 0;
    if (topmost) {
      bool covered = false;
      for (IntPtr h = GetWindow(target,3); h != IntPtr.Zero; h = GetWindow(h,3)) {
        if (h == foreground) { covered = true; break; }
      }
      if (!covered) return;
    }
    var name = new StringBuilder(128);
    if (GetClassName(foreground,name,name.Capacity) == 0) return;
    // Shell transition surfaces own Windows 11 task switching. Leave the
    // switcher/taskbar in charge until a
    // normal application becomes foreground; Explorer CabinetWClass is allowed.
    switch (name.ToString()) {
      case "ForegroundStaging": case "XamlExplorerHostIslandWindow":
      case "MultitaskingViewFrame": case "Shell_TrayWnd":
      case "Shell_SecondaryTrayWnd": return;
    }
    if (!SetWindowPos(target,new IntPtr(-1),0,0,0,0,NoSize | NoMove | NoActivate | NoOwnerZOrder))
      throw new InvalidOperationException("Touch z-order repair failed");
  }
  public static void Run(long hwnd,int parent) {
    target = new IntPtr(hwnd);
    owner = (uint)parent;
    uint thread = GetCurrentThreadId();
    using (var process = Process.GetProcessById(parent)) {
      process.EnableRaisingEvents = true;
      process.Exited += (s,e) => PostThreadMessage(thread,0x0012,UIntPtr.Zero,IntPtr.Zero);
      var focus = SetWinEventHook(Foreground,Foreground,IntPtr.Zero,callback,0,0,0);
      var bounds = SetWinEventHook(ObjectLocationChange,ObjectLocationChange,IntPtr.Zero,callback,0,0,0);
      var order = SetWinEventHook(ObjectReorder,ObjectReorder,IntPtr.Zero,callback,0,0,0);
      try {
        if (focus == IntPtr.Zero || bounds == IntPtr.Zero || order == IntPtr.Zero) throw new Exception("Touch foreground hook unavailable");
        Refresh(); Msg message;
        while (!process.HasExited && GetMessage(out message,IntPtr.Zero,0,0) > 0) {}
      } finally { if (focus != IntPtr.Zero) UnhookWinEvent(focus); if (bounds != IntPtr.Zero) UnhookWinEvent(bounds); if (order != IntPtr.Zero) UnhookWinEvent(order); }
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
