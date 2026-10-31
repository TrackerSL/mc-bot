'use strict'
// bare-bones .env loader — no dependencies
const fs = require('fs')
const path = require('path')

function loadEnvFile (file) {
  const out = {}
  if (!fs.existsSync(file)) return out
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    out[key] = val
  }
  return out
}

function loadConfig () {
  const file = process.env.ENV_FILE || path.join(__dirname, '.env')
  const env = loadEnvFile(file)
  const get = (k, def = '') => (process.env[k] !== undefined ? process.env[k] : env[k] !== undefined ? env[k] : def)

  const cfg = {
    playerName: String(get('PLAYER_NAME', '')).trim(),
    serverIp: String(get('SERVER_IP', '')).trim(),
    serverPort: String(get('SERVER_PORT', '25565')).trim(),
    password: get('PASSWORD', ''),
    auth: /^(on|true|yes|1)$/i.test(get('AUTH', 'on')),
    delayMs: (() => {
      const n = parseInt(get('CMD_DELAY_MS', '5000'), 10)
      return Number.isFinite(n) && n >= 0 ? n : 5000
    })(),
    cmds: get('CMDS', '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
    // runtime knobs (defaults are fine — not shown in .env)
    gameDir: process.env.GAME_DIR || path.join(__dirname, 'game'),
    version: process.env.MC_VERSION || '1.20.4',
    memory: process.env.MC_MEMORY || '1G',
    launcher: process.env.LAUNCHER || path.join(__dirname, 'launcher.js')
  }

  const missing = []
  if (!cfg.playerName) missing.push('PLAYER_NAME')
  if (!cfg.serverIp) missing.push('SERVER_IP')
  if (cfg.auth && !cfg.password) missing.push('PASSWORD (required when AUTH=on)')
  if (missing.length) {
    console.error(`[bot] missing in .env: ${missing.join(', ')} — copy .env.example to .env and fill it in`)
    process.exit(1)
  }
  return cfg
}

module.exports = { loadConfig }
