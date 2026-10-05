// bad-time: opens Bad Time Simulator (by Jcw87) in its own browser window while
// Claude works. Not affiliated with UNDERTALE or Toby Fox.
// Every hook passes Claude's events on untouched; the only exception is the
// opt-out stray-key guard on the user's own prompt.

import type {
  EngineInterface,
  HookStream,
  PluginOptions,
  ProcessSpawnChunk,
  ProcessSpawnResult,
  Register,
  Timer,
} from 'claude-code'

type Api = EngineInterface
type Os = 'mac' | 'windows' | 'linux'
type Mode = 'pause' | 'close' | 'keep'

type Config = {
  url: string
  delayMs: number
  mode: Mode
  countdownMs: number
  resumeMs: number
  sounds: boolean
  strayKeyGuard: boolean
  windowSize: string
  browserPath: string
}

type Sys = {
  os: Os
  home: string
  sep: '/' | '\\'
  ps?: string
  kill?: string
  osascript?: string
  player?: string
  powershell?: string
  taskkill?: string
}

type Win = {
  stream: HookStream<ProcessSpawnChunk, ProcessSpawnResult>
  pid?: number
  slot: number
  startedAt: number
  closing: boolean
  ended: boolean
  hidden: boolean
  control?: string
  seq: number
  held?: number[]
  holdWatch?: Timer
  heartbeat?: Timer
}

type SlotRecord = { owner: string; beat: number }

const DEFAULT_URL = 'https://jcw87.github.io/c2-sans-fight/'
const SLOT_COUNT = 4
const HEARTBEAT_MS = 15_000
const STALE_MS = 60_000
const STRAY_MS = 1_500
const CHIME_GAP_MS = 1_500
const QUICK_EXIT_MS = 3_000
const CLOSE_GRACE_MS = 3_000
const SOUND_ASSET = 'sounds/notify.wav'
const USAGE = 'Usage: /badtime [on | off | now | close | status]'

const WINDOWS_LAUNCHER = [
  "$ErrorActionPreference = 'Stop'",
  'function Read-Control { try { return [IO.File]::ReadAllText($env:BADTIME_CONTROL).Trim() } catch { return $null } }',
  '$last = Read-Control',
  '$p = Start-Process -FilePath $env:BADTIME_EXE -ArgumentList $env:BADTIME_ARGS -PassThru',
  "[Console]::Out.WriteLine('bad-time-pid ' + $p.Id)",
  '[Console]::Out.Flush()',
  '$ready = $false',
  'try {',
  "  Add-Type -Namespace BadTime -Name Win -MemberDefinition '",
  '    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
  '    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, IntPtr process);',
  '    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();',
  '    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint thread, uint otherThread, bool attach);',
  '    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window, int command);',
  '    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr window);',
  '    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);',
  '    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr window);',
  '    [DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(uint access, bool inherit, int id);',
  '    [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);',
  '    [DllImport("ntdll.dll")] public static extern int NtSuspendProcess(IntPtr handle);',
  '    [DllImport("ntdll.dll")] public static extern int NtResumeProcess(IntPtr handle);',
  "  '",
  '  $ready = $true',
  "} catch { [Console]::Error.WriteLine('bad-time-win32 ' + $_) }",
  '$script:h = [IntPtr]::Zero',
  'function Find-Game {',
  '  if ($script:h -ne [IntPtr]::Zero -and [BadTime.Win]::IsWindow($script:h)) { return $script:h }',
  '  for ($i = 0; $i -lt 50 -and -not $p.HasExited; $i++) {',
  '    $p.Refresh()',
  '    if ($p.MainWindowHandle -ne [IntPtr]::Zero) { $script:h = $p.MainWindowHandle; return $script:h }',
  '    Start-Sleep -Milliseconds 200',
  '  }',
  '  return [IntPtr]::Zero',
  '}',
  'function Show-Game {',
  '  if (-not $ready) { return }',
  '  $w = Find-Game',
  '  if ($w -eq [IntPtr]::Zero) { return }',
  '  $front = [BadTime.Win]::GetWindowThreadProcessId([BadTime.Win]::GetForegroundWindow(), [IntPtr]::Zero)',
  '  $me = [BadTime.Win]::GetCurrentThreadId()',
  '  [void][BadTime.Win]::AttachThreadInput($me, $front, $true)',
  '  [void][BadTime.Win]::ShowWindow($w, 9)',
  '  [void][BadTime.Win]::BringWindowToTop($w)',
  '  [void][BadTime.Win]::SetForegroundWindow($w)',
  '  [void][BadTime.Win]::AttachThreadInput($me, $front, $false)',
  '}',
  'function Hide-Game {',
  '  if (-not $ready) { return }',
  '  $w = Find-Game',
  '  if ($w -ne [IntPtr]::Zero) { [void][BadTime.Win]::ShowWindow($w, 6) }',
  '}',
  '$script:frozen = $false',
  '$script:frozenIds = @()',
  "function Get-Renderers { @(Get-CimInstance Win32_Process -Filter ('ParentProcessId = ' + $p.Id) | Where-Object { $_.CommandLine -like '*--type=renderer*' } | ForEach-Object { [int]$_.ProcessId }) }",
  'function Set-RendererState($id, $suspend) {',
  '  $hp = [BadTime.Win]::OpenProcess(0x0800, $false, $id)',
  '  if ($hp -eq [IntPtr]::Zero) { return }',
  '  if ($suspend) { [void][BadTime.Win]::NtSuspendProcess($hp) } else { [void][BadTime.Win]::NtResumeProcess($hp) }',
  '  [void][BadTime.Win]::CloseHandle($hp)',
  '}',
  'function Freeze-Game {',
  '  if (-not $ready -or $script:frozen) { return }',
  '  $script:frozenIds = Get-Renderers',
  '  foreach ($id in $script:frozenIds) { Set-RendererState $id $true }',
  '  $script:frozen = $true',
  '}',
  'function Thaw-Game {',
  '  if (-not $script:frozen) { return }',
  '  foreach ($id in $script:frozenIds) { Set-RendererState $id $false }',
  '  $script:frozenIds = @()',
  '  $script:frozen = $false',
  '}',
  "try { Show-Game } catch { [Console]::Error.WriteLine('bad-time-front ' + $_) }",
  '$hold = $false',
  '$wasFront = $true',
  '$resumeAt = $null',
  '$grace = 0',
  'if ($env:BADTIME_RESUME_MS -match \'^[0-9]{1,5}$\') { $grace = [int]$env:BADTIME_RESUME_MS }',
  'while (-not $p.HasExited) {',
  '  Start-Sleep -Milliseconds 150',
  '  $now = Read-Control',
  '  if ($now -ne $null -and $now -ne $last) {',
  '    $last = $now',
  "    try { if ($now.StartsWith('show')) { Show-Game } elseif ($now.StartsWith('hide')) { Hide-Game } elseif ($now.StartsWith('hold')) { $hold = $true } } catch { [Console]::Error.WriteLine('bad-time-control ' + $_) }",
  "    [Console]::Out.WriteLine('bad-time-did ' + $now)",
  '    [Console]::Out.Flush()',
  '  }',
  '  try {',
  '    if ($ready -and $script:h -ne [IntPtr]::Zero) {',
  '      $isFront = [BadTime.Win]::GetForegroundWindow() -eq $script:h',
  '      if ($isFront -and -not $wasFront) { $hold = $false; $resumeAt = (Get-Date).AddMilliseconds($grace) }',
  '      $wasFront = $isFront',
  '      $waiting = $resumeAt -ne $null -and (Get-Date) -lt $resumeAt',
  '      if ($hold -or -not $isFront -or $waiting) { Freeze-Game } else { $resumeAt = $null; Thaw-Game }',
  '    }',
  "  } catch { [Console]::Error.WriteLine('bad-time-freeze ' + $_) }",
  '}',
].join('\n')

