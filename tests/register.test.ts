import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, ProcessSpawnChunk, ProcessSpawnResult } from 'claude-code'

// A fake machine beneath the plugin: browsers on disk, a process table the
// plugin can list and signal, a screen, and what it shows or plays.

type Os = 'mac' | 'windows' | 'linux'

type Child = { pid: number; argv: readonly string[]; cwd?: string; alive: boolean; exit: () => void }

type World = {
  children: Child[]
  runs: { argv: readonly string[]; cwd?: string }[]
  toasts: string[]
  chimes: number
  fills: string[]
  logs: string[]
  foreign: string[]
  live: () => Child[]
  clock: ReturnType<typeof mock.clock>
}

type Setup = { browsers?: string[]; surfaces?: string[]; store?: Record<string, unknown>; failRegister?: boolean }

const URL_DEFAULT = 'https://jcw87.github.io/c2-sans-fight/'
const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const WIN_CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const T0 = 1_000_000
const HOME: Record<Os, string> = { mac: '/Users/fatih', linux: '/home/fatih', windows: 'C:\\Users\\Fatih Baştan' }
const START = { cwd: '/repo', surface: 'terminal', isInteractive: true } as const

function makeWorld(on: On, os: Os = 'mac', setup: Setup = {}): World {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on, setup.store ?? {})
  mock.env(
    on,
    os === 'windows'
      ? { OS: 'Windows_NT', USERPROFILE: HOME.windows, SystemRoot: 'C:\\Windows', ProgramFiles: 'C:\\Program Files' }
      : { HOME: HOME[os], PATH: 'node_modules/.bin:/usr/bin:/bin' },
  )
  const defaults = os === 'windows' ? [WIN_CHROME] : os === 'mac' ? [MAC_CHROME] : ['/usr/bin/chromium']
  const existing = new Set<string>(setup.browsers ?? defaults)
  for (const p of ['/bin/ps', '/bin/kill', '/usr/bin/osascript', '/usr/bin/paplay']) existing.add(p)
  if (os === 'mac') existing.add('/System/Library/CoreServices/SystemVersion.plist')

  const world: World = {
    children: [],
    runs: [],
    toasts: [],
    chimes: 0,
    fills: [],
    logs: [],
    foreign: [],
    live: () => world.children.filter(c => c.alive),
    clock,
  }
  let nextPid = 500

  // Mods API calls are answered with { value } (or refused with { deny }).
  // On this Linux test host the engine resolves a Windows path against the
  // working folder first, so match on the path's end.
  on('fs.exists', async (_$, e) => ({ value: [...existing].some(p => e.path === p || e.path.endsWith(`/${p}`)) }))
  on('session.surfaces', async () => ({ value: (setup.surfaces ?? ['terminal']) as never }))
  on('command.register', async (_$, e) => {
    if (setup.failRegister === true) throw new Error('boom')
    return { value: { command: e.name } }
  })
  on('ui.toast', async (_$, e) => {
    world.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', async (_$, e) => {
    world.logs.push(e.text)
    return { value: undefined }
  })
  on('audio.play', async () => {
    world.chimes += 1
    return { value: undefined }
  })
  on('prompt.fill', async (_$, e) => {
    world.fills.push(e.text)
    return { isFilled: true }
  })
  on('process.spawn', async function* (_$, e, next): AsyncGenerator<ProcessSpawnChunk, { value: ProcessSpawnResult }> {
    let release = () => {}
    const exited = new Promise<void>(resolve => {
      release = resolve
    })
    const child: Child = { pid: nextPid++, argv: e.argv, cwd: e.cwd, alive: true, exit: () => {} }
    child.exit = () => {
      child.alive = false
      release()
    }
    world.children.push(child)
    const stopped = new Promise<void>(resolve => next.signal.addEventListener('abort', () => resolve()))
    try {
      await Promise.race([exited, stopped])
    } finally {
      child.exit()
    }
    return { value: { code: 0, signal: null } }
  })
  on('process.run', async (_$, e) => {
    world.runs.push({ argv: e.argv, cwd: e.init?.cwd })
    const ok = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    const bin = e.argv[0] ?? ''
    const last = e.argv.at(-1) ?? ''
    if (bin === '/bin/ps' || (bin.endsWith('powershell.exe') && last.includes('Win32_Process'))) {
      const rows = world.live().map(c => `${c.pid} ${c.argv.map(a => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`)
      return ok([...rows, ...world.foreign].join('\n'))
    }
    if (bin === '/bin/kill' || bin.endsWith('taskkill.exe')) {
      const pids = e.argv.filter(a => /^\d+$/.test(a)).map(Number)
      for (const c of world.children) if (pids.includes(c.pid)) c.exit()
      return ok()
    }
    if (bin === '/usr/bin/osascript') return ok('1512x982\n')
    if (bin.endsWith('powershell.exe') && last.includes('PrimaryScreen')) return ok('1920x1040\r\n')
    if (bin.endsWith('powershell.exe') || bin === '/usr/bin/paplay') world.chimes += 1
    return ok()
  })
  // The bottoms of the events the plugin passes on: they stand for the engine.
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('session.end', async (_$, e) => ({ sessionId: e.sessionId }))
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  on('classic.PermissionRequest', async () => ({ decision: { behavior: 'deny', message: 'from-below' } }))
  on('tool.call', { tool: 'AskUserQuestion' }, async () => ({ deny: 'answered-below' }))
  on('prompt.submit', async (_$, e) => ({ text: e.text }))
  return world
}

