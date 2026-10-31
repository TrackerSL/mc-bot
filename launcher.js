#!/usr/bin/env node
'use strict'
// mc-launcher — a full cracked (offline-mode) Minecraft launcher in Node.js.
// It launches the REAL vanilla client: same bytes, same timings, same
// brand — indistinguishable from any other player on an offline server.
//
//   node launcher.js install 1.20.4 [--dir <gameDir>] [--no-assets] [--no-runtime]
//   node launcher.js install-java 1.20.4 [--dir <gameDir>]
//   node launcher.js launch --user <name> [--ver 1.20.4] [--dir <gameDir>]
//                      [--join host:port] [--java <path>] [--memory 2G] [--dry-run]
//   node launcher.js cmd      ... same flags as launch, prints the command
//   node launcher.js accounts [--user <name>]   (list; add with --user)
//   node launcher.js rm-user <name>
//   node launcher.js versions [--dir <gameDir>]
const fs = require('fs')
const path = require('path')
const os = require('os')
const { offlineUuid } = require('./lib/uuid')
const { buildLaunch, spawnGame, quote } = require('./lib/launch')
const { install, installRuntime } = require('./lib/install')

function defaultGameDir () {
  if (process.env.APPDATA) return path.join(process.env.APPDATA, '.minecraft')
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'minecraft')
  return path.join(os.homedir(), '.minecraft')
}

function parseFlags (argv) {
  const flags = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) flags[key] = true
      else { flags[key] = next; i++ }
    } else flags._.push(a)
  }
  return flags
}

const accountsFile = path.join(__dirname, 'accounts.json')
function loadAccounts () {
  try { return JSON.parse(fs.readFileSync(accountsFile, 'utf8')) } catch { return { users: [] } }
}
function saveAccounts (a) { fs.writeFileSync(accountsFile, JSON.stringify(a, null, 2)) }