const MAC_WINDOW = [
  'function run(argv) {',
  "  ObjC.import('AppKit')",
  '  var app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(Number(argv[1]))',
  "  if (app.isNil()) return 'missing'",
  "  if (argv[0] === 'hide') { app.hide; return 'hidden' }",
  '  app.unhide',
  '  app.activateWithOptions(3)',
  "  return 'shown'",
  '}',
].join('\n')

const INSTANCE = makeId()

let cfg: Config = readConfig({}, [])
let problems: string[] = []
let enabled = true
let turnGen = 0
let activeTurn: string | undefined
let openTimer: Timer | undefined
let countdown: Timer | undefined
let win: Win | undefined
let launching: Promise<void> | undefined
let closedAt = 0
let lastChime = 0
let sysPromise: Promise<Sys | undefined> | undefined
let browserFound: string | undefined
let screenPromise: Promise<{ w: number; h: number } | undefined> | undefined
const warned = new Set<string>()

export const register: Register = (on, options) => {
  problems = []
  cfg = readConfig(options, problems)

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'badtime',
        description: 'Bad Time Simulator while Claude works (on, off, now, close, status)',
        argumentHint: '[on|off|now|close|status]',
        immediate: true,
      })
      enabled = (await $.store.get('enabled')) !== false
      for (const problem of problems) warnOnce($, `config:${problem}`, `${problem}; using the default`)
      void reapStale($)
    } catch (err) {
      debug($, `session.start: ${describe(err)}`)
    }
    return next(e)
  })

  on('command.run', { command: 'badtime' }, async ($, e) => {
    try {
      return { text: await runCommand($, e.args) }
    } catch (err) {
      debug($, `command: ${describe(err)}`)
      return { text: `bad-time: ${describe(err)}` }
    }
  })

  on('turn.start', async ($, e, next) => {
    try {
      turnGen += 1
      activeTurn = e.turnId
      countdown?.cancel()
      countdown = undefined
      openTimer?.cancel()
      openTimer = undefined
      const live = win !== undefined && !win.closing
      if (enabled && (!live || win?.hidden === true)) {
        const gen = turnGen
        openTimer = $.clock.after(Math.max(1, cfg.delayMs), () => {
          openTimer = undefined
          if (gen === turnGen && activeTurn !== undefined) void openForTurn($, gen)
        })
      }
    } catch (err) {
      debug($, `turn.start: ${describe(err)}`)
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    try {
      if (e.agentId === undefined && e.turnId === activeTurn) {
        activeTurn = undefined
        openTimer?.cancel()
        openTimer = undefined
        const isShown = win !== undefined && !win.closing && !win.hidden
        if (isShown && !e.isAborted) void chime($)
        if (cfg.mode !== 'keep' && (isShown || launching !== undefined)) {
          const gen = turnGen
          countdown?.cancel()
          countdown = $.clock.after(Math.max(1, cfg.countdownMs), () => {
            countdown = undefined
            if (gen !== turnGen || activeTurn !== undefined) return
            void (cfg.mode === 'pause' ? pauseWindow($) : closeWindow($, true))
          })
        }
      }
    } catch (err) {
      debug($, `turn.complete: ${describe(err)}`)
    }
    return next(e)
  })

  on('classic.PermissionRequest', async ($, e, next) => {
    try {
      if (win !== undefined && !win.closing && !win.hidden) void needsYou($)
    } catch (err) {
      debug($, `permission alert: ${describe(err)}`)
    }
    return next(e)
  })

  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    try {
      if (win !== undefined && !win.closing && !win.hidden) void needsYou($)
    } catch (err) {
      debug($, `question alert: ${describe(err)}`)
    }
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    try {
      if (
        cfg.strayKeyGuard &&
        closedAt > 0 &&
        e.origin?.kind === 'composer' &&
        (e.attachments === undefined || e.attachments.length === 0) &&
        (await $.clock.now()) - closedAt < STRAY_MS
      ) {
        closedAt = 0
        const text = e.text
        $.clock.after(100, () => void refill($, text))
        return {
          drop: 'bad-time held this prompt: it was sent just as the game window closed. It is back in the prompt box; press Enter to send it.',
        }
      }
    } catch (err) {
      debug($, `stray-key guard: ${describe(err)}`)
    }
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    try {
      if (e.reason !== 'clear' && e.reason !== 'resume') {
        openTimer?.cancel()
        countdown?.cancel()
        const w = win
        if (w !== undefined) {
          w.closing = true
          w.heartbeat?.cancel()
          if (w.pid !== undefined) void endWindowsBrowser($, w.pid)
          stopStream(w)
          void releaseSlot($, w.slot)
        }
      }
    } catch (err) {
      debug($, `session.end: ${describe(err)}`)
    }
    return next(e)
  })
}

