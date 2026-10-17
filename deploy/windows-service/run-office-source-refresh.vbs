Option Explicit
Dim mode, shell, files, script, command
If WScript.Arguments.Count <> 1 Then WScript.Quit 2
mode = WScript.Arguments(0)
If mode <> "all" And mode <> "pending" And mode <> "preview" Then WScript.Quit 2
Set files = CreateObject("Scripting.FileSystemObject")
script = files.BuildPath(files.GetParentFolderName(WScript.ScriptFullName), "run-office-source-refresh.ps1")
Set shell = CreateObject("WScript.Shell")
command = """" & shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\WindowsPowerShell\v1.0\powershell.exe"" -NoProfile -NonInteractive -WindowStyle Hidden -File """ & script & """ -Mode " & mode
' Create the child hidden from its first window; Task Scheduler Hidden only hides the task entry.
WScript.Quit shell.Run(command, 0, True)
