'use strict'
// the real vanilla client: installed, launched headless (Xvfb), watched,
// auto-restarted on verify-pass / connection loss
const fs = require('fs')
const path = require('path')
const { spawn, spawnSync } = require('child_process')
const { sleep } = require('./sender')

const MARKERS = {
  verifyText: /Verifying your connection/,
  verifyPass: /Your connection was verified successfully/,
  authPrompt: /please complete authentication|Command: \/login/,
  loggedIn: /login was successful/,
  disconnect: /Connection reset by peer|Connection Lost|Internal Exception: io\.netty/,
  kicked: /Client disconnected with reason/
}

class Game {
  constructor (cfg, log) {
    this.cfg = cfg
    this.log = log
    this.display = null
    this.javaPid = null
    this.child = null
    this.watchTimer = null
    this.pos = 0
    this.handlers = {}
  }

  on (ev, fn) { this.handlers[ev] = fn; return this }
  _emit (ev, data) { if (this.handlers[ev]) this.handlers[ev](data) }

  get logFile () { return path.join(this.cfg.gameDir, 'logs', 'latest.log') }

  async ensureInstalled () {
    const versions = path.join(this.cfg.gameDir, 'versions', this.cfg.version)
    // completion marker — the versions folder alone does NOT mean the
    // install finished (it can die halfway through the asset downloads)
    const marker = path.join(this.cfg.gameDir, `.installed-${this.cfg.version}`)
    if (!fs.existsSync(marker)) {
      const partial = fs.existsSync(versions)
      this.log(partial
        ? 'finishing interrupted setup — resuming downloads...'
        : `first run — downloading Minecraft ${this.cfg.version} + java (one time, takes a while)...`)
      // network hiccups (ECONNRESET etc.) happen — every retry resumes,
      // files already on disk are skipped, so nothing is re-downloaded
      for (let attempt = 1; attempt <= 5; attempt++) {
        const r = spawnSync(process.execPath, [this.cfg.launcher, 'install', this.cfg.version,
          '--dir', this.cfg.gameDir], { stdio: 'inherit' })
        if (r.status === 0) {
          fs.writeFileSync(marker, new Date().toISOString())
          break
        }
        if (attempt === 5) throw new Error('install failed after 5 attempts — check your internet connection, then just run npm start again')
        this.log(`download interrupted — resuming in 5s (attempt ${attempt + 1}/5, no re-download)`)
        await sleep(5000)
      }
    }
    // make sure the player name exists as an offline account
    spawnSync(process.execPath, [this.cfg.launcher, 'accounts', '--user', this.cfg.playerName],
      { stdio: 'ignore' })
  }

  async start () {
    await this.stop()
    // fresh log file so the watcher only sees this session
    try { fs.rmSync(this.logFile, { force: true }) } catch {}

    const isWin = process.platform === 'win32'
    // windows: run the launcher attached (no --detach) so the game's stdout
    // and exit code are captured — when the client dies we can see WHY
    const args = [this.cfg.launcher, 'launch',
      '--user', this.cfg.playerName,
      '--dir', this.cfg.gameDir,
      '--join', `${this.cfg.serverIp}:${this.cfg.serverPort}`,
      '--memory', this.cfg.memory]
    if (!isWin) args.push('--detach')
    if (this.cfg.version !== '1.20.4') args.push('--ver', this.cfg.version)

    const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    this.child = child
    this.foreground = isWin
    this.sessionActive = true
    this.deathAt = Date.now()
    let out = ''
    let exitInfo = ''
    const onOut = chunk => {
      out = (out + chunk).slice(-4000) // keep only the recent tail — foreground mode streams the game log too
      const disp = out.match(/virtual display (:\d+)/)
      if (disp && !this.display) { this.display = disp[1]; this.log(`game display: ${this.display}`) }
      const pid = out.match(/detached \(game pid (\d+)\)/) || out.match(/\[launch\] game pid (\d+)/)
      if (pid && !this.javaPid) { this.javaPid = Number(pid[1]); this.log(`client pid: ${this.javaPid}`) }
      const ex = out.match(/game exited \((.+?)\)/)
      if (ex) exitInfo = ex[1]
      const err = out.match(/spawn failed:.*/)
      if (err) this._emit('error', new Error(err[0]))
    }
    child.stdout.on('data', onOut)
    child.stderr.on('data', onOut)
    child.on('exit', code => {
      if (!this.foreground) {
        if (this.javaPid) return // linux detached client still running on its own
        this._emit('error', new Error(`launcher exited (${code})`))
        return
      }
      // windows attached mode: launcher exits when the game dies
      if (!this.sessionActive) return
      this.sessionActive = false
      this._surfaceClientOutput()
      this.log(`client exited (${exitInfo || 'code ' + code})`)
      this._emit('disconnect')
    })

    // wait for the launcher to report pid/display (max 20s)
    for (let i = 0; i < 40 && !this.javaPid; i++) await sleep(500)
    if (!this.javaPid) throw new Error('client did not start (no pid after 20s)')

    this.pos = 0
    this._watch()
    return this.javaPid
  }

