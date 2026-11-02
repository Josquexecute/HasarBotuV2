using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class OfficeServiceRecovery
{
    [StructLayout(LayoutKind.Sequential)]
    public struct Action { public uint Type; public uint Delay; }
    public sealed class Policy { public uint ResetSeconds; public string RebootMessage; public string Command; public Action[] Actions; }
    [StructLayout(LayoutKind.Sequential)]
    private struct NativePolicy { public uint ResetSeconds; public IntPtr RebootMessage; public IntPtr Command; public uint Count; public IntPtr Actions; }
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr OpenSCManager(string machine, string database, uint access);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr OpenService(IntPtr manager, string name, uint access);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool QueryServiceConfig2(IntPtr service, uint level, IntPtr buffer, uint size, out uint needed);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool ChangeServiceConfig2(IntPtr service, uint level, ref NativePolicy policy);
    [DllImport("advapi32.dll")]
    private static extern bool CloseServiceHandle(IntPtr handle);
    private static IntPtr Open(string name, uint access)
    {
        IntPtr manager = OpenSCManager(null, null, 1);
        if (manager == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        try {
            IntPtr service = OpenService(manager, name, access);
            if (service == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
            return service;
        } finally { CloseServiceHandle(manager); }
    }
    public static Policy Read(string name)
    {
        IntPtr service = Open(name, 1), buffer = IntPtr.Zero;
        try {
            uint needed;
            QueryServiceConfig2(service, 2, IntPtr.Zero, 0, out needed);
            if (needed == 0 || needed > 1048576) throw new Win32Exception(Marshal.GetLastWin32Error());
            buffer = Marshal.AllocHGlobal((int)needed);
            if (!QueryServiceConfig2(service, 2, buffer, needed, out needed)) throw new Win32Exception(Marshal.GetLastWin32Error());
            NativePolicy native = (NativePolicy)Marshal.PtrToStructure(buffer, typeof(NativePolicy));
            if (native.Count > 64) throw new InvalidOperationException("RECOVERY_ACTION_LIMIT");
            Policy result = new Policy { ResetSeconds = native.ResetSeconds, RebootMessage = Marshal.PtrToStringUni(native.RebootMessage), Command = Marshal.PtrToStringUni(native.Command), Actions = new Action[native.Count] };
            for (int i = 0; i < result.Actions.Length; i++) result.Actions[i] = (Action)Marshal.PtrToStructure(IntPtr.Add(native.Actions, i * Marshal.SizeOf(typeof(Action))), typeof(Action));
            return result;
        } finally { if (buffer != IntPtr.Zero) Marshal.FreeHGlobal(buffer); CloseServiceHandle(service); }
    }
    public static void Write(string name, Policy policy)
    {
        if (policy.Actions == null || policy.Actions.Length > 64) throw new ArgumentException("RECOVERY_ACTION_LIMIT");
        // SC_ACTION_RESTART requires SERVICE_START as well as SERVICE_CHANGE_CONFIG.
        IntPtr service = Open(name, 2 | 16), actions = IntPtr.Zero, message = IntPtr.Zero, command = IntPtr.Zero;
        try {
            actions = Marshal.AllocHGlobal(Math.Max(1, policy.Actions.Length * Marshal.SizeOf(typeof(Action))));
            for (int i = 0; i < policy.Actions.Length; i++) Marshal.StructureToPtr(policy.Actions[i], IntPtr.Add(actions, i * Marshal.SizeOf(typeof(Action))), false);
            message = Marshal.StringToHGlobalUni(policy.RebootMessage ?? "");
            command = Marshal.StringToHGlobalUni(policy.Command ?? "");
            NativePolicy native = new NativePolicy { ResetSeconds = policy.ResetSeconds, RebootMessage = message, Command = command, Count = (uint)policy.Actions.Length, Actions = actions };
            if (!ChangeServiceConfig2(service, 2, ref native)) throw new Win32Exception(Marshal.GetLastWin32Error());
        } finally {
            if (actions != IntPtr.Zero) Marshal.FreeHGlobal(actions);
            if (message != IntPtr.Zero) Marshal.FreeHGlobal(message);
            if (command != IntPtr.Zero) Marshal.FreeHGlobal(command);
            CloseServiceHandle(service);
        }
    }
}