async function endWindowsBrowser($: Api, pid: number): Promise<void> {
  const sys = await system($)
  if (sys?.os === 'windows') await windowsClose($, sys, pid, true)
}

async function runCommand($: Api, args: string): Promise<string> {
  const verb = args.trim().toLowerCase() || 'on'
  switch (verb) {
    case 'on': {
      enabled = true
      await $.store.set('enabled', true)
      if (activeTurn !== undefined && win === undefined) void launch($)
      return `bad-time is on. The game opens once Claude has been working for ${seconds(cfg.delayMs)}.`
    }
    case 'off': {
      enabled = false
      await $.store.set('enabled', false)
      openTimer?.cancel()
      openTimer = undefined
      countdown?.cancel()
      countdown = undefined
      void closeWindow($, true)
      return 'bad-time is off. Run /badtime on to turn it back on.'
    }
    case 'now': {
      if (win !== undefined && !win.closing && win.hidden) {
        void resumeWindow($)
        return 'Bringing the game back.'
      }
      if (win !== undefined && !win.closing) return 'The game window is already open.'
      void launch($, true)
      return 'Opening Bad Time Simulator.'
    }
    case 'close': {
      if (win === undefined) return 'No game window is open.'
      void closeWindow($, true)
      return enabled
        ? 'Closed the game window. It opens again the next time Claude works.'
        : 'Closed the game window.'
    }
    case 'status':
      return await statusText($)
    default:
      return USAGE
  }
}

async function statusText($: Api): Promise<string> {
  const sys = await system($)
  const browser = sys === undefined ? undefined : await findBrowser($, sys, false)
  const state = enabled ? 'on' : 'off'
  const mode =
    cfg.mode === 'pause'
      ? `pauses ${seconds(cfg.countdownMs)} after Claude finishes and comes back on your next prompt`
      : cfg.mode === 'close'
        ? `closes ${seconds(cfg.countdownMs)} after Claude finishes`
        : 'stays open between prompts'
  const live = win !== undefined && !win.closing ? win : undefined
  const window = live === undefined ? 'closed' : `${live.hidden ? 'paused in the background' : 'open'} (slot ${live.slot} of ${SLOT_COUNT})`
  return [
    `bad-time is ${state}; the window ${mode}.`,
    `Window: ${window}. Opens after ${seconds(cfg.delayMs)} of work. Chime: ${cfg.sounds ? 'on' : 'off'}.`,
    `Browser: ${browser ?? 'none found (set browserPath)'}.`,
    `Game: ${cfg.url}`,
    'Bad Time Simulator by Jcw87 (github.com/Jcw87/c2-sans-fight), a fan recreation of the Sans fight from UNDERTALE by Toby Fox. Not affiliated with either.',
  ].join('\n')
}

async function openForTurn($: Api, gen: number): Promise<void> {
  for (let i = 0; i < 16 && win !== undefined && win.closing; i += 1) await pause($, 250)
  if (gen !== turnGen || activeTurn === undefined || !enabled) return
  if (win !== undefined && !win.closing && win.hidden) {
    await resumeWindow($)
    return
  }
  await launch($)
}

async function pauseWindow($: Api): Promise<void> {
  if (launching !== undefined) await launching
  const w = win
  if (w === undefined || w.closing || w.hidden) return
  const sys = await system($)
  if (sys === undefined || sys.os === 'linux') {
    await closeWindow($, true)
    return
  }
  w.hidden = true
  closedAt = await $.clock.now()
  if (w.held !== undefined) await releaseHold($, w)
  if (!(await setShown($, sys, w, false))) await closeWindow($, true)
}

async function resumeWindow($: Api): Promise<void> {
  const w = win
  if (w === undefined || w.closing || !w.hidden) return
  const sys = await system($)
  if (sys === undefined) return
  w.hidden = false
  if (!(await setShown($, sys, w, true))) {
    await closeWindow($, false)
    for (let i = 0; i < 16 && win !== undefined; i += 1) await pause($, 250)
    await launch($)
  }
}

