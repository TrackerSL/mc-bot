'use strict'
// Builds the JVM + game argument arrays exactly the way the official
// launcher does: expand ${placeholders}, honour os/feature rules, and for
// pre-1.17 profiles fall back to the legacy `minecraftArguments` string.
const { rulesPass } = require('./rules')

const OS_NAME = { win32: 'windows', darwin: 'osx', linux: 'linux' }[process.platform] || process.platform

function expand (v, vars) {
  if (Array.isArray(v)) return v.map(x => expand(x, vars))
  if (typeof v !== 'string') return v
  return v.replace(/\$\{([a-zA-Z0-9_]+)\}/g, (m, k) => {
    if (vars[k] === undefined || vars[k] === null) {
      throw new Error(`unresolved launch placeholder: ${k}`)
    }
    return String(vars[k])
  })
}

function buildVariables (o) {
  return {
    auth_player_name: o.username,
    version_name: o.versionId,
    game_directory: o.gameDir,
    game_assets: path_join(o.gameDir, 'assets', 'virtual', 'legacy'), // pre-1.7 profiles
    assets_root: path_join(o.gameDir, 'assets'),
    assets_index_name: o.assetIndex,
    auth_uuid: o.uuid,
    auth_access_token: o.accessToken,
    clientid: o.clientId || '0',
    auth_xuid: o.xuid || '0',
    user_type: o.userType || 'legacy',
    version_type: o.versionType || 'release',
    natives_directory: o.nativesDir,
    launcher_name: o.launcherName || 'mc-launcher',
    launcher_version: o.launcherVersion || '1.0',
    classpath: o.classpath,
    classpath_separator: o.classpathSeparator,
    library_directory: o.libraryDir,
    resolution_width: o.width || '854',
    resolution_height: o.height || '480',
    quickPlayPath: o.quickPlayPath || 'quickPlay/log.json',
    quickPlaySingleplayer: o.quickPlaySingleplayer || '',
    quickPlayMultiplayer: o.quickPlayMultiplayer || '',
    quickPlayRealms: o.quickPlayRealms || ''
  }
}

function path_join (...parts) {
  return parts.join(require('path').sep).replace(/[/\\]{2,}/g, require('path').sep)
}

function pick (entries, features) {
  const out = []
  for (const e of entries || []) {
    if (typeof e === 'string') { out.push(e); continue }
    if (rulesPass(e.rules, features)) {
      const v = Array.isArray(e.value) ? e.value : [e.value]
      out.push(...v)
    }
  }
  return out
}

function buildArgs (version, o) {
  const features = {
    is_demo_user: !!o.demo,
    has_custom_resolution: !!o.width,
    has_quick_plays_support: o.quickPlaySupport !== false,
    is_quick_play_singleplayer: !!o.quickPlaySingleplayer,
    is_quick_play_multiplayer: !!o.quickPlayMultiplayer,
    is_quick_play_realms: !!o.quickPlayRealms
  }
  const vars = buildVariables({ ...o, assetIndex: o.assetIndex })
  let gameEntries
  let jvmEntries
  if (version.arguments) {
    gameEntries = version.arguments.game
    jvmEntries = version.arguments.jvm
  } else if (version.minecraftArguments) {
    gameEntries = version.minecraftArguments.split(' ')
    jvmEntries = [] // pre-1.17: we add the standard jvm args ourselves below
  } else {
    throw new Error('version json has neither arguments nor minecraftArguments')
  }
  const game = pick(gameEntries, features).map(a => expand(a, vars))
  let jvm = pick(jvmEntries, features).map(a => expand(a, vars))

  // legacy profiles (no arguments.jvm in json): supply the timeless set
  if (!version.arguments) {
    jvm = [
      `-Djava.library.path=${o.nativesDir}`,
      '-cp', o.classpath
    ]
  }
  // unresolved-optional placeholders only appear when a feature is off;
  // a leftover '{...}' after expansion of ENABLED features is a bug:
  for (const a of [...jvm, ...game]) {
    if (typeof a === 'string' && /\$\{[a-zA-Z0-9_]+\}/.test(a)) {
      throw new Error(`unexpanded placeholder leaked into args: ${a}`)
    }
  }
  return { jvm, game, features }
}

module.exports = { buildArgs, buildVariables }
