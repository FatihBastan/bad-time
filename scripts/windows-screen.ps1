# bad-time: prints the primary screen work area as WIDTHxHEIGHT, to center the game window.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$a = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
'{0}x{1}' -f $a.Width, $a.Height