  // when the game dies instantly, show whatever it managed to print —
  // JVM crash banners, missing dll messages, antivirus kills etc.
  _surfaceClientOutput () {
    try {
      const f = path.join(this.cfg.gameDir, 'logs', 'game-stdout.log')
      const st = fs.statSync(f)
      const fd = fs.openSync(f, 'r')
      const len = Math.min(4000, st.size)
      const buf = Buffer.alloc(len)
      fs.readSync(fd, buf, 0, len, st.size - len)
      fs.closeSync(fd)
      const lines = buf.toString('utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean)
      const useful = lines.filter(l => !l.startsWith('<') && !l.startsWith('[')).slice(-8)
      const shown = (useful.length ? useful : lines.slice(-6)).join(' | ')
      if (shown) this.log(`client output: ${shown}`)
      const fast = Date.now() - (this.deathAt || Date.now()) < 4000
      if (fast && !useful.length) {
        this.log('client died instantly with no output — usually antivirus blocking it: add an exclusion for the game folder and run again')
      }
    } catch {}
  }

  _watch () {
    clearInterval(this.watchTimer)
    this.watchTimer = setInterval(() => {
      if (this.javaPid && !processAlive(this.javaPid)) {
        this.log('client process died')
        this._surfaceClientOutput()
        this._emit('disconnect')
        this.javaPid = null
        clearInterval(this.watchTimer)
        this.watchTimer = null
        return
      }
      let data
      try {
        const st = fs.statSync(this.logFile)
        if (st.size < this.pos) this.pos = 0 // log recreated
        if (st.size === this.pos) return
        const len = st.size - this.pos
        const fd = fs.openSync(this.logFile, 'r')
        const buf = Buffer.alloc(len)
        fs.readSync(fd, buf, 0, len, this.pos)
        fs.closeSync(fd)
        this.pos = st.size
        data = buf.toString('utf8')
      } catch { return }

      if (MARKERS.verifyPass.test(data)) { this.log('verify passed — rejoining'); this._emit('verifyPass') }
      else if (MARKERS.verifyText.test(data)) this._emit('verifying')
      if (MARKERS.authPrompt.test(data)) this._emit('authPrompt')
      if (MARKERS.loggedIn.test(data)) this._emit('loggedIn')
      if (MARKERS.disconnect.test(data)) { this.log('connection lost'); this._emit('disconnect') }
      else if (MARKERS.kicked.test(data)) { this.log('kicked'); this._emit('disconnect') }
    }, 500)
  }

  logTail (bytes = 65536) {
    try {
      const st = fs.statSync(this.logFile)
      const fd = fs.openSync(this.logFile, 'r')
      const len = Math.min(bytes, st.size)
      const buf = Buffer.alloc(len)
      fs.readSync(fd, buf, 0, len, st.size - len)
      fs.closeSync(fd)
      return buf.toString('utf8')
    } catch { return '' }
  }

  async stop () {
    this.sessionActive = false
    clearInterval(this.watchTimer)
    this.watchTimer = null
    if (this.javaPid) {
      try {
        if (process.platform === 'win32') {
          spawnSync('taskkill', ['/PID', String(this.javaPid), '/T', '/F'], { windowsHide: true })
        } else {
          process.kill(this.javaPid, 'SIGKILL')
        }
      } catch {}
    }
    if (this.child && !this.child.killed) {
      try { this.child.kill('SIGKILL') } catch {}
    }
    if (this.display && process.platform === 'linux') {
      spawnSync('pkill', ['-f', `Xvfb ${this.display}`])
    }
    this.javaPid = null
    this.child = null
    await sleep(800)
  }
}

function processAlive (pid) {
  try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' } // alive, just not ours
}

module.exports = { Game }
