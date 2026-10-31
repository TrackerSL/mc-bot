'use strict'
// talks to the game window — Linux: xdotool types as a human;
// Windows: PowerShell SendKeys into the Minecraft window
const { spawnSync } = require('child_process')
const path = require('path')

function sleep (ms) { return new Promise(r => setTimeout(r, ms)) }

// SendKeys can't produce these — drop them up front (bot chat is ASCII anyway)
function normalize (text) {
  return String(text)
    .replace(/[\r\n]+/g, ' ')
    .replace(/["{}]/g, '')
    .replace(/[^\x20-\x7E]/g, '?')
}

function makeSender (getDisplay) {
  const isWin = process.platform === 'win32'

  async function send (raw) {
    const msg = normalize(raw)
    if (!msg) return

    if (isWin) {
      const res = spawnSync('powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'send-win.ps1')],
        { input: msg, encoding: 'utf8', windowsHide: true })
      if (res.error) throw res.error
      if (res.status === 3) throw new Error('Minecraft window not found — is the game open?')
      if (res.status !== 0) throw new Error(`windows typing failed (code ${res.status})`)
      await sleep(400)
      return
    }

    // --- linux / headless ---
    const display = getDisplay() || process.env.DISPLAY || ':0'
    function xdo (args) {
      const r = spawnSync('xdotool', args, {
        env: { ...process.env, DISPLAY: display },
        encoding: 'utf8'
      })
      if (r.error) throw r.error
      if (r.status !== 0) throw new Error(`xdotool ${args[0]} failed: ${(r.stderr || '').trim()}`)
    }
    xdo(['mousemove', '640', '400'])
    await sleep(350)
    xdo(['key', '--clearmodifiers', 't'])
    await sleep(1200) // chat must be fully open before typing (never cut this short)
    xdo(['type', '--clearmodifiers', '--delay', '42', '--', msg])
    await sleep(500)
    xdo(['key', '--clearmodifiers', 'Return'])
    await sleep(400)
  }

  return { send }
}

module.exports = { makeSender, sleep, normalize }
