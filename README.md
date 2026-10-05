# bad-time

A Claude Code mod that opens **Bad Time Simulator** in its own window while Claude works, so you can dodge bones instead of watching a spinner.

> Opens [Bad Time Simulator](https://jcw87.github.io/c2-sans-fight/) by Jcw87 in a browser window. Undertale © Toby Fox. Not affiliated with either. This repo contains no game files: the mod only opens that public page.

## What it does

- Once Claude has been working for 2 seconds, a centered game window opens: about 60% of your screen height, in the game's 4:3 shape, and resizable.
- **The fight stays open between prompts.** When Claude finishes, you hear a short chime; keep playing or switch back.
- **When Claude needs you** (a permission prompt or a question), you hear the same chime and the window stays open. Switch to the terminal, answer, and switch back. The mod never answers or changes anything for Claude.
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
| `/badtime now` | Opens the game right away, even when Claude is idle |
| `/badtime close` | Closes the window; it opens again the next time Claude works |
| `/badtime status` | Shows whether it is on, the window, the browser and the URL |

## Settings

Change these in `/config` or with `/plugin configure bad-time@bad-time`.

| Setting | Default | Notes |
| --- | --- | --- |
| `onFinish` | `keep` | `keep` leaves the fight open between prompts; `close` closes it after the countdown |
| `delaySeconds` | 2 | 0 to 30; shorter turns never open the window |
| `countdownSeconds` | 3 | 0 to 10; only used with `close` |
| `sounds` | on | The short chime when Claude needs you or finishes |
| `strayKeyGuard` | on | Holds a prompt sent within 1.5 s of the mod closing the window and puts it back in the box |
| `windowSize` | `auto` | Or `WIDTHxHEIGHT`, such as `900x700`, 320 to 3840 each |
| `browserPath` | empty | Full path to a Chromium-based browser; empty means find one |
| `url` | Bad Time Simulator | Must be `https://`; point it at a mirror if the page goes down |

Invalid values fall back to the default, with one toast naming the setting.

## Safety

- **Hands off Claude.** Every hook passes Claude's events on untouched. The only thing the mod ever holds back is your own prompt, typed within 1.5 s of the mod closing the window (turn it off with `strayKeyGuard`). If the mod fails, Claude carries on as if it were not installed.
- **Its own browser profile.** The game runs in `~/.bad-time/profiles/slot-N`, with no logins, cookies or extensions, separate from your normal browser.
- **Closes only its own windows.** A leftover window from a crashed session is found by that profile folder in its command line, never by a saved process id.
- **Nothing from the repo runs.** Every helper is called by its absolute path, without a shell, from your home folder.

### What it reaches

From `claude plugin validate`:

| Network | Runs processes | Files | Calls a model | Submits prompts |
| --- | --- | --- | --- | --- |
| No (the browser loads the page) | The browser, `ps`/`kill` (`powershell`/`taskkill` on Windows), `osascript` for the screen size on macOS, a sound player on Linux and Windows | Only checks that paths exist | No | No |

Environment variables read: `HOME`, `PATH`, `OS`, `USERPROFILE`, `SystemRoot`, `ProgramFiles`, `ProgramFiles(x86)`, `LOCALAPPDATA`.

## Develop

```
claude plugin validate --strict .
claude plugin test .
```

## License

MIT for this mod's code (see `LICENSE`). The chime in `sounds/` is generated for this mod. Bad Time Simulator is Jcw87's; Undertale and its characters and music are Toby Fox's.