async function setShown($: Api, sys: Sys, w: Win, shown: boolean): Promise<boolean> {
  const verb = shown ? 'show' : 'hide'
  try {
    if (sys.os === 'windows') {
      if (w.control === undefined) return false
      w.seq += 1
      await $.fs.write(w.control, `${verb} ${w.seq}`)
      return true
    }
    if (sys.os === 'mac' && sys.osascript !== undefined) {
      const pid = w.pid ?? (await mainPid($, sys, w.slot))
      if (pid === undefined) return false
      w.pid = pid
      const run = await $.process.run([sys.osascript, '-l', 'JavaScript', '-e', MAC_WINDOW, verb, String(pid)], {
        cwd: sys.home,
        timeoutMs: 10_000,
      })
      return run.exitCode === 0 && !run.stdout.includes('missing')
    }
  } catch (err) {
    debug($, `${verb}: ${describe(err)}`)
  }
  return false
}

function launch($: Api, force = false): Promise<void> {
  if (launching !== undefined) return launching
  if (win !== undefined || (!enabled && !force)) return Promise.resolve()
  const run = startWindow($)
    .catch(err => debug($, `launch: ${describe(err)}`))
    .finally(() => {
      launching = undefined
      if (!enabled && !force && win !== undefined) void closeWindow($, true)
    })
  launching = run
  return run
}

async function startWindow($: Api): Promise<void> {
  const surfaces = await $.session.surfaces()
  if (!surfaces.some(s => s === 'terminal' || s === 'desktop')) return
  const sys = await system($)
  if (sys === undefined) {
    warnOnce($, 'system', 'could not tell which system this is, so no game window')
    return
  }
  const browser = await findBrowser($, sys, true)
  if (browser === undefined) {
    warnOnce($, 'browser', 'no Chrome, Edge, Chromium or Brave found; set browserPath in /config')
    return
  }
  const slot = await claimSlot($)
  if (slot === undefined) {
    warnOnce($, 'slots', `all ${SLOT_COUNT} game windows are in use by other Claude sessions`)
    return
  }
  await killSlot($, sys, slot)
  const geo = await geometry($, sys)
  const argv = [
    browser,
    `--app=${cfg.url}`,
    `--user-data-dir=${profileDir(sys, slot)}`,
    `--window-size=${geo.w},${geo.h}`,
    ...(geo.x !== undefined && geo.y !== undefined ? [`--window-position=${geo.x},${geo.y}`] : []),
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-crash-restore-bubble',
    '--disable-extensions',
    '--disable-sync',
    '--disable-hang-monitor',
  ]
  const control = sys.os === 'windows' ? [sys.home, '.bad-time', 'control', `slot-${slot}.txt`].join(sys.sep) : undefined
  if (control !== undefined) await $.fs.write(control, 'show 0')
  const request = sys.os === 'windows' && control !== undefined ? windowsLaunch(sys, argv, control) : { argv, cwd: sys.home }
  if (request === undefined) {
    warnOnce($, 'launcher', 'could not build the Windows launch command; check browserPath in /config')
    await releaseSlot($, slot)
    return
  }
  const w: Win = {
    stream: $.process.spawn(request),
    slot,
    startedAt: await $.clock.now(),
    closing: false,
    ended: false,
    hidden: false,
    control,
    seq: 0,
  }
  win = w
  w.heartbeat = $.clock.every(HEARTBEAT_MS, () => void beat($, slot))
  void watch($, w)
}

async function watch($: Api, w: Win): Promise<void> {
  let failedToStart = false
  let pieces = 0
  let out = ''
  try {
    for await (const chunk of w.stream) {
      pieces += 1
      if (w.pid === undefined && chunk.stream === 'stdout') {
        out = (out + chunk.text).slice(-200)
        const m = /bad-time-pid (\d{1,10})/.exec(out)
        if (m !== null && Number.isSafeInteger(Number(m[1]))) w.pid = Number(m[1])
      }
      if (pieces <= 3) debug($, `browser said: ${chunk.text.slice(0, 200)}`)
    }
  } catch (err) {
    failedToStart = pieces === 0
    debug($, `browser stream: ${describe(err)}`)
  }
  w.ended = true
  w.heartbeat?.cancel()
  if (win === w) win = undefined
  try {
    await releaseSlot($, w.slot)
    const livedMs = (await $.clock.now()) - w.startedAt
    if (failedToStart) warnOnce($, 'start', 'the browser would not start; check browserPath in /config')
    else if (!w.closing && livedMs < QUICK_EXIT_MS) warnOnce($, 'quick', 'the game window closed right after it opened')
  } catch (err) {
    debug($, `after the window closed: ${describe(err)}`)
  }
}

async function closeWindow($: Api, byMod: boolean): Promise<void> {
  if (launching !== undefined) await launching
  const w = win
  if (w === undefined || w.closing) return
  w.closing = true
  if (byMod) closedAt = await $.clock.now()
  const sys = await system($)
  if (sys?.os === 'windows') {
    if (w.pid !== undefined) void windowsClose($, sys, w.pid, false)
  } else {
    stopStream(w)
  }
  $.clock.after(CLOSE_GRACE_MS, () => {
    if (w.ended) return
    void forceClose($, w)
  })
}

