'use strict'
// Evaluation of Mojang version-JSON rule objects:
//   { action: 'allow'|'disallow', os: {name, arch, version}, features: {...} }
// A rule list passes when the LAST matching rule says allow (Mojang's
// semantics); empty rules pass. 'disallow' matches apply immediately.

const osName = { win32: 'windows', darwin: 'osx', linux: 'linux' }[process.platform] || process.platform
const osArch = process.arch === 'x64' ? 'x64' : process.arch === 'ia32' ? 'x86' : process.arch

function matchOs (os) {
  if (!os) return true
  if (os.name && os.name !== osName) return false
  if (os.arch && os.arch !== osArch) return false
  if (os.version && !new RegExp(os.version).test(process.getReport ? (process.getReport().header.osVersion || '') : '')) return false
  return true
}

function matchFeatures (f, features) {
  if (!f) return true
  for (const [k, want] of Object.entries(f)) {
    if ((features && !!features[k]) !== !!want) return false
  }
  return true
}

function rulesPass (rules, features) {
  if (!rules || rules.length === 0) return true
  let allowed = false
  for (const r of rules) {
    const m = matchOs(r.os) && matchFeatures(r.features, features)
    if (!m) continue
    if (r.action === 'disallow') return false
    if (r.action === 'allow') allowed = true
  }
  return allowed
}

module.exports = { rulesPass, osName, osArch }
