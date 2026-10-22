Option Explicit
Dim fso, sh, base, dataDir, logFile, q, cmd
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
base = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = base
dataDir = sh.ExpandEnvironmentStrings("%APPDATA%") & "\Codex Taskboard"
If Not fso.FolderExists(dataDir) Then fso.CreateFolder(dataDir)
logFile = dataDir & "\start-taskboard.log"
q = Chr(34)
cmd = "cmd /c " & q & q & base & "\start-taskboard.bat" & q & " --silent > " & q & logFile & q & " 2>&1" & q
sh.Run cmd, 0, False