// The kit's prompt.submit takes no origin; a session stamps the person's
// Enter as `composer`, so the test stamps it the same way.
function typed(text: string) {
  return { text, wait: false, origin: { kind: 'composer' } } as never
}

// What a session passes `command.run` when the person types /badtime <args>.
function badtime(args: string) {
  return { command: 'badtime', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as const
}

function done(turnId: string, isAborted = false) {
  return { answer: 'done', durationMs: 5_000, isAborted, turnId, reason: isAborted ? ('aborted' as const) : ('answer' as const) }
}

function arg(child: Child | undefined, prefix: string): string | undefined {
  return child?.argv.find(a => a.startsWith(prefix))?.slice(prefix.length)
}

async function openGame($: Engine, w: World, turnId = 't1'): Promise<Child> {
  await $.session.start(START)
  await $.turn.start({ text: 'work', turnId })
  await w.clock.advance(3_000)
  const child = w.live()[0]
  if (child === undefined) throw new Error(`the game did not open; the mod logged: ${w.logs.join(' | ') || 'nothing'}; toasts: ${w.toasts.join(' | ') || 'none'}`)
  return child
}

describe('opening', () => {
  test('a turn shorter than the delay never opens the game', async ($, on) => {
    const w = makeWorld(on)
    await $.session.start(START)
    await $.turn.start({ text: 'quick', turnId: 't1' })
    await w.clock.advance(1_000)
    await $.turn.complete(done('t1'))
    await w.clock.advance(10_000)
    expect(w.children.length).toBe(0)
  })

  test('a long turn opens it once, centered, from the home folder', async ($, on) => {
    const w = makeWorld(on)
    await $.session.start(START)
    await $.turn.start({ text: 'work', turnId: 't1' })
    await w.clock.advance(1_900)
    expect(w.children.length).toBe(0)
    await w.clock.advance(1_000)
    expect(w.children.length).toBe(1)
    const child = w.children[0]
    expect(child?.argv[0]).toBe(MAC_CHROME)
    expect(arg(child, '--app=')).toBe(URL_DEFAULT)
    expect(arg(child, '--user-data-dir=')).toBe('/Users/fatih/.bad-time/profiles/slot-1')
    expect(arg(child, '--window-size=')).toBe('812,609')
    expect(arg(child, '--window-position=')).toBe('350,187')
    expect(child?.cwd).toBe('/Users/fatih')
    await w.clock.advance(30_000)
    expect(w.children.length).toBe(1)
  })

  test('by default the window closes a few seconds after Claude answers, and the next prompt opens a fresh one', async ($, on) => {
    const w = makeWorld(on)
    const first = await openGame($, w)
    await $.turn.complete(done('t1'))
    await w.clock.advance(2_000)
    expect(first.alive).toBe(true)
    expect(w.chimes).toBe(1)
    await w.clock.advance(5_000)
    expect(first.alive).toBe(false)
    await $.turn.start({ text: 'next', turnId: 't2' })
    await w.clock.advance(3_000)
    expect(w.live().length).toBe(1)
    expect(w.children.length).toBe(2)
    await $.turn.complete(done('t2'))
    await w.clock.advance(8_000)
    expect(w.live().length).toBe(0)
  })

  test('keep mode: the fight stays open between prompts, with one chime per finished turn', { options: { onFinish: 'keep' } }, async ($, on) => {
    const w = makeWorld(on)
    const child = await openGame($, w)
    await $.turn.complete(done('t1'))
    await w.clock.advance(60_000)
    expect(child.alive).toBe(true)
    expect(w.chimes).toBe(1)
    await $.turn.start({ text: 'more', turnId: 't2' })
    await w.clock.advance(10_000)
    expect(w.children.length).toBe(1)
  })

  test('an interrupted turn does not chime', async ($, on) => {
    const w = makeWorld(on)
    await openGame($, w)
    await $.turn.complete(done('t1', true))
    await w.clock.advance(1_000)
    expect(w.chimes).toBe(0)
  })

  test('a timer from an earlier turn never opens a window', async ($, on) => {
    const w = makeWorld(on)
    await $.session.start(START)
    await $.turn.start({ text: 'one', turnId: 't1' })
    await w.clock.advance(1_900)
    await $.turn.complete(done('t1'))
    await $.turn.start({ text: 'two', turnId: 't2' })
    await w.clock.advance(300)
    expect(w.children.length).toBe(0)
    await w.clock.advance(3_000)
    expect(w.children.length).toBe(1)
  })

  test('a session nobody is drawing for never opens a window', async ($, on) => {
    const w = makeWorld(on, 'mac', { surfaces: [] })
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await $.turn.start({ text: 'work', turnId: 't1' })
    await w.clock.advance(10_000)
    expect(w.children.length).toBe(0)
  })

  test('no browser: one toast, no window', async ($, on) => {
    const w = makeWorld(on, 'mac', { browsers: [] })
    await $.session.start(START)
    for (const id of ['t1', 't2']) {
      await $.turn.start({ text: 'work', turnId: id })
      await w.clock.advance(3_000)
      await $.turn.complete(done(id))
    }
    expect(w.children.length).toBe(0)
    expect(w.toasts.filter(t => t.includes('no Chrome')).length).toBe(1)
  })
})

describe('close mode', () => {
  test('closes after the countdown, and keeps the window if a new turn starts first', { options: { onFinish: 'close', countdownSeconds: 3 } }, async ($, on) => {
    const w = makeWorld(on)
    const child = await openGame($, w)
    await $.turn.complete(done('t1'))
    await w.clock.advance(1_000)
    await $.turn.start({ text: 'again', turnId: 't2' })
    await w.clock.advance(10_000)
    expect(child.alive).toBe(true)
    await $.turn.complete(done('t2'))
    await w.clock.advance(2_900)
    expect(child.alive).toBe(true)
    await w.clock.advance(5_000)
    expect(child.alive).toBe(false)
    expect(w.children.length).toBe(1)
  })

  test('a turn that ends while the window is launching still closes it', { options: { onFinish: 'close' } }, async ($, on) => {
    const w = makeWorld(on)
    await $.session.start(START)
    await $.turn.start({ text: 'work', turnId: 't1' })
    await w.clock.advance(2_000)
    await $.turn.complete(done('t1'))
    await w.clock.advance(10_000)
    expect(w.children.length).toBe(1)
    expect(w.live().length).toBe(0)
  })
})

describe('hands off Claude', () => {
  test('a permission prompt chimes, keeps the window, and passes the decision on untouched', async ($, on) => {
    const w = makeWorld(on)
    const child = await openGame($, w)
    const answer = await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'ls' } })
    expect(answer).toEqual({ decision: { behavior: 'deny', message: 'from-below' } })
    await w.clock.advance(100)
    expect(w.chimes).toBe(1)
    expect(w.toasts.some(t => t.includes('Claude needs you'))).toBe(true)
    expect(child.alive).toBe(true)
  })

  test('a question from Claude chimes and passes through untouched', async ($, on) => {
    const w = makeWorld(on)
    const child = await openGame($, w)
    const answer = await $.tool.call({
      tool: 'AskUserQuestion',
      questions: [{ question: 'Which?', header: 'Pick', options: [{ label: 'A', description: 'a' }, { label: 'B', description: 'b' }], multiSelect: false }],
    } as never)
    expect(answer).toEqual(expect.objectContaining({ deny: 'answered-below' }))
    await w.clock.advance(100)
    expect(w.chimes).toBe(1)
    expect(child.alive).toBe(true)
  })

  test('no alert while no game is open', async ($, on) => {
    const w = makeWorld(on)
    await $.session.start(START)
    await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'ls' } })
    expect(w.chimes).toBe(0)
  })

  test('a failure inside bad-time never blocks the session', async ($, on) => {
    makeWorld(on, 'mac', { failRegister: true })
    const started = await $.session.start(START)
    expect(started).toEqual(expect.objectContaining({ cwd: '/repo' }))
  })

  test('stray-key guard: a typed prompt right after the mod closes the window is held and put back', async ($, on) => {
    const w = makeWorld(on)
    await openGame($, w)
    await $.command.run(badtime('close'))
    const held = await $.prompt.submit(typed('zzzz'))
    expect(held.drop).toContain('held this prompt')
    await w.clock.advance(200)
    expect(w.fills).toEqual(['zzzz'])
    await w.clock.advance(2_000)
    const sent = await $.prompt.submit(typed('real prompt'))
    expect(sent.drop).toBeUndefined()
  })

  test('stray-key guard off: nothing is held', { options: { strayKeyGuard: false } }, async ($, on) => {
    const w = makeWorld(on)
    await openGame($, w)
    await $.command.run(badtime('close'))
    const sent = await $.prompt.submit(typed('zzzz'))
    expect(sent.drop).toBeUndefined()
  })

  test('a prompt from a plugin is never held', async ($, on) => {
    const w = makeWorld(on)
    await openGame($, w)
    await $.command.run(badtime('close'))
    const result = await $.prompt.submit({ text: 'from a plugin', wait: false, origin: { kind: 'plugin', name: 'other' } } as never)
    expect(result.drop).toBeUndefined()
  })
})

