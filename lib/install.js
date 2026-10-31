'use strict'
// Installs everything a version needs: version json, client jar, libraries
// (incl. natives), logging config, assets, and the exact Mojang JRE the
// profile requires (javaVersion.component from the version json).
const fs = require('fs')
const path = require('path')
const { fetchJson, downloadTo, pool } = require('./download')
const { loadVersion } = require('./version')
const { rulesPass } = require('./rules')
const { nativeClassifierKey, nativeJarPath, libraryJarPath } = require('./classpath')

const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'
const JRE_ALL_URL = 'https://piston-meta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json'
const ASSET_CDN = 'https://resources.download.minecraft.net'

const PLATFORM = (() => {
  if (process.platform === 'win32') return process.arch === 'x64' ? 'windows-x64' : 'windows-x86'
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'mac-os-arm64' : 'mac-os'
  return process.arch === 'x64' ? 'linux' : 'linux-i386'
})()

function log (msg) { console.log(`[install] ${msg}`) }

async function installVersionJson (gameDir, versionId) {
  const dest = path.join(gameDir, 'versions', versionId, `${versionId}.json`)
  if (fs.existsSync(dest)) { log(`${versionId}.json present`); return dest }
  const manifest = await fetchJson(MANIFEST_URL)
  const entry = (manifest.versions || []).find(v => v.id === versionId)
  if (!entry) throw new Error(`version ${versionId} not in Mojang manifest (custom/mod profiles must already exist in <dir>/versions)`)
  log(`fetching ${versionId}.json`)
  const json = await fetchJson(entry.url)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, JSON.stringify(json, null, 2))
  return dest
}

async function installGameFiles (gameDir, versionId, onProgress) {
  await installVersionJson(gameDir, versionId)
  const v = loadVersion(gameDir, versionId)
  const tasks = []

  // client jar (from its own version folder, or the `jar` override)
  const jarId = v.__jarId
  const clientJar = path.join(gameDir, 'versions', jarId, `${jarId}.jar`)
  if (!fs.existsSync(clientJar)) {
    // ensure the jar-owner version json exists (custom profiles point elsewhere)
    const ownerJson = path.join(gameDir, 'versions', jarId, `${jarId}.json`)
    if (!fs.existsSync(ownerJson) && jarId !== versionId) await installVersionJson(gameDir, jarId)
    let src = v.downloads && v.downloads.client
    if (!src) {
      const owner = jarId !== versionId ? JSON.parse(fs.readFileSync(ownerJson, 'utf8')) : null
      src = owner && owner.downloads && owner.downloads.client
    }
    if (!src) throw new Error(`no downloads.client for ${versionId} (jar ${jarId})`)
    tasks.push({ url: src.url, dest: clientJar, sha1: src.sha1, label: `client ${jarId}.jar` })
  }

  // libraries + natives
  const features = { has_custom_resolution: false, is_demo_user: false }
  for (const lib of v.libraries || []) {
    if (!rulesPass(lib.rules, features)) continue
    if (lib.natives) {
      const key = nativeClassifierKey(lib)
      if (!key) continue
      const dest = nativeJarPath(gameDir, lib, key)
      const cls = lib.downloads && lib.downloads.classifiers && lib.downloads.classifiers[key]
      if (cls) tasks.push({ url: cls.url, dest, sha1: cls.sha1, label: `native ${path.basename(dest)}` })
      continue
    }
    const art = lib.downloads && lib.downloads.artifact
    const dest = libraryJarPath(gameDir, lib)
    if (art) tasks.push({ url: art.url, dest, sha1: art.sha1, label: path.basename(dest) })
    else {
      // very old profiles without downloads: derive from maven coords
      const [g, a, ver, cls] = lib.name.split(':')
      const file = `${a}-${ver}${cls ? '-' + cls : ''}.jar`
      const url = `https://libraries.minecraft.net/${g.replace(/\./g, '/')}/${a}/${ver}/${file}`
      tasks.push({ url, dest, sha1: null, label: file })
    }
  }

  // logging config (log4j)
  let loggingPath = null
  if (v.logging && v.logging.client && v.logging.client.file) {
    const f = v.logging.client.file
    loggingPath = path.join(gameDir, 'log_configs', f.id)
    tasks.push({ url: f.url, dest: loggingPath, sha1: f.sha1, label: `log4j ${f.id}` })
  }

  log(`downloading ${tasks.length} game files...`)
  await pool(tasks, 16, async (t) => {
    await downloadTo(t.url, t.dest, t.sha1)
    if (onProgress) onProgress(t)
    return t
  })

  return { version: v, loggingPath }
}