async function windowsClose($: Api, sys: Sys, pid: number, force: boolean): Promise<void> {
  try {
    if (sys.taskkill === undefined || !Number.isSafeInteger(pid) || pid <= 1) return
    const args = force ? ['/PID', String(pid), '/T', '/F'] : ['/PID', String(pid), '/T']
    await $.process.run([sys.taskkill, ...args], { cwd: sys.home })
  } catch (err) {
    debug($, `close on Windows: ${describe(err)}`)
  }
}

function windowsLaunch(
  sys: Sys,
  argv: readonly string[],
  control: string,
): { argv: string[]; cwd: string; env: Record<string, string> } | undefined {
  const [exe, ...args] = argv
  if (sys.powershell === undefined || exe === undefined) return undefined
  if ([exe, ...args].some(a => /["\r\n]/.test(a) || a.endsWith('\\'))) return undefined
  const line = args.map(a => (/\s/.test(a) ? `"${a}"` : a)).join(' ')
  return {
    argv: powershellArgv(sys.powershell, WINDOWS_LAUNCHER),
    cwd: sys.home,
    env: { BADTIME_EXE: exe, BADTIME_ARGS: line, BADTIME_CONTROL: control, BADTIME_RESUME_MS: String(cfg.resumeMs) },
  }
}

function stopStream(w: Win): void {
  try {
    void w.stream.return(undefined as unknown as ProcessSpawnResult).catch(() => undefined)
  } catch {}
}

async function forceClose($: Api, w: Win): Promise<void> {
  try {
    const sys = await system($)
    if (sys !== undefined) await killSlot($, sys, w.slot)
    stopStream(w)
  } catch (err) {
    debug($, `force close: ${describe(err)}`)
  }
}

function profileDir(sys: Sys, slot: number): string {
  return [sys.home, '.bad-time', 'profiles', `slot-${slot}`].join(sys.sep)
}

function slotKey(slot: number): string {
  return `slot-${slot}`
}

function isSlotRecord(v: unknown): v is SlotRecord {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return typeof r.owner === 'string' && typeof r.beat === 'number'
}

async function claimSlot($: Api): Promise<number | undefined> {
  for (let slot = 1; slot <= SLOT_COUNT; slot += 1) {
    const key = slotKey(slot)
    const held = await $.store.get(key)
    const now = await $.clock.now()
    if (isSlotRecord(held) && held.owner !== INSTANCE && now - held.beat < STALE_MS) continue
    await $.store.set(key, { owner: INSTANCE, beat: now })
    await pause($, 150)
    const check = await $.store.get(key)
    if (isSlotRecord(check) && check.owner === INSTANCE) return slot
  }
  return undefined
}

async function beat($: Api, slot: number): Promise<void> {
  try {
    const key = slotKey(slot)
    const held = await $.store.get(key)
    if (isSlotRecord(held) && held.owner !== INSTANCE) return
    await $.store.set(key, { owner: INSTANCE, beat: await $.clock.now() })
  } catch (err) {
    debug($, `heartbeat: ${describe(err)}`)
  }
}

async function releaseSlot($: Api, slot: number): Promise<void> {
  try {
    const key = slotKey(slot)
    const held = await $.store.get(key)
    if (isSlotRecord(held) && held.owner === INSTANCE) await $.store.delete(key)
  } catch (err) {
    debug($, `release: ${describe(err)}`)
  }
}

async function reapStale($: Api): Promise<void> {
  try {
    const sys = await system($)
    if (sys === undefined) return
    for (let slot = 1; slot <= SLOT_COUNT; slot += 1) {
      const key = slotKey(slot)
      const held = await $.store.get(key)
      if (!isSlotRecord(held) || held.owner === INSTANCE) continue
      if ((await $.clock.now()) - held.beat < STALE_MS) continue
      await killSlot($, sys, slot)
      const again = await $.store.get(key)
      if (isSlotRecord(again) && again.owner === held.owner && again.beat === held.beat) await $.store.delete(key)
    }
  } catch (err) {
    debug($, `reap: ${describe(err)}`)
  }
}

// Matches only a command line whose --user-data-dir is this slot's profile.
function ownerPattern(slot: number): RegExp {
  return new RegExp(`--user-data-dir="?[^"]*[\\\\/]\\.bad-time[\\\\/]profiles[\\\\/]slot-${slot}(?=["\\s]|$)`)
}

async function ownedPids($: Api, sys: Sys, slot: number): Promise<number[]> {
  const pattern = ownerPattern(slot)
  let listing = ''
  if (sys.os === 'windows') {
    if (sys.powershell === undefined) return []
    const script =
      "[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*bad-time*' } | ForEach-Object { '{0} {1}' -f $_.ProcessId, $_.CommandLine }"
    const run = await $.process.run(powershellArgv(sys.powershell, script), { cwd: sys.home, timeoutMs: 20_000 })
    listing = run.stdout
  } else {
    if (sys.ps === undefined) return []
    const run = await $.process.run([sys.ps, '-A', '-ww', '-o', 'pid=', '-o', 'command='], { cwd: sys.home })
    listing = run.stdout
  }
  const pids: number[] = []
  for (const line of listing.split(/\r?\n/)) {
    const m = /^\s*(\d{1,10})\s+(.*)$/.exec(line)
    if (m === null) continue
    const pid = Number(m[1])
    if (!Number.isSafeInteger(pid) || pid <= 1) continue
    if (pattern.test(m[2] ?? '')) pids.push(pid)
  }
  return pids
}

async function mainPid($: Api, sys: Sys, slot: number): Promise<number | undefined> {
  if (sys.ps === undefined) return undefined
  const pattern = ownerPattern(slot)
  const run = await $.process.run([sys.ps, '-A', '-ww', '-o', 'pid=', '-o', 'command='], { cwd: sys.home })
  for (const line of run.stdout.split(/\r?\n/)) {
    const m = /^\s*(\d{1,10})\s+(.*)$/.exec(line)
    const command = m?.[2] ?? ''
    if (m === null || !pattern.test(command) || command.includes('--type=')) continue
    const pid = Number(m[1])
    if (Number.isSafeInteger(pid) && pid > 1) return pid
  }
  return undefined
}

async function rendererPids($: Api, sys: Sys, slot: number): Promise<number[]> {
  if (sys.ps === undefined) return []
  const pattern = ownerPattern(slot)
  const run = await $.process.run([sys.ps, '-A', '-ww', '-o', 'pid=', '-o', 'command='], { cwd: sys.home })
  const pids: number[] = []
  for (const line of run.stdout.split(/\r?\n/)) {
    const m = /^\s*(\d{1,10})\s+(.*)$/.exec(line)
    const command = m?.[2] ?? ''
    if (m === null || !pattern.test(command) || !command.includes('--type=renderer')) continue
    const pid = Number(m[1])
    if (Number.isSafeInteger(pid) && pid > 1) pids.push(pid)
  }
  return pids
}

async function killSlot($: Api, sys: Sys, slot: number): Promise<void> {
  try {
    const pids = await ownedPids($, sys, slot)
    if (pids.length === 0) return
    debug($, `closing ${pids.length} leftover process(es) of slot ${slot}`)
    if (sys.os === 'windows') {
      if (sys.taskkill === undefined) return
      for (const pid of pids) {
        await $.process.run([sys.taskkill, '/PID', String(pid), '/T', '/F'], { cwd: sys.home }).catch(() => undefined)
      }
      return
    }
    if (sys.kill === undefined) return
    await $.process.run([sys.kill, '-TERM', ...pids.map(String)], { cwd: sys.home }).catch(() => undefined)
    await pause($, 2_000)
    const left = await ownedPids($, sys, slot)
    if (left.length > 0) {
      await $.process.run([sys.kill, '-KILL', ...left.map(String)], { cwd: sys.home }).catch(() => undefined)
    }
  } catch (err) {
    debug($, `close slot ${slot}: ${describe(err)}`)
  }
}

function system($: Api): Promise<Sys | undefined> {
  sysPromise ??= detectSystem($).catch(err => {
    debug($, `system: ${describe(err)}`)
    return undefined
  })
  return sysPromise
}

async function detectSystem($: Api): Promise<Sys | undefined> {
  if ((await $.env.get('OS')) === 'Windows_NT') {
    const home = await $.env.get('USERPROFILE')
    if (home === undefined || !isWindowsAbsolute(home)) return undefined
    const root = await $.env.get('SystemRoot')
    const windowsDir = root !== undefined && isWindowsAbsolute(root) ? trimSep(root) : 'C:\\Windows'
    return {
      os: 'windows',
      home: trimSep(home),
      sep: '\\',
      powershell: `${windowsDir}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,
      taskkill: `${windowsDir}\\System32\\taskkill.exe`,
    }
  }
  const home = await $.env.get('HOME')
  if (home === undefined || !home.startsWith('/')) return undefined
  const os: Os = (await $.fs.exists('/System/Library/CoreServices/SystemVersion.plist')) ? 'mac' : 'linux'
  return {
    os,
    home: trimSep(home),
    sep: '/',
    ps: await firstExisting($, ['/bin/ps', '/usr/bin/ps']),
    kill: await firstExisting($, ['/bin/kill', '/usr/bin/kill']),
    osascript: os === 'mac' ? await firstExisting($, ['/usr/bin/osascript']) : undefined,
    player: os === 'linux' ? await firstExisting($, ['/usr/bin/paplay', '/usr/bin/aplay']) : undefined,
  }
}

async function firstExisting($: Api, paths: readonly string[]): Promise<string | undefined> {
  for (const path of paths) {
    if (await $.fs.exists(path).catch(() => false)) return path
  }
  return undefined
}

async function findBrowser($: Api, sys: Sys, shouldWarn: boolean): Promise<string | undefined> {
  if (cfg.browserPath !== '') {
    const path = cfg.browserPath
    const absolute = sys.os === 'windows' ? isWindowsAbsolute(path) : path.startsWith('/')
    if (absolute && (await $.fs.exists(path).catch(() => false))) return path
    if (shouldWarn) warnOnce($, 'browserPath', 'browserPath must be the full path to an installed browser; looking for one instead')
  }
  if (browserFound !== undefined) return browserFound
  browserFound = await firstExisting($, await browserCandidates($, sys))
  return browserFound
}

async function browserCandidates($: Api, sys: Sys): Promise<string[]> {
  if (sys.os === 'mac') {
    const apps = [
      ['Google Chrome', 'Google Chrome'],
      ['Microsoft Edge', 'Microsoft Edge'],
      ['Chromium', 'Chromium'],
      ['Brave Browser', 'Brave Browser'],
    ]
    return apps.flatMap(([app, binary]) => [
      `/Applications/${app}.app/Contents/MacOS/${binary}`,
      `${sys.home}/Applications/${app}.app/Contents/MacOS/${binary}`,
    ])
  }
  if (sys.os === 'windows') {
    const absolute = (v: string | undefined, fallback: string) =>
      v !== undefined && isWindowsAbsolute(v) ? trimSep(v) : fallback
    const programFiles = absolute(await $.env.get('ProgramFiles'), 'C:\\Program Files')
    const programFiles86 = absolute(await $.env.get('ProgramFiles(x86)'), 'C:\\Program Files (x86)')
    const localAppData = await $.env.get('LOCALAPPDATA')
    const list = [
      `${programFiles}\\Google\\Chrome\\Application\\chrome.exe`,
      `${programFiles86}\\Google\\Chrome\\Application\\chrome.exe`,
      `${programFiles86}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${programFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${programFiles}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
    ]
    if (localAppData !== undefined && isWindowsAbsolute(localAppData)) {
      list.splice(2, 0, `${trimSep(localAppData)}\\Google\\Chrome\\Application\\chrome.exe`)
    }
    return list
  }
  const names = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'brave-browser']
  const fixed = ['/usr/bin', '/usr/local/bin', '/snap/bin']
  // PATH entries are used only when absolute: a relative one could point
  // into the repo Claude is working in.
  const fromPath = ((await $.env.get('PATH')) ?? '').split(':').filter(dir => dir.startsWith('/'))
  const dirs = [...new Set([...fixed, ...fromPath])]
  return names.flatMap(name => dirs.map(dir => `${trimSep(dir)}/${name}`))
}

async function geometry($: Api, sys: Sys): Promise<{ w: number; h: number; x?: number; y?: number }> {
  const fixed = parseSize(cfg.windowSize)
  const screen = await screenSize($, sys)
  if (fixed !== undefined) {
    if (screen === undefined) return fixed
    return { ...fixed, ...centered(screen, fixed) }
  }
  if (screen === undefined) return { w: 860, h: 700 }
  let h = Math.round(screen.h * 0.62)
  let w = Math.round(h * (4 / 3))
  w = clamp(w, 640, Math.max(640, Math.round(screen.w * 0.8)))
  h = clamp(h, 520, Math.max(520, Math.round(screen.h * 0.85)))
  return { w, h, ...centered(screen, { w, h }) }
}

function centered(screen: { w: number; h: number }, size: { w: number; h: number }): { x: number; y: number } {
  return { x: Math.max(0, Math.round((screen.w - size.w) / 2)), y: Math.max(0, Math.round((screen.h - size.h) / 2)) }
}

function screenSize($: Api, sys: Sys): Promise<{ w: number; h: number } | undefined> {
  screenPromise ??= readScreen($, sys).catch(err => {
    debug($, `screen size: ${describe(err)}`)
    return undefined
  })
  return screenPromise
}

async function readScreen($: Api, sys: Sys): Promise<{ w: number; h: number } | undefined> {
  let out = ''
  if (sys.os === 'mac' && sys.osascript !== undefined) {
    const script =
      "ObjC.import('AppKit'); var f = $.NSScreen.mainScreen.frame.size; Math.round(f.width) + 'x' + Math.round(f.height)"
    out = (await $.process.run([sys.osascript, '-l', 'JavaScript', '-e', script], { cwd: sys.home, timeoutMs: 10_000 })).stdout
  } else if (sys.os === 'windows' && sys.powershell !== undefined) {
    const script =
      "Add-Type -AssemblyName System.Windows.Forms; $a = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea; '{0}x{1}' -f $a.Width, $a.Height"
    out = (await $.process.run(powershellArgv(sys.powershell, script), { cwd: sys.home, timeoutMs: 15_000 })).stdout
  } else {
    return undefined
  }
  const m = /(\d{3,5})x(\d{3,5})/.exec(out)
  if (m === null) return undefined
  const w = Number(m[1])
  const h = Number(m[2])
  return w >= 640 && h >= 480 ? { w, h } : undefined
}

async function needsYou($: Api): Promise<void> {
  try {
    $.ui.toast(`Claude needs you: the fight is frozen. Answer in the terminal, then click the game; it resumes ${seconds(cfg.resumeMs)} later.`, { timeoutMs: 8_000 })
  } catch {}
  void holdGame($)
  await chime($)
}

async function holdGame($: Api): Promise<void> {
  try {
    const w = win
    if (w === undefined || w.closing || w.hidden || w.held !== undefined) return
    const sys = await system($)
    if (sys === undefined) return
    if (sys.os === 'windows') {
      if (w.control === undefined) return
      w.seq += 1
      await $.fs.write(w.control, `hold ${w.seq}`)
      return
    }
    if (sys.os !== 'mac' || sys.kill === undefined || sys.osascript === undefined) return
    const main = w.pid ?? (await mainPid($, sys, w.slot))
    const renderers = await rendererPids($, sys, w.slot)
    if (main === undefined || renderers.length === 0) return
    w.pid = main
    await $.process.run([sys.kill, '-STOP', ...renderers.map(String)], { cwd: sys.home })
    w.held = renderers
    let left = false
    let backSince: number | undefined
    w.holdWatch = $.clock.every(500, () => {
      void (async () => {
        if (w.held === undefined || w.ended || w.closing) {
          w.holdWatch?.cancel()
          return
        }
        const front = await frontPid($, sys)
        if (front === undefined) return
        if (front !== main) {
          left = true
          backSince = undefined
          return
        }
        if (!left) return
        const now = await $.clock.now()
        backSince ??= now
        if (now - backSince >= cfg.resumeMs) await releaseHold($, w)
      })()
    })
  } catch (err) {
    debug($, `hold: ${describe(err)}`)
  }
}

async function releaseHold($: Api, w: Win): Promise<void> {
  const held = w.held
  w.held = undefined
  w.holdWatch?.cancel()
  w.holdWatch = undefined
  if (held === undefined) return
  try {
    const sys = await system($)
    if (sys?.kill !== undefined) await $.process.run([sys.kill, '-CONT', ...held.map(String)], { cwd: sys.home })
  } catch (err) {
    debug($, `release: ${describe(err)}`)
  }
}

async function frontPid($: Api, sys: Sys): Promise<number | undefined> {
  if (sys.osascript === undefined) return undefined
  const script = "ObjC.import('AppKit'); $.NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier"
  const run = await $.process.run([sys.osascript, '-l', 'JavaScript', '-e', script], { cwd: sys.home, timeoutMs: 5_000 })
  const pid = Number(run.stdout.trim())
  return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined
}

async function chime($: Api): Promise<void> {
  try {
    if (!cfg.sounds) return
    const now = await $.clock.now()
    if (now - lastChime < CHIME_GAP_MS) return
    lastChime = now
    const sys = await system($)
    if (sys === undefined) return
    if (sys.os === 'mac') {
      await $.audio.play({ asset: SOUND_ASSET })
      return
    }
    const file = [$.plugin.root, 'sounds', 'notify.wav'].join(sys.sep)
    if (sys.os === 'windows' && sys.powershell !== undefined) {
      const script = '(New-Object System.Media.SoundPlayer $env:BADTIME_SOUND).PlaySync()'
      await $.process.run(powershellArgv(sys.powershell, script), { cwd: sys.home, timeoutMs: 10_000, env: { BADTIME_SOUND: file } })
    } else if (sys.player !== undefined) {
      await $.process.run([sys.player, file], { cwd: sys.home, timeoutMs: 10_000 })
    }
  } catch (err) {
    debug($, `chime: ${describe(err)}`)
  }
}

async function refill($: Api, text: string): Promise<void> {
  try {
    await $.prompt.fill({ text })
  } catch (err) {
    debug($, `refill: ${describe(err)}`)
  }
}

function readConfig(o: PluginOptions, out: string[]): Config {
  const str = (key: string, fallback: string): string => {
    const v = o[key]
    return typeof v === 'string' ? v.trim() : fallback
  }
  const num = (key: string, fallback: number, lo: number, hi: number): number => {
    const v = o[key]
    if (typeof v !== 'number' || !Number.isFinite(v)) return fallback
    if (v < lo || v > hi) {
      out.push(`${key} must be ${lo} to ${hi}`)
      return fallback
    }
    return v
  }
  const bool = (key: string, fallback: boolean): boolean => {
    const v = o[key]
    return typeof v === 'boolean' ? v : fallback
  }

  let url = DEFAULT_URL
  const rawUrl = str('url', DEFAULT_URL) || DEFAULT_URL
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '') throw new Error('not https')
    url = parsed.href
  } catch {
    out.push('url must be an https:// address')
  }

  let windowSize = (str('windowSize', 'auto') || 'auto').toLowerCase()
  if (windowSize !== 'auto' && parseSize(windowSize) === undefined) {
    out.push('windowSize must be auto or WIDTHxHEIGHT, 320 to 3840 each')
    windowSize = 'auto'
  }

  return {
    url,
    delayMs: Math.round(num('delaySeconds', 2, 0, 30) * 1000),
    mode: readMode(str('onFinish', 'pause')),
    countdownMs: Math.round(num('countdownSeconds', 3, 0, 10) * 1000),
    resumeMs: Math.round(num('resumeDelaySeconds', 2.5, 0, 10) * 1000),
    sounds: bool('sounds', true),
    strayKeyGuard: bool('strayKeyGuard', true),
    windowSize,
    browserPath: str('browserPath', ''),
  }
}

function readMode(value: string): Mode {
  return value === 'close' || value === 'keep' ? value : 'pause'
}

function parseSize(text: string): { w: number; h: number } | undefined {
  const m = /^(\d{3,4})x(\d{3,4})$/.exec(text)
  if (m === null) return undefined
  const w = Number(m[1])
  const h = Number(m[2])
  return w >= 320 && w <= 3840 && h >= 320 && h <= 3840 ? { w, h } : undefined
}

function pause($: Api, ms: number): Promise<void> {
  return new Promise(resolve => {
    $.clock.after(ms, () => resolve())
  })
}

function warnOnce($: Api, key: string, text: string): void {
  if (warned.has(key)) return
  warned.add(key)
  try {
    $.ui.toast(text, { timeoutMs: 8_000 })
  } catch {}
  debug($, text)
}

function debug($: Api, text: string): void {
  try {
    $.ui.log(`bad-time: ${text}`, { to: 'debug' })
  } catch {}
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function seconds(ms: number): string {
  const s = ms / 1000
  return `${s} ${s === 1 ? 'second' : 'seconds'}`
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

function isWindowsAbsolute(path: string): boolean {
  return /^[A-Za-z]:\\[^"<>|?*]*$/.test(path)
}

function trimSep(path: string): string {
  return path.length > 1 ? path.replace(/[\\/]+$/, '') : path
}

function powershellArgv(powershell: string, script: string): string[] {
  return [powershell, '-NoProfile', '-NonInteractive', '-EncodedCommand', utf16Base64(script)]
}

function utf16Base64(text: string): string {
  const bytes: number[] = []
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i)
    bytes.push(unit & 0xff, unit >> 8)
  }
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0)
    out += alphabet.charAt((n >> 18) & 63) + alphabet.charAt((n >> 12) & 63)
    out += b === undefined ? '=' : alphabet.charAt((n >> 6) & 63)
    out += c === undefined ? '=' : alphabet.charAt(n & 63)
  }
  return out
}

function makeId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  }
}
