# bad-time: closes the game browser if the launcher is gone (for example, Claude exited).
$ErrorActionPreference = 'Stop'
try {
  $launcher = Get-Process -Id ([int]$env:BADTIME_WATCH_LAUNCHER)
  $browser = Get-Process -Id ([int]$env:BADTIME_WATCH_BROWSER)
} catch { exit }
while (-not $browser.HasExited) {
  if ($launcher.HasExited) {
    try { [void]$browser.CloseMainWindow() } catch {}
    for ($i = 0; $i -lt 20 -and -not $browser.HasExited; $i++) { Start-Sleep -Milliseconds 150 }
    if (-not $browser.HasExited) { & (Join-Path ([Environment]::SystemDirectory) 'taskkill.exe') /PID $browser.Id /T /F | Out-Null }
    break
  }
  Start-Sleep -Milliseconds 500
}
