'use strict'
// Version JSON loading with full inheritance-chain merge
// (inheritsFromId: fabric / forge / OptiFine / TLauncher-style profiles),
// including the `jar` override (custom profiles re-use another version's jar).
const fs = require('fs')
const path = require('path')

function versionPath (gameDir, id) {
  return path.join(gameDir, 'versions', id, `${id}.json`)
}

function readJson (p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'))
}

function loadVersionRaw (gameDir, id, seen = new Set()) {
  const p = versionPath(gameDir, id)
  if (!fs.existsSync(p)) throw new Error(`version json not found: ${p}`)
  if (seen.has(id)) throw new Error(`inheritance cycle at ${id}`)
  seen.add(id)
  const json = readJson(p)
  if (json.inheritsFrom) {
    const parent = loadVersionRaw(gameDir, json.inheritsFrom, seen)
    return mergeChildIntoParent(parent, json, id)
  }
  return json
}

function mergeChildIntoParent (parent, child, id) {
  const merged = {}
  // scalars: child wins
  for (const k of Object.keys(parent)) {
    if (['libraries', 'arguments', 'minecraftArguments'].includes(k)) continue
    merged[k] = parent[k]
  }
  for (const k of Object.keys(child)) {
    if (['libraries', 'arguments', 'minecraftArguments', 'inheritsFrom'].includes(k)) continue
    merged[k] = child[k]
  }
  merged.id = id || child.id || parent.id
  // libraries: parent first, child overrides by artifact name
  const libs = new Map()
  for (const l of parent.libraries || []) libs.set(l.name, l)
  for (const l of child.libraries || []) libs.set(l.name, l) // child wins
  merged.libraries = [...libs.values()]
  // arguments: concatenate (vanilla first, mod-loader second); keep rules
  const parentArgs = parent.arguments || null
  const childArgs = child.arguments || null
  if (parentArgs || childArgs) {
    merged.arguments = {
      game: [...(parentArgs?.game || []), ...(childArgs?.game || [])],
      jvm: [...(parentArgs?.jvm || []), ...(childArgs?.jvm || [])]
    }
    // legacy string form is superseded once either side uses the new form
  } else if (child.minecraftArguments) {
    merged.minecraftArguments = child.minecraftArguments
  } else {
    merged.minecraftArguments = parent.minecraftArguments
  }
  // jar: explicit child jar, else child's own id when child had no inherits
  // (child may be a custom profile pointing at a vanilla jar)
  if (child.jar) merged.jar = child.jar
  else if (!child.inheritsFrom && child.downloads) merged.jar = child.id
  else if (parent.jar) merged.jar = parent.jar
  else merged.jar = parent.id
  return merged
}

function loadVersion (gameDir, id) {
  const v = loadVersionRaw(gameDir, id)
  v.__jarId = v.jar || id
  return v
}

module.exports = { loadVersion, versionPath }
