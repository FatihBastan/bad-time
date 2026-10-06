# bad-time

A Claude Code mod that opens **Bad Time Simulator** in its own window while Claude works, so you can dodge bones instead of watching a spinner.

> **The game is not mine.** Bad Time Simulator is a free fan game by [Jcw87](https://github.com/Jcw87) ([source](https://github.com/Jcw87/c2-sans-fight)), recreating the Sans fight from [UNDERTALE](https://undertale.com) by Toby Fox. This mod only opens Jcw87's public page in a browser window; it contains no game files, art or music, and is not affiliated with or endorsed by either of them. See [Credits](#credits).

## What it does

- Once Claude has been working for 2 seconds, a centered game window opens: about 60% of your screen height, in the game's 4:3 shape, and resizable.
- **When Claude is done**, you hear the *done* chime, Claude shows "Claude is done.", and on Windows a small white **CLAUDE IS DONE** banner appears across the top of the game. The game stays where it is: minimize it yourself whenever you like. Your next prompt brings the same fight back to the front. Quitting the session closes it.
- **When Claude needs you** (a permission prompt or a question), you hear a different, more urgent *ask* chime, Claude shows a notice, and on Windows a small white **CLAUDE NEEDS YOU** banner appears across the top of the game and Claude's taskbar button flashes. Finish the attack (the FIGHT/ACT/ITEM/MERCY menu waits for you), then switch to Claude and answer. Banners go away once you leave the game. The mod never moves your keyboard focus and never answers or changes anything for Claude.
- **The fight runs only while the game window is in front**: click away and it freezes; click back and it carries on 2.5 seconds later, with a 3-2-1 countdown over the game on Windows.
- Close the window yourself any time; your next prompt starts a new fight.
- Up to 4 Claude sessions can each have their own window.

## Install

Needs Claude Code 2.1.287 or later and Chrome, Edge, Chromium or Brave.

```
/plugin marketplace add FatihBastan/bad-time
/plugin install bad-time@bad-time
```

To try it from a folder without installing:

```
claude --plugin-dir ./bad-time
```

## Use

| Command | What it does |
| --- | --- |
| `/badtime` or `/badtime on` | Turns it on (remembered across sessions) |
| `/badtime off` | Turns it off and closes the window |
| `/badtime now` | Opens the game, or brings a paused one back, even when Claude is idle |
| `/badtime close` | Closes the window; it opens again the next time Claude works |
| `/badtime status` | Shows whether it is on, the window, the browser and the URL |

## Settings

Change these in `/config` or with `/plugin configure bad-time@bad-time`.

| Setting | Default | Notes |
| --- | --- | --- |
| `onFinish` | `pause` | `pause` keeps one fight for the whole session and brings it back to the front on your next prompt (closes instead on Linux, where the fight can't be frozen); `close` closes the window after Claude answers and starts a fresh fight every prompt |
| `delaySeconds` | 2 | 0 to 30; shorter turns never open the window |
| `countdownSeconds` | 3 | 0 to 10; with `close`, seconds between the chime and the window closing |
| `resumeDelaySeconds` | 2.5 | 0 to 10; how long the fight stays frozen after you click back into the game |
| `sounds` | on | The *ask* and *done* chimes |
| `strayKeyGuard` | on | Holds a prompt sent within 1.5 s of the mod closing the window and puts it back in the box |
| `windowSize` | `auto` | Or `WIDTHxHEIGHT`, such as `900x700`, 320 to 3840 each |
| `browserPath` | empty | Full path to a Chromium-based browser; empty means find one |
| `url` | Bad Time Simulator | Must be `https://`; point it at a mirror if the page goes down |

Invalid values fall back to the default, with one toast naming the setting.

On a Mac, quit the game with ⌘Q or `/badtime close`: the red close button leaves the browser running with no window, so the mod can't tell it's gone.

## Safety

- **Hands off Claude.** Every hook passes Claude's events on untouched, and the mod never answers, changes or decides a permission prompt or a question. The only thing it ever holds back is your own prompt, typed within 1.5 s of the mod closing the game window (turn it off with `strayKeyGuard`). If the mod fails, Claude carries on as if it were not installed.
- **Its own browser profile.** The game runs in `~/.bad-time/profiles/slot-N`, with no logins, cookies or extensions, separate from your normal browser.
- **Closes only its own windows.** A leftover game window is found by that profile folder in its command line, never by a saved process id.
- **Readable helpers only.** Every helper is a file in [`scripts/`](scripts), run by its absolute path, without a shell and without inline or encoded code, from your home folder.

## What it runs and sends

### Programs it starts

| Program | When | Why |
| --- | --- | --- |
| Chrome, Edge, Chromium or Brave, found at its usual install path (or `browserPath`) | Claude has worked for 2 s | Shows the game in its own window and profile (`--app`, `--user-data-dir=~/.bad-time/profiles/slot-N`) |
| **Windows:** `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File scripts/windows-launcher.ps1` | With the game | Starts the browser with `Start-Process`; brings the game to the front on your next prompt; freezes the game's own page process (`NtSuspendProcess`) while its window isn't in front and resumes it after the countdown; draws the countdown and the CLAUDE NEEDS YOU / CLAUDE IS DONE banner; flashes Claude's taskbar button when Claude needs you. `Bypass` applies to this one process, so its own files run without changing your machine's policy |
| **Windows:** `scripts/windows-watchdog.ps1`, started hidden by the launcher | With the game | Closes the game window if the launcher is gone (Claude exited) |
| **Windows:** `scripts/windows-processes.ps1`, then `taskkill.exe` | At session start and when closing | Finds game windows left by a crashed session, by their bad-time profile folder, and closes them |
| **Windows:** `scripts/windows-screen.ps1`, `scripts/windows-chime.ps1` | Opening the game; a chime | Reads the screen size to center the window; plays `sounds/ask.wav` or `sounds/done.wav` |
| **macOS:** `/bin/ps`, `/bin/kill` | While the game is open | Finds the game's own processes by their profile folder; `kill -STOP` / `-CONT` freeze and resume the game's page while you're away; `-TERM` / `-KILL` close it |
| **macOS:** `osascript -l JavaScript scripts/mac-front.js`, `mac-screen.js`, `mac-show.js` | Twice a second while the game is open; opening it; your next prompt | Which app is in front; the screen size; bring the game back to the front |
| **Linux:** `ps`, `kill`, `paplay` or `aplay` | As above | Find and close the game; play a chime |

### Network

- **The mod itself makes no network requests.**
- The game browser loads **https://jcw87.github.io/c2-sans-fight/** (Bad Time Simulator on GitHub Pages), or the address in the `url` setting, and whatever that page itself loads. It runs in a fresh profile with no logins or cookies. Nothing about you, your session, your prompts or your code is sent anywhere.

### What it reads and writes

- **Environment variables:** `HOME`, `PATH` (absolute entries only), `OS`, `USERPROFILE`, `SystemRoot`, `ProgramFiles`, `ProgramFiles(x86)`, `LOCALAPPDATA`, only to find your home folder, the browser and system tools.
- **Files:** checks that the browser and helper programs exist; reads its own `scripts/` and `sounds/`. Writes only under `~/.bad-time/`: the browser profiles, and on Windows `control/slot-N.txt`, the switch the launcher reads (`show`, `ask`, `done`).
- **Claude Code's plugin store:** whether bad-time is on, and which of the 4 window slots each session holds.
- It never reads credentials, your code, your prompts or Claude's replies.

### Hooks

| Hook | What it does | Changes the event? |
| --- | --- | --- |
| `session.start` | Registers `/badtime`, closes leftover game windows of crashed sessions | No, returns `next(e)` |
| `turn.start` | Opens the game, or brings it back, once Claude has worked 2 s | No |
| `turn.complete` | Done chime, "Claude is done." notice, banner; in `close` mode closes the window after the countdown | No |
| `classic.PermissionRequest` | Ask chime, "Claude needs you." notice, banner. Never decides the permission | No, always `return next(e)` |
| `tool.call` (AskUserQuestion) | The same alert. Never answers the question | No, always `return next(e)` |
| `prompt.submit` | Stray-key guard: a prompt typed by you within 1.5 s of the mod closing the game window goes back into the prompt box unsent | Only that case; off with `strayKeyGuard` |
| `session.end` | Closes the game | No |
| `command.run` (`badtime`) | Answers its own `/badtime` command | Only its own command |

## Privacy

bad-time collects nothing. It has no server, no analytics and no account. It does not read or send your prompts, code, files or Claude's replies. The only network traffic is the game page loading in its own browser window, from Jcw87's GitHub Pages site (or the `url` you set); that site's own privacy terms apply to that page. Everything the mod stores stays on your computer, under `~/.bad-time/` and in Claude Code's plugin store, and is removed with the plugin and that folder.

## Develop

```
claude plugin validate --strict .
claude plugin test .
```

Support and bug reports: [GitHub Issues](https://github.com/FatihBastan/bad-time/issues).

## Credits

- **Toby Fox** created [UNDERTALE](https://undertale.com): Sans, his fight, and its music, including "MEGALOVANIA", are his. UNDERTALE is a trademark of Toby Fox.
- **[Jcw87](https://github.com/Jcw87)** made [Bad Time Simulator](https://jcw87.github.io/c2-sans-fight/) ([source](https://github.com/Jcw87/c2-sans-fight)), the free browser recreation of the fight that this mod opens.
- This mod only opens that page. If you enjoy the fight, play UNDERTALE.

## License

MIT for this mod's own code and its generated chimes (see `LICENSE`). Bad Time Simulator is Jcw87's; UNDERTALE, its characters and its music are Toby Fox's. This repository contains none of their files.
