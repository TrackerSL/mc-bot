'use strict'
// mc-arena-bot — one command: npm start
// connects the real vanilla client, logs in (/login + /register built in),
// runs the .env command queue, then hands you a live terminal.
const { loadConfig } = require('./config')
const { makeSender, sleep } = require('./sender')
const { CmdQueue } = require('./queue')
const { Game } = require('./game')
const { runAuth } = require('./auth')
const { startTerminal } = require('./terminal')

const cfg = loadConfig()
const stamp = () => new Date().toLocaleTimeString()
const log = m => console.log(`[${stamp()}] [bot] ${m}`)

// --- send gate: terminal can type early, but sends only flow while the
// game window exists (closed again during every reconnect) ---
let gateWait = null
let gateOpen = null
function closeGate () {
  if (gateOpen) gateOpen() // flush waiters from the dead window (they error out, never jam)
  gateWait = new Promise(resolve => { gateOpen = resolve })
}
function openGate () { if (gateOpen) { gateOpen(); gateOpen = null } }
closeGate()

const game = new Game(cfg, log)
const baseSender = makeSender(() => game.display)
const queue = new CmdQueue(cfg.delayMs, {
  send: async text => { await gateWait; return baseSender.send(text) }
}, log)

log(`player: ${cfg.playerName}  server: ${cfg.serverIp}:${cfg.serverPort}`)
log(`auth: ${cfg.auth ? 'on (login/register automatic)' : 'off'}  cmd delay: ${cfg.delayMs}ms  queue: ${cfg.cmds.length ? cfg.cmds.join(', ') : '(empty)'}`)

let running = true
function shutdown (why) {
  if (!running) return
  running = false
  log(`shutting down${why ? ` (${why})` : ''}...`)
  game.stop().finally(() => process.exit(0))
  setTimeout(() => process.exit(0), 4000)
}
process.on('SIGINT', () => shutdown('ctrl+c'))
process.on('SIGTERM', () => shutdown('sigterm'))

startTerminal(cfg, queue, log, () => shutdown('terminal :quit'))

async function waitUntil (cond, timeoutMs) {
  const t0 = Date.now()
  while (running) {
    if (cond()) return true
    if (Date.now() - t0 > timeoutMs) return false
    await sleep(300)
  }
  return false
}

async function mainLoop () {
  try {
    await game.ensureInstalled()
  } catch (e) {
    console.error(`[bot] setup failed: ${e.message}`)
    process.exit(1)
  }
  let streak = 0 // consecutive failed sessions (used for backoff)
  while (running) {
    closeGate()
    let ready = false
    let authStarted = false
    let cmdsQueued = false
    let endResolve = null
    let ended = false
    const endReason = new Promise(resolve => { endResolve = resolve })
    const finish = reason => { if (!ended) { ended = true; endResolve(reason) } }

    game.on('verifyPass', () => { log('verify passed'); finish('rejoin') })
    game.on('disconnect', () => finish('restart'))
    game.on('authPrompt', () => {
      if (ready) return
      if (!cfg.auth) {
        log('server asks for login but AUTH=off — skipping (set AUTH=on to auto-login)')
        markReady()
        return
      }
      if (authStarted) return
      authStarted = true
      openGate() // auth needs to type
      runAuth(cfg, queue, game, log).then(ok => {
        if (ok) markReady()
        else { log('auto-login failed — you can still type /login <pass> in the terminal'); markReady() }
      }).catch(e => {
        log(`auth error: ${e.message} — continue with terminal if needed`)
        markReady()
      })
    })
    game.on('loggedIn', () => { if (cfg.auth) markReady() })

    function markReady () {
      if (ready) return
      ready = true
      streak = 0
      log('READY — in game')
      openGate()
      if (!cmdsQueued) {
        cmdsQueued = true
        if (cfg.cmds.length) {
          log(`running .env queue: ${cfg.cmds.join(' | ')}`)
          for (const c of cfg.cmds) queue.push(c).catch(() => {})
        }
      }
    }

    // --- launch this session ---
    try {
      await game.start()
      closeGate() // no sends until auth prompt / ready opens it
      log(`client up — joining ${cfg.serverIp}:${cfg.serverPort}`)
    } catch (e) {
      log(`launch failed: ${e.message} — retrying in 10s`)
      await sleep(10000)
      continue
    }

    if (!cfg.auth) {
      // no login expected: give the client a moment to load in, then run queue
      setTimeout(() => { if (!ended) markReady() }, 12000)
    }

    // phase 1: reach ready (or session ends / timeout)
    const reached = await waitUntil(() => ready || ended, 300000)
    if (!running) break
    if (!reached && !ended) { log('no login within 5 min — restarting client in 10s'); finish('timeout') }

    const reason = await endReason

    if (!ready) {
      // session ended before we got in
      streak++
      const backoff = reason === 'rejoin' ? 3000 : reason === 'timeout' ? 10000 : 5000
      const penalty = streak >= 4 ? 30000 : 0
      log(`session (${reason}) — restarting in ${(backoff + penalty) / 1000}s${streak >= 4 ? ' (repeated failures — cooling down)' : ''}`)
      await game.stop()
      closeGate()
      await sleep(backoff + penalty)
      continue
    }

    // phase 2: we were in — wait for the session to end
    log('connected — waiting (terminal is live; :quit to stop)')
    const final = await endReason
    if (!running) break
    log(`session ended (${final}) — ${final === 'rejoin' ? 'verify rejoin' : 'reconnecting'} in ${final === 'rejoin' ? 3 : 5}s`)
    await game.stop()
    closeGate()
    await sleep(final === 'rejoin' ? 3000 : 5000)
  }
}

mainLoop().catch(e => { console.error('[bot] fatal:', e); shutdown('error') })