describe('slots and leftovers', () => {
  test('a slot another live session holds is skipped', async ($, on) => {
    const w = makeWorld(on, 'mac', { store: { 'slot-1': { owner: 'other', beat: T0 } } })
    const child = await openGame($, w)
    expect(arg(child, '--user-data-dir=')).toBe('/Users/fatih/.bad-time/profiles/slot-2')
  })

  test('all four slots busy: a toast and no window', async ($, on) => {
    const busy = Object.fromEntries([1, 2, 3, 4].map(n => [`slot-${n}`, { owner: `s${n}`, beat: T0 }]))
    const w = makeWorld(on, 'mac', { store: busy })
    await $.session.start(START)
    await $.turn.start({ text: 'work', turnId: 't1' })
    await w.clock.advance(3_000)
    expect(w.children.length).toBe(0)
    expect(w.toasts.some(t => t.includes('all 4'))).toBe(true)
  })

  test('a crashed session\'s window is closed, and nothing else ever is', async ($, on) => {
    const w = makeWorld(on, 'mac', { store: { 'slot-3': { owner: 'crashed', beat: T0 - 10 * 60_000 } } })
    // An orphan from the crashed session, plus look-alikes that are not ours.
    w.children.push({ pid: 41, argv: ['chrome', '--user-data-dir=/Users/fatih/.bad-time/profiles/slot-3'], alive: true, exit: () => {} })
    const orphan = w.children[0]
    if (orphan !== undefined) orphan.exit = () => { orphan.alive = false }
    w.foreign.push(
      '77 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/Users/fatih/Library/Chrome',
      '78 vim notes-about-.bad-time/profiles/slot-3.txt',
      '79 chrome --user-data-dir=/Users/fatih/.bad-time/profiles/slot-31',
    )
    await $.session.start(START)
    await w.clock.advance(5_000)
    expect(orphan?.alive).toBe(false)
    const killed = w.runs.filter(r => r.argv[0] === '/bin/kill').flatMap(r => r.argv.slice(2))
    expect(killed).toContain('41')
    for (const pid of ['77', '78', '79']) expect(killed).not.toContain(pid)
  })

  test('closing the window yourself gives the slot back; the next turn reopens it', async ($, on) => {
    const w = makeWorld(on)
    const first = await openGame($, w)
    first.exit()
    await w.clock.advance(100)
    await $.turn.complete(done('t1'))
    await $.turn.start({ text: 'next', turnId: 't2' })
    await w.clock.advance(3_000)
    expect(w.live().length).toBe(1)
    expect(arg(w.live()[0], '--user-data-dir=')).toBe('/Users/fatih/.bad-time/profiles/slot-1')
  })
})