async function main () {
  const [cmd, ...rest] = process.argv.slice(2)
  const f = parseFlags(rest)
  const dir = path.resolve(f.dir || defaultGameDir())

  if (cmd === 'install') {
    const ver = f._[0] || '1.20.4'
    await install(dir, ver, { skipAssets: !!f['no-assets'], skipRuntime: !!f['no-runtime'] })
    return
  }

  if (cmd === 'install-java') {
    const ver = f._[0] || '1.20.4'
    const { loadVersion } = require('./lib/version')
    const v = loadVersion(dir, ver)
    const comp = v.javaVersion && v.javaVersion.component
    if (!comp) { console.log('this profile has no javaVersion requirement'); return }
    const p = await installRuntime(dir, comp)
    console.log(`[java] ready: ${path.join(p, 'bin')}`)
    return
  }

  if (cmd === 'versions') {
    const vdir = path.join(dir, 'versions')
    const list = fs.existsSync(vdir) ? fs.readdirSync(vdir).filter(d => fs.existsSync(path.join(vdir, d, `${d}.json`))) : []
    if (!list.length) console.log(`no versions in ${vdir} — run: node launcher.js install 1.20.4 --dir "${dir}"`)
    for (const v of list) console.log(' ', v)
    return
  }

  if (cmd === 'accounts') {
    const acc = loadAccounts()
    if (f.user) {
      const u = String(f.user)
      if (!u.length || u.length > 16 || !/^[a-zA-Z0-9_]+$/.test(u)) throw new Error('invalid Minecraft username (3-16 of a-zA-Z0-9_)')
      if (!acc.users.find(x => x.name === u)) acc.users.push({ name: u, uuid: offlineUuid(u), addedAt: new Date().toISOString() })
      saveAccounts(acc)
      console.log(`added ${u} -> ${offlineUuid(u)}`)
    }
    if (!acc.users.length) console.log('no accounts — add one: node launcher.js accounts --user YourName')
    for (const u of acc.users) console.log(`  ${u.name}  ${u.uuid}`)
    return
  }

  if (cmd === 'rm-user') {
    const acc = loadAccounts()
    acc.users = acc.users.filter(x => x.name !== f._[0])
    saveAccounts(acc)
    console.log('removed', f._[0])
    return
  }

  if (cmd === 'launch' || cmd === 'cmd') {
    const ver = f.ver || f.version || '1.20.4'
    let user = f.user || f.name
    if (!user) {
      const acc = loadAccounts()
      if (acc.users.length === 1) user = acc.users[0].name
      else if (acc.users.length > 1) throw new Error(`pick an account: ${acc.users.map(u => u.name).join(', ')}`)
      else throw new Error('no user — run: node launcher.js accounts --user YourName')
    }
    const built = buildLaunch(dir, {
      user, version: ver, join: f.join || null, world: f.world || null,
      java: typeof f.java === 'string' ? f.java : undefined,
      memory: typeof f.memory === 'string' ? f.memory : undefined,
      width: typeof f.width === 'string' ? f.width : undefined,
      height: typeof f.height === 'string' ? f.height : undefined
    })
    const pretty = built.command.map(quote).join(' ')
    if (cmd === 'cmd' || f['dry-run']) {
      console.log(pretty)
      return
    }
    // headless server support: virtual display + Mesa software GL
    let xvfb = null
    const wantXvfb = process.platform === 'linux' && !f['no-xvfb']
    if (wantXvfb && !process.env.DISPLAY) {
      const { ensureDisplay } = require('./lib/headless')
      xvfb = await ensureDisplay()
      console.log(`[launch] headless server — virtual display ${xvfb.display} (Xvfb + Mesa llvmpipe)`)
    }
    const env = {}
    if (xvfb) {
      env.DISPLAY = xvfb.display
      env.LIBGL_ALWAYS_SOFTWARE = '1' // force Mesa software GL — no GPU on servers
    }
    console.log(`[launch] ${user} (${built.uuid}) — MC ${ver} — java: ${built.java}`)
    if (f.join) console.log(`[launch] quick-joining ${f.join}`)
    const detach = !!f.detach
    if (detach) {
      const child = spawnGame(built.command, {
        gameDir: dir, env: Object.keys(env).length ? env : null,
        detached: true, stdio: 'ignore'
      })
      child.on('error', e => { console.error('spawn failed:', e.message); process.exit(1) })
      console.log(`[launch] detached (game pid ${child.pid}) — logs: ${dir}/logs/latest.log`)
      return
    }
    // foreground: raw game stdout -> file (it's log4j XML, useless in a
    // terminal); stream the game's plain-text latest.log here instead —
    // exactly what you'd tail on a server
    fs.mkdirSync(path.join(dir, 'logs'), { recursive: true })
    const outFd = fs.openSync(path.join(dir, 'logs', 'game-stdout.log'), 'a')
    const child = spawnGame(built.command, {
      gameDir: dir, env: Object.keys(env).length ? env : null,
      detached: false, stdio: ['ignore', outFd, outFd]
    })
    child.on('error', e => { console.error('spawn failed:', e.message); process.exit(1) })
    console.log(`[launch] game pid ${child.pid}`)
    const latest = path.join(dir, 'logs', 'latest.log')
    let pos = 0
    const tail = setInterval(() => {
      try {
        const st = fs.statSync(latest)
        if (st.size < pos) pos = 0 // log recreated on boot
        if (st.size > pos) {
          const b = Buffer.alloc(st.size - pos)
          const fh = fs.openSync(latest, 'r')
          fs.readSync(fh, b, 0, b.length, pos)
          fs.closeSync(fh)
          pos = st.size
          process.stdout.write(b)
        }
      } catch {}
    }, 400)
    child.on('exit', (code, sig) => {
      clearInterval(tail)
      try { fs.closeSync(outFd) } catch {}
      if (xvfb) xvfb.stop()
      console.log(`[launch] game exited (${sig || 'code ' + code})`)
      process.exit(sig ? 130 : (code || 0))
    })
    return
  }

  console.log(`mc-launcher — offline-mode vanilla launcher (Node.js)

commands:
  install <version>          download client, libraries, assets, JRE
  install-java <version>     just the exact Mojang JRE for the profile
  launch --user <name>       start the real vanilla game
      [--ver 1.20.4] [--dir <gameDir>] [--join host:port]
      [--java <path>] [--memory 2G] [--dry-run]
      [--detach]              background the game, return to prompt
      [--no-xvfb]             never use a virtual display
  cmd                        print the launch command instead of running
  accounts [--user <name>]   list / add offline accounts
  rm-user <name>
  versions                   list installed versions

default game dir: ${defaultGameDir()}`)
}

main().catch(e => { console.error('error:', e.message); process.exit(1) })
