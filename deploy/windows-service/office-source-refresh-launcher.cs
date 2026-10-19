using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;

public static class OfficeSourceRefreshLauncher {
  public static int Main(string[] args) {
    if (args.Length != 1 || (args[0] != "all" && args[0] != "pending" && args[0] != "preview")) return 2;
    try {
      string directory = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
      string script = Path.Combine(directory, "run-office-source-refresh.ps1");
      if (!File.Exists(script)) return 3;
      var start = new ProcessStartInfo {
        FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell\\v1.0\\powershell.exe"),
        Arguments = "-NoProfile -NonInteractive -WindowStyle Hidden -File \"" + script + "\" -Mode " + args[0],
        UseShellExecute = false,
        CreateNoWindow = true,
        WindowStyle = ProcessWindowStyle.Hidden
      };
      using (var child = Process.Start(start)) {
        child.WaitForExit();
        return child.ExitCode;
      }
    // Task Scheduler records this code even though the launcher has no console.
    } catch (Exception error) { return error.HResult != 0 ? error.HResult : 1; }
  }
}
