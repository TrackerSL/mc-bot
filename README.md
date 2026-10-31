# mc-arena-bot

Headless vanilla Minecraft bot — one command to start.
Runs the **real** vanilla client (no hijacked clients, no bots-as-libraries),
logs itself in, runs your command queue, then gives you a live terminal
to send anything you type straight into the game.

## Quick start

```bash
cp .env.example .env    # then edit it (player, server, password)
npm start               # that's it — single command
```

First run downloads the game + Java one time (~1 GB, only once).
Linux with `xdotool` + `Xvfb` is used automatically when there is no display.
Works on **Windows** too (types into the game window with PowerShell — nothing extra to install).

### Windows notes
- the game window must be open and on the current desktop (the bot brings it
  to the front when it types — don't grab the mouse/keyboard right then)
- if the download is interrupted (network reset), it resumes where it left off —
  just run `npm start` again; already-downloaded files are never re-downloaded
- a stray console window will not appear (the game runs hidden-console)

## `.env` — everything lives here

| key            | what it does                                                        |
|----------------|---------------------------------------------------------------------|
| `PLAYER_NAME`  | the Minecraft player name (offline/cracked servers)                 |
| `SERVER_IP`    | server address                                                       |
| `SERVER_PORT`  | server port (default 25565)                                          |
| `PASSWORD`     | server password — used by the bot itself                             |
| `AUTH`         | `on` = bot sends `/login` + `/register` automatically · `off` = skip |
| `CMD_DELAY_MS` | ms to wait **before every command, including the first** (5000 = 5s) |
| `CMDS`         | commands run once you're in, comma separated — e.g. `/lifesteal,/afk` |

`/register` and `/login` are **built into the bot** — they never appear in
`CMDS`. Only gameplay commands go there.

## Terminal

Once running, type anything and press enter:

```
> /lifesteal          -> sent to the game (after the 5s delay)
> hello &c&lred text  -> sent as chat, colors work
> :help               -> help
> :queue              -> queue status
> :quit               -> stop the bot
```

Every command — terminal, queue, even login — waits `CMD_DELAY_MS`
before it is sent, and commands go out one at a time.

## What the bot handles for you

- installs the game + Java on first run
- connects to the server and waits through verify gates
- auto `/login` (and `/register` the first time) when `AUTH=on`
- re-runs `CMDS` after every reconnect
- reconnects by itself on connection loss / verify resets
- backs off (30s) if the server keeps rejecting the session

## Bare-bones by design

No settings to learn: `.env` has 7 lines. Everything else
(version, memory, game folder) uses sensible defaults.
`GAME_DIR`, `MC_VERSION`, `MC_MEMORY` env vars exist if you ever need them.
