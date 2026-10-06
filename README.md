# bad-time

A Claude Code mod that opens **Bad Time Simulator** in its own window while Claude works, so you can dodge bones instead of watching a spinner.

> **The game is not mine.** Bad Time Simulator is a free fan game by [Jcw87](https://github.com/Jcw87) ([source](https://github.com/Jcw87/c2-sans-fight)), recreating the Sans fight from [UNDERTALE](https://undertale.com) by Toby Fox. This mod only opens Jcw87's public page in a browser window; it contains no game files, art or music, and is not affiliated with or endorsed by either of them. See [Credits](#credits).

## What it does

- Once Claude has been working for 2 seconds, a centered game window opens: about 60% of your screen height, in the game's 4:3 shape, and resizable.
- **When Claude answers**, you hear a short chime. Finish the attack; once you leave the game window it goes to the background with the fight paused, and your next prompt brings the same fight back. Quitting the session closes it.
- **When Claude needs you** (a permission prompt or a question), you hear the same chime. Finish the attack (the FIGHT/ACT/ITEM/MERCY menu waits for you), then switch to the terminal and answer. The mod never moves your keyboard focus and never answers or changes anything for Claude.
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
| `onFinish` | `pause` | `pause` sends the window to the background and continues the fight on your next prompt (closes instead on Linux); `close` starts a fresh fight every prompt; `keep` leaves it on screen |
| `delaySeconds` | 2 | 0 to 30; shorter turns never open the window |
| `countdownSeconds` | 3 | 0 to 10; seconds after the chime before the window goes to the background (once you've left it) or closes |
| `resumeDelaySeconds` | 2.5 | 0 to 10; how long the fight stays frozen after you click back into the game |
| `sounds` | on | The short chime when Claude needs you or finishes |
| `strayKeyGuard` | on | Holds a prompt sent within 1.5 s of the mod closing the window and puts it back in the box |
| `windowSize` | `auto` | Or `WIDTHxHEIGHT`, such as `900x700`, 320 to 3840 each |
| `browserPath` | empty | Full path to a Chromium-based browser; empty means find one |
| `url` | Bad Time Simulator | Must be `https://`; point it at a mirror if the page goes down |

Invalid values fall back to the default, with one toast naming the setting.

With `keep` on a Mac, quit the game with ⌘Q or `/badtime close`: the red close button leaves the browser running with no window, so the mod can't tell it's gone.

## Safety

- **Hands off Claude.** Every hook passes Claude's events on untouched. The only thing the mod ever holds back is your own prompt, typed within 1.5 s of the mod closing the window (turn it off with `strayKeyGuard`). If the mod fails, Claude carries on as if it were not installed.
- **Its own browser profile.** The game runs in `~/.bad-time/profiles/slot-N`, with no logins, cookies or extensions, separate from your normal browser.
- **Closes only its own windows.** A leftover window from a crashed session is found by that profile folder in its command line, never by a saved process id.
- **Nothing from the repo runs.** Every helper is called by its absolute path, without a shell, from your home folder.
- **On Windows** the browser is started by a small PowerShell launcher (`Start-Process`, as your own shell would), which also brings the game to the front. Every PowerShell script is sent encoded, and the browser path and arguments go in through environment variables, never spliced into the script.

### What it reaches

From `claude plugin validate`:

| Network | Runs processes | Files | Calls a model | Submits prompts |
| --- | --- | --- | --- | --- |
| No (the browser loads the game page) | The browser; `ps` and `kill` on macOS and Linux (`kill -STOP`/`-CONT` freezes and resumes the game's own page process); `osascript` on macOS for the screen size, to hide and show the game, and twice a second while the game is on screen to see which app is in front; `powershell` and `taskkill` on Windows (the launcher, the screen size, the chime, finding and closing leftover game windows); `paplay` or `aplay` on Linux for the chime | Checks that browser and helper paths exist; on Windows writes `~/.bad-time/control/slot-N.txt`, the show/leave switch the launcher reads. The browser keeps its own profile in `~/.bad-time/profiles/` | No | No |

Environment variables read: `HOME`, `PATH`, `OS`, `USERPROFILE`, `SystemRoot`, `ProgramFiles`, `ProgramFiles(x86)`, `LOCALAPPDATA`.

## Develop

```
claude plugin validate --strict .
claude plugin test .
```

## Credits

- **Toby Fox** created [UNDERTALE](https://undertale.com): Sans, his fight, and its music, including "MEGALOVANIA", are his. UNDERTALE is a trademark of Toby Fox.
- **[Jcw87](https://github.com/Jcw87)** made [Bad Time Simulator](https://jcw87.github.io/c2-sans-fight/) ([source](https://github.com/Jcw87/c2-sans-fight)), the free browser recreation of the fight that this mod opens.
- This mod only opens that page. If you enjoy the fight, play UNDERTALE.

## License

MIT for this mod's own code and its generated chime (see `LICENSE`). Bad Time Simulator is Jcw87's; UNDERTALE, its characters and its music are Toby Fox's. This repository contains none of their files.
