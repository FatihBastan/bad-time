# bad-time: starts the game browser, keeps it in front, freezes it while you are away,
# and draws the countdown and the NEEDS YOU / DONE banner. Started by hooks/register.ts.
# Inputs come from BADTIME_* environment variables set by the mod.
$ErrorActionPreference = 'Stop'
function Read-Control { try { return [IO.File]::ReadAllText($env:BADTIME_CONTROL).Trim() } catch { return $null } }
$last = Read-Control
$p = Start-Process -FilePath $env:BADTIME_EXE -ArgumentList $env:BADTIME_ARGS -PassThru
[Console]::Out.WriteLine('bad-time-pid ' + $p.Id)
[Console]::Out.Flush()
$claude = $null
try { $claude = Get-Process -Id ([int](Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $PID)).ParentProcessId) } catch { $claude = $null }
try {
  $env:BADTIME_WATCH_LAUNCHER = [string]$PID
  $env:BADTIME_WATCH_BROWSER = [string]$p.Id
  $watchdog = '"' + (Join-Path $PSScriptRoot 'windows-watchdog.ps1') + '"'
  Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -WindowStyle Hidden -ArgumentList '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',$watchdog
} catch { [Console]::Error.WriteLine('bad-time-watchdog ' + $_) }
$ready = $false
try {
  Add-Type -Namespace BadTime -Name Win -MemberDefinition '
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, IntPtr process);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint thread, uint otherThread, bool attach);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr window);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr window);
    [DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(uint access, bool inherit, int id);
    [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
    [DllImport("ntdll.dll")] public static extern int NtSuspendProcess(IntPtr handle);
    [DllImport("ntdll.dll")] public static extern int NtResumeProcess(IntPtr handle);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr window);
    [StructLayout(LayoutKind.Sequential)] public struct FlashInfo { public uint Size; public IntPtr Window; public uint Flags; public uint Count; public uint Timeout; }
    [DllImport("user32.dll")] public static extern bool FlashWindowEx(ref FlashInfo info);
    public static void Flash(IntPtr window) {
      FlashInfo f = new FlashInfo();
      f.Size = (uint)Marshal.SizeOf(typeof(FlashInfo));
      f.Window = window;
      f.Flags = 15;
      FlashWindowEx(ref f);
    }
  '
  $ready = $true
} catch { [Console]::Error.WriteLine('bad-time-win32 ' + $_) }
$script:h = [IntPtr]::Zero
$script:claude = [IntPtr]::Zero
function Find-Game {
  if ($script:h -ne [IntPtr]::Zero -and [BadTime.Win]::IsWindow($script:h)) { return $script:h }
  for ($i = 0; $i -lt 50 -and -not $p.HasExited; $i++) {
    $p.Refresh()
    if ($p.MainWindowHandle -ne [IntPtr]::Zero) { $script:h = $p.MainWindowHandle; return $script:h }
    Start-Sleep -Milliseconds 200
  }
  return [IntPtr]::Zero
}
function Show-Game {
  if (-not $ready) { return }
  $w = Find-Game
  if ($w -eq [IntPtr]::Zero) { return }
  $was = [BadTime.Win]::GetForegroundWindow()
  if ($was -ne [IntPtr]::Zero -and $was -ne $w) { $script:claude = $was }
  $front = [BadTime.Win]::GetWindowThreadProcessId($was, [IntPtr]::Zero)
  $me = [BadTime.Win]::GetCurrentThreadId()
  [void][BadTime.Win]::AttachThreadInput($me, $front, $true)
  [void][BadTime.Win]::ShowWindow($w, 9)
  [void][BadTime.Win]::BringWindowToTop($w)
  [void][BadTime.Win]::SetForegroundWindow($w)
  [void][BadTime.Win]::AttachThreadInput($me, $front, $false)
}
function Flash-Claude {
  if ($ready -and $script:claude -ne [IntPtr]::Zero -and [BadTime.Win]::IsWindow($script:claude)) { [BadTime.Win]::Flash($script:claude) }
}
$script:frozen = $false
$script:frozenIds = @()
function Get-Renderers { @(Get-CimInstance Win32_Process -Filter ('ParentProcessId = ' + $p.Id) | Where-Object { $_.CommandLine -like '*--type=renderer*' } | ForEach-Object { [int]$_.ProcessId }) }
function Set-RendererState($id, $suspend) {
  $hp = [BadTime.Win]::OpenProcess(0x0800, $false, $id)
  if ($hp -eq [IntPtr]::Zero) { return }
  if ($suspend) { [void][BadTime.Win]::NtSuspendProcess($hp) } else { [void][BadTime.Win]::NtResumeProcess($hp) }
  [void][BadTime.Win]::CloseHandle($hp)
}
function Freeze-Game {
  if (-not $ready -or $script:frozen) { return }
  $script:frozenIds = Get-Renderers
  foreach ($id in $script:frozenIds) { Set-RendererState $id $true }
  $script:frozen = $true
}
function Thaw-Game {
  if (-not $script:frozen) { return }
  foreach ($id in $script:frozenIds) { Set-RendererState $id $false }
  $script:frozenIds = @()
  $script:frozen = $false
}
$overlay = $null
$bannerForm = $null
try {
  Add-Type -AssemblyName System.Windows.Forms, System.Drawing
  Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;
namespace BadTime {
  public class Countdown : Form {
    [StructLayout(LayoutKind.Sequential)]
    public struct Rect { public int Left; public int Top; public int Right; public int Bottom; }
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, out Rect rect);
    private Label label;
    private Font font;
    private int side;
    public Countdown() {
      FormBorderStyle = FormBorderStyle.None;
      ShowInTaskbar = false;
      StartPosition = FormStartPosition.Manual;
      BackColor = Color.White;
      Padding = new Padding(4);
      Opacity = 0.9;
      label = new Label();
      label.Dock = DockStyle.Fill;
      label.TextAlign = ContentAlignment.MiddleCenter;
      label.ForeColor = Color.White;
      label.BackColor = Color.Black;
      Controls.Add(label);
    }
    [DllImport("user32.dll")] static extern bool SetLayeredWindowAttributes(IntPtr window, uint key, byte alpha, uint flags);
    protected override void OnHandleCreated(EventArgs e) {
      base.OnHandleCreated(e);
      SetLayeredWindowAttributes(Handle, 0, 235, 2);
    }
    protected override bool ShowWithoutActivation { get { return true; } }
    protected override CreateParams CreateParams {
      get {
        CreateParams cp = base.CreateParams;
        cp.ExStyle |= 0x08000000 | 0x00080000 | 0x00000080 | 0x00000020 | 0x00000008;
        return cp;
      }
    }
    public void ShowOver(IntPtr game, string text) {
      Rect r;
      if (!GetWindowRect(game, out r)) return;
      int w = r.Right - r.Left;
      int h = r.Bottom - r.Top;
      int size = Math.Max(96, Math.Min(w, h) / 4);
      if (size != side) {
        side = size;
        Size = new Size(size, size);
        Font made = new Font("Consolas", size * 0.55f, FontStyle.Bold, GraphicsUnit.Pixel);
        label.Font = made;
        if (font != null) font.Dispose();
        font = made;
      }
      Location = new Point(r.Left + (w - size) / 2, r.Top + (h - size) / 2);
      if (label.Text != text) label.Text = text;
      if (!Visible) Show();
      Refresh();
    }
  }
  public class Banner : Form {
    [StructLayout(LayoutKind.Sequential)]
    public struct Rect { public int Left; public int Top; public int Right; public int Bottom; }
    [StructLayout(LayoutKind.Sequential)]
    public struct Pt { public int X; public int Y; }
    [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr window, ref Pt point);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] static extern bool SetLayeredWindowAttributes(IntPtr window, uint key, byte alpha, uint flags);
    private Label label;
    private Font font;
    private int height;
    public Banner() {
      FormBorderStyle = FormBorderStyle.None;
      ShowInTaskbar = false;
      StartPosition = FormStartPosition.Manual;
      BackColor = Color.White;
      Padding = new Padding(3);
      Opacity = 0.92;
      label = new Label();
      label.Dock = DockStyle.Fill;
      label.TextAlign = ContentAlignment.MiddleCenter;
      label.ForeColor = Color.White;
      label.BackColor = Color.Black;
      Controls.Add(label);
    }
    protected override void OnHandleCreated(EventArgs e) {
      base.OnHandleCreated(e);
      SetLayeredWindowAttributes(Handle, 0, 235, 2);
    }
    protected override bool ShowWithoutActivation { get { return true; } }
    protected override CreateParams CreateParams {
      get {
        CreateParams cp = base.CreateParams;
        cp.ExStyle |= 0x08000000 | 0x00080000 | 0x00000080 | 0x00000020 | 0x00000008;
        return cp;
      }
    }
    public void ShowOver(IntPtr game, bool ask) {
      Rect c;
      if (!GetClientRect(game, out c)) return;
      Pt origin = new Pt();
      if (!ClientToScreen(game, ref origin)) return;
      int w = c.Right - c.Left;
      int h = Math.Max(34, (c.Bottom - c.Top) / 13);
      if (h != height) {
        height = h;
        Font made = new Font("Consolas", h * 0.44f, FontStyle.Bold, GraphicsUnit.Pixel);
        label.Font = made;
        if (font != null) font.Dispose();
        font = made;
      }
      int bw = Math.Min(Math.Max(200, w - 32), Math.Max(200, (int)(h * 0.44f * 0.62f * 16) + 40));
      Size = new Size(bw, h);
      Rect frame;
      int top = origin.Y;
      if (GetWindowRect(game, out frame) && origin.Y - frame.Top < 8) top = origin.Y + GetSystemMetrics(4) + GetSystemMetrics(33) + GetSystemMetrics(92);
      Location = new Point(origin.X + (w - bw) / 2, top + 10);
      string text = ask ? "CLAUDE NEEDS YOU" : "CLAUDE IS DONE";
      if (label.Text != text) label.Text = text;
      if (!Visible) Show();
      Refresh();
    }
  }
}
'@
  $overlay = New-Object BadTime.Countdown
  $bannerForm = New-Object BadTime.Banner
} catch { [Console]::Error.WriteLine('bad-time-countdown ' + $_) }
function Show-Countdown($ms) {
  if ($overlay -eq $null) { return }
  $overlay.ShowOver($script:h, [string][int][Math]::Ceiling($ms / 1000))
  [System.Windows.Forms.Application]::DoEvents()
}
function Show-Banner($ask) {
  if ($bannerForm -eq $null) { return }
  $bannerForm.ShowOver($script:h, $ask)
  [System.Windows.Forms.Application]::DoEvents()
}
function Hide-Banner {
  if ($bannerForm -eq $null -or -not $bannerForm.Visible) { return }
  $bannerForm.Hide()
  [System.Windows.Forms.Application]::DoEvents()
}
function Hide-Countdown {
  if ($overlay -eq $null -or -not $overlay.Visible) { return }
  $overlay.Hide()
  [System.Windows.Forms.Application]::DoEvents()
}
try { Show-Game } catch { [Console]::Error.WriteLine('bad-time-front ' + $_) }
$wasFront = $true
$banner = $null
$resumeAt = $null
$grace = 0
if ($env:BADTIME_RESUME_MS -match '^[0-9]{1,5}$') { $grace = [int]$env:BADTIME_RESUME_MS }
while (-not $p.HasExited) {
  if ($claude -ne $null -and $claude.HasExited) { break }
  if ($resumeAt -ne $null) { Start-Sleep -Milliseconds 50 } else { Start-Sleep -Milliseconds 150 }
  $now = Read-Control
  if ($now -ne $null -and $now -ne $last) {
    $last = $now
    try { if ($now.StartsWith('show')) { $banner = $null; Show-Game } elseif ($now.StartsWith('ask')) { $banner = 'ask'; Flash-Claude } elseif ($now.StartsWith('done')) { $banner = 'done' } } catch { [Console]::Error.WriteLine('bad-time-control ' + $_) }
    [Console]::Out.WriteLine('bad-time-did ' + $now)
    [Console]::Out.Flush()
  }
  try {
    if ($ready -and $script:h -ne [IntPtr]::Zero) {
      $isFront = [BadTime.Win]::GetForegroundWindow() -eq $script:h
      if ($isFront -and -not $wasFront) { $resumeAt = (Get-Date).AddMilliseconds($grace) }
      if (-not $isFront) { $resumeAt = $null; $banner = $null }
      $wasFront = $isFront
      $waiting = $resumeAt -ne $null -and (Get-Date) -lt $resumeAt
      if (-not $isFront -or $waiting) { Freeze-Game } else { $resumeAt = $null; Thaw-Game }
      if ($waiting) { Show-Countdown (($resumeAt - (Get-Date)).TotalMilliseconds) } else { Hide-Countdown }
      if ($banner -ne $null) { Show-Banner ($banner -eq 'ask') } else { Hide-Banner }
    }
  } catch { [Console]::Error.WriteLine('bad-time-freeze ' + $_) }
}
