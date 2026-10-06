# bad-time: plays one of the mod's own chimes (sounds/ask.wav or sounds/done.wav), named in BADTIME_SOUND.
$ErrorActionPreference = 'Stop'
(New-Object System.Media.SoundPlayer $env:BADTIME_SOUND).PlaySync()