async function installAssets (gameDir, version) {
  const idx = version.assetIndex
  if (!idx) throw new Error('no assetIndex in version json')
  const indexFile = path.join(gameDir, 'assets', 'indexes', idx.id + '.json')
  if (!fs.existsSync(indexFile)) {
    log(`fetching asset index ${idx.id}`)
    await downloadTo(idx.url, indexFile, idx.sha1)
  }
  const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'))
  const objects = Object.entries(index.objects || {})
  const tasks = objects.map(([name, o]) => ({
    url: `${ASSET_CDN}/${o.hash.slice(0, 2)}/${o.hash}`,
    dest: path.join(gameDir, 'assets', 'objects', o.hash.slice(0, 2), o.hash),
    sha1: o.hash,
    label: name
  }))
  let done = 0
  const missing = tasks.filter(t => !fs.existsSync(t.dest))
  log(`assets: ${tasks.length} total, ${missing.length} to download`)
  await pool(missing, 24, async (t) => {
    await downloadTo(t.url, t.dest, t.sha1)
    done++
    if (done % 500 === 0) log(`  assets ${done}/${missing.length}`)
    return t
  })
}

async function installRuntime (gameDir, component) {
  // Mojang JRE: all.json[PLATFORM][component][0].manifest.url -> files map
  const destRoot = path.join(gameDir, 'runtime', component)
  const javaBin = path.join(destRoot, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
  if (fs.existsSync(javaBin)) {
    // integrity spot-check (restore/rsync can corrupt or zero files)
    const critical = process.platform === 'win32'
      ? ['bin/java.exe', 'bin/server/jvm.dll', 'lib/modules']
      : ['lib/libjli.so', 'lib/modules']
    let broken = false
    for (const rel of critical) {
      const fp = path.join(destRoot, ...rel.split('/'))
      try { if (fs.statSync(fp).size === 0) broken = true } catch { broken = true }
    }
    if (broken) {
      log(`runtime ${component} corrupt — reinstalling`)
      fs.rmSync(destRoot, { recursive: true, force: true })
    } else {
    // self-heal: copy/rsync can strip exec bits
    if (process.platform !== 'win32') {
      try {
        for (const f of fs.readdirSync(path.join(destRoot, 'bin'))) {
          fs.chmodSync(path.join(destRoot, 'bin', f), 0o755)
        }
        for (const f of ['lib/jspawnhelper', 'lib/server/libjvm.so']) {
          const fp = path.join(destRoot, ...f.split('/'))
          if (fs.existsSync(fp)) fs.chmodSync(fp, 0o755)
        }
      } catch {}
    }
    log(`runtime ${component} present`)
    return destRoot
    }
  }
  const all = await fetchJson(JRE_ALL_URL)
  const list = all[PLATFORM] && all[PLATFORM][component]
  if (!list || !list.length) throw new Error(`no runtime ${component} for platform ${PLATFORM}`)
  const man = await fetchJson(list[0].manifest.url)
  const files = Object.entries(man.files || {})
  log(`runtime ${component}: ${files.length} files`)
  await pool(files, 16, async ([rel, f]) => {
    const dest = path.join(destRoot, ...rel.split('/'))
    if (f.type === 'directory') { fs.mkdirSync(dest, { recursive: true }); return }
    if (f.type !== 'file') return // links unsupported (not used on desktop)
    // runtime manifests use a single object (older docs show an array)
    const raw = f.downloads && f.downloads.raw && (Array.isArray(f.downloads.raw) ? f.downloads.raw[0] : f.downloads.raw)
    if (!raw) throw new Error(`no raw download for ${rel} (lzma-only unsupported)`)
    await downloadTo(raw.url, dest, raw.sha1)
    if (f.executable && process.platform !== 'win32') {
      try { fs.chmodSync(dest, 0o755) } catch {}
    }
  })
  if (!fs.existsSync(javaBin)) throw new Error(`runtime installed but ${javaBin} missing`)
  return destRoot
}

async function install (gameDir, versionId, opts = {}) {
  const { version, loggingPath } = await installGameFiles(gameDir, versionId)
  if (!opts.skipAssets) await installAssets(gameDir, version)
  let runtimeDir = null
  if (!opts.skipRuntime && version.javaVersion && version.javaVersion.component) {
    runtimeDir = await installRuntime(gameDir, version.javaVersion.component)
  }
  log('done.')
  return { version, loggingPath, runtimeDir }
}

module.exports = { install, installVersionJson, installGameFiles, installAssets, installRuntime, PLATFORM, MANIFEST_URL }
