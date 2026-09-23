@echo off
set CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
if not exist 发布 mkdir 发布
powershell -NoProfile -Command "Compress-Archive -Path 'site' -DestinationPath 'shell\site.zip' -Force"
"%CSC%" /nologo /target:winexe /win32icon:"shell\blackjack.ico" /out:"发布\春山21点-单文件版.exe" /r:System.Windows.Forms.dll /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll /resource:"shell\site.zip",site.zip "shell\Program.cs"
