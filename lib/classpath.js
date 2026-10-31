'use strict'
// Classpath assembly: rule-filtered libraries + the client jar.
// Windows joins with ';', everything else ':' (wiki.vg/Launching_the_game).
const fs = require('fs')
const path = require('path')
const { rulesPass, osName } = require('./rules')

function libPathFromName (name, classifier) {
  // group:artifact:version[:classifier]
  const parts = name.split(':')
  const [g, a, v, c] = parts
  const cls = classifier || c
  return g.replace(/\./g, '/') + '/' + a + '/' + v + '/' + `${a}-${v}${cls ? '-' + cls : ''}.jar`
}

function nativeClassifierKey (lib) {
  if (!lib.natives) return null
  const raw = lib.natives[osName]
  if (!raw) return null
  return raw.replace('${arch}', '64')
}

function libraryJarPath (gameDir, lib) {
  if (lib.downloads && lib.downloads.artifact && lib.downloads.artifact.path) {
    return path.join(gameDir, 'libraries', lib.downloads.artifact.path)
  }
  return path.join(gameDir, 'libraries', libPathFromName(lib.name))
}

function nativeJarPath (gameDir, lib, key) {
  const cls = lib.downloads && lib.downloads.classifiers && lib.downloads.classifiers[key]
  if (cls && cls.path) return path.join(gameDir, 'libraries', cls.path)
  // old-style: natives-{os} classifier derived from the artifact name
  return path.join(gameDir, 'libraries', libPathFromName(lib.name, key))
}

function buildClasspath (gameDir, version, features) {
  const entries = []
  const natives = [] // [{lib, key, jarPath}]
  for (const lib of version.libraries || []) {
    if (!rulesPass(lib.rules, features)) continue
    const jar = libraryJarPath(gameDir, lib)
    if (lib.natives) {
      const key = nativeClassifierKey(lib)
      if (!key) continue // natives for another OS
      if (!fs.existsSync(jar)) throw new Error(`missing native library: ${jar}`)
      natives.push({ jarPath: nativeJarPath(gameDir, lib, key) })
      // natives jars are NOT placed on the classpath; their contents are
      // extracted into the natives dir instead
      continue
    }
    entries.push(jar)
  }
  const jarId = version.__jarId || version.id
  const clientJar = path.join(gameDir, 'versions', jarId, `${jarId}.jar`)
  entries.push(clientJar)
  return { entries, natives, clientJar }
}

function joinClasspath (entries) {
  return entries.join(path.delimiter)
}

module.exports = { buildClasspath, joinClasspath, libraryJarPath, nativeJarPath, nativeClassifierKey, libPathFromName }