describe('commands and config', () => {
  test('/badtime off: closes the window and the next turn stays closed', async ($, on) => {
    const w = makeWorld(on)
    const child = await openGame($, w)
    const out = await $.command.run(badtime('off'))
    expect(out.text).toContain('off')
    await w.clock.advance(5_000)
    expect(child.alive).toBe(false)
    await $.turn.complete(done('t1'))
    await $.turn.start({ text: 'next', turnId: 't2' })
    await w.clock.advance(5_000)
    expect(w.children.length).toBe(1)
  })

  test('/badtime now opens it while Claude is idle, once', async ($, on) => {
    const w = makeWorld(on)
    await $.session.start(START)
    await $.command.run(badtime('now'))
    await w.clock.advance(3_000)
    const again = await $.command.run(badtime('now'))
    await w.clock.advance(3_000)
    expect(w.children.length).toBe(1)
    expect(again.text).toContain('already open')
  })

  test('/badtime status reports the state', async ($, on) => {
    const w = makeWorld(on)
    await openGame($, w)
    const out = await $.command.run(badtime('status'))
    expect(out.text).toContain('bad-time is on')
    expect(out.text).toContain('slot 1 of 4')
  })

  for (const url of ['http://example.com/', 'javascript:alert(1)', 'file:///etc/passwd']) {
    test(`a ${url.split(':')[0]} url is refused and the default used`, { options: { url } }, async ($, on) => {
      const w = makeWorld(on)
      const child = await openGame($, w)
      expect(arg(child, '--app=')).toBe(URL_DEFAULT)
      expect(w.toasts.some(t => t.includes('url must be'))).toBe(true)
    })
  }

  test('a bad windowSize falls back to auto; a good one is used and centered', { options: { windowSize: '1000x700' } }, async ($, on) => {
    const w = makeWorld(on)
    const child = await openGame($, w)
    expect(arg(child, '--window-size=')).toBe('1000,700')
    expect(arg(child, '--window-position=')).toBe('256,141')
  })

  test('every helper is an absolute path, run from the home folder', async ($, on) => {
    const w = makeWorld(on)
    await openGame($, w)
    await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'ls' } })
    await $.command.run(badtime('close'))
    await w.clock.advance(5_000)
    expect(w.runs.length).toBeGreaterThan(0)
    for (const r of w.runs) {
      expect(r.argv[0]?.startsWith('/')).toBe(true)
      expect(r.cwd).toBe('/Users/fatih')
    }
  })
})

