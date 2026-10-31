'use strict'
// Composes the exact official-style launch command and spawns the game.
const fs = require('fs')
const path = require('path')
const os = require('os')
const { loadVersion } = require('./version')
const { buildClasspath, joinClasspath } = require('./classpath')
const { buildArgs } = require('./args')
const { offlineUuid } = require('./uuid')
const { findJava } = require('./java')
const { extractZip } = require('./zip')

const LAUNCHER_NAME = 'mc-launcher'
const LAUNCHER_VERSION = '1.0'

function quote (s) {
  if (process.platform === 'win32') return /[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s
  return /[\s'"$`\\]/.test(s) ? `'${s.replace(/'/g, `'\\''`)}'` : s
}

function buildLaunch (gameDir, opts) {
  const versionId = opts.version || '1.20.4'
  const version = loadVersion(gameDir, versionId)
  const username = opts.user || 'Player'
  const uuid = opts.uuid || offlineUuid(username)

  const cp = buildClasspath(gameDir, version, { is_demo_user: false, has_custom_resolution: false })
  if (!fs.existsSync(cp.clientJar)) {
    throw new Error(`client jar missing: ${cp.clientJar} — run: node launcher.js install ${versionId} --dir "${gameDir}"`)
  }
  for (const n of cp.natives) {
    if (!fs.existsSync(n.jarPath)) throw new Error(`native jar missing: ${n.jarPath} — run install`)
  }

  const nativesDir = path.join(gameDir, 'versions', version.__jarId || versionId,
    `${version.__jarId || versionId}-natives-${os.hostname().replace(/[^a-zA-Z0-9]/g, '')}-${process.pid}`)

  // extract natives fresh per launch (official launcher behaviour)
  fs.mkdirSync(nativesDir, { recursive: true })
  for (const n of cp.natives) extractZip(n.jarPath, nativesDir)

  const classpath = joinClasspath(cp.entries)
  const args = buildArgs(version, {
    username,
    uuid,
    accessToken: opts.accessToken || '0',
    userType: 'legacy',
    versionId,
    versionType: version.type || 'release',
    gameDir,
    nativesDir,
    assetIndex: version.assetIndex && version.assetIndex.id,
    classpath,
    classpathSeparator: path.delimiter,
    launcherName: LAUNCHER_NAME,
    launcherVersion: LAUNCHER_VERSION,
    libraryDir: path.join(gameDir, 'libraries'),
    quickPlayMultiplayer: opts.join || '',
    quickPlaySingleplayer: opts.world || '',
    quickPlayPath: 'quickPlay/log.json',
    width: opts.width,
    height: opts.height
  })

  // logging config (log4j) — the official launcher always passes it
  const jvm = [...args.jvm]
  if (version.logging && version.logging.client && version.logging.client.file) {
    const f = version.logging.client.file
    const lp = path.join(gameDir, 'log_configs', f.id)
    if (fs.existsSync(lp)) {
      jvm.push(version.logging.client.argument.replace('${path}', lp))
    }
  }

  // memory
  const mem = opts.memory || process.env.MC_MEMORY || null
  if (mem) { jvm.unshift(`-Xmx${mem}`, `-Xms${mem}`) }

  const requiredJava = version.javaVersion ? version.javaVersion.majorVersion : null
  const java = opts.java || findJava(gameDir, requiredJava, version).path

  const command = [java, ...jvm, version.mainClass, ...args.game]
  return { command, version, uuid, nativesDir, java, requiredJava }
}

function spawnGame (command, opts = {}) {
  const { spawn } = require('child_process')
  const child = spawn(command[0], command.slice(1), {
    cwd: opts.gameDir || process.cwd(),
    detached: !!opts.detached && process.platform !== 'win32',
    stdio: opts.stdio || 'ignore',
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
    windowsHide: process.platform === 'win32' // no stray console window — game window still shows
  })
  if (opts.stdio) child.stdout && child.stdout.on('data', d => process.stdout.write(d))
  if (opts.stdio) child.stderr && child.stderr.on('data', d => process.stderr.write(d))
  child.unref && child.unref()
  return child
}

module.exports = { buildLaunch, spawnGame, quote }
