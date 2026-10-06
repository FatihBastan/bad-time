# bad-time: lists processes whose command line mentions bad-time, as "pid command line",
# so the mod can find and close only its own leftover game windows.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*bad-time*' } | ForEach-Object { '{0} {1}' -f $_.ProcessId, $_.CommandLine }
