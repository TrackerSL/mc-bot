# types one line into the Minecraft window — Windows version of xdotool.
# text arrives on STDIN (no command-line parsing quirks at all).
$ErrorActionPreference = 'Stop'
try {
  $Text = [Console]::In.ReadToEnd() -replace '[\r\n]+', ' '
  Add-Type -AssemblyName System.Windows.Forms
  $w = New-Object -ComObject WScript.Shell
  if (-not $w.AppActivate('Minecraft')) {
    Start-Sleep -Milliseconds 400
    if (-not $w.AppActivate('Minecraft')) { exit 3 }  # game window not found
  }
  Start-Sleep -Milliseconds 650
  $e = $Text -replace '([+^%~()])', '{$1}'            # escape SendKeys specials
  [System.Windows.Forms.SendKeys]::SendWait($e)
  Start-Sleep -Milliseconds 450
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  exit 0
} catch {
  exit 4
}