describe('windows', () => {
  test('uses absolute Windows paths, a quoted-safe profile and a centered window', async ($, on) => {
    const w = makeWorld(on, 'windows')
    const child = await openGame($, w)
    expect(child.argv[0]).toBe(WIN_CHROME)
    expect(arg(child, '--user-data-dir=')).toBe('C:\\Users\\Fatih Baştan\\.bad-time\\profiles\\slot-1')
    expect(arg(child, '--window-size=')).toBe('860,645')
    expect(arg(child, '--window-position=')).toBe('530,198')
    for (const r of w.runs) expect(/^[A-Z]:\\/.test(r.argv[0] ?? '')).toBe(true)
  })

  test('a leftover Windows window is found by its profile and closed with taskkill', async ($, on) => {
    const w = makeWorld(on, 'windows', { store: { 'slot-1': { owner: 'crashed', beat: 0 } } })
    w.foreign.push('90 "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" "--user-data-dir=C:\\Users\\Fatih Baştan\\.bad-time\\profiles\\slot-1"')
    await $.session.start(START)
    await w.clock.advance(5_000)
    const taskkills = w.runs.filter(r => (r.argv[0] ?? '').endsWith('taskkill.exe'))
    expect(taskkills.map(r => r.argv[2])).toContain('90')
    expect(taskkills[0]?.argv[0]).toBe('C:\\Windows\\System32\\taskkill.exe')
  })
})
