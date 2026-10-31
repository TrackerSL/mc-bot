'use strict'
// Java resolution: --java override, bundled runtime (installRuntime),
// JAVA_HOME, PATH. Verifies the MAJOR version against the profile's
// javaVersion.majorVersion requirement.
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

function javaMajor (javaPath) {
  // `java -version` exits 0 but prints to STDERR — use spawnSync and read both
  const r = spawnSync(javaPath, ['-version'], { encoding: 'utf8' })
  if (r.error) return null
  const out = `${r.stderr || ''}${r.stdout || ''}`
  return out ? parseMajor(out) : null
}

function parseMajor (text) {
  const m = text.match(/version "(\d+)\.(\d+)/) || text.match(/version "(\d+)"/)
  if (!m) return null
  const major = parseInt(m[1], 10)
  return major === 1 ? parseInt(m[2], 10) : major // "1.8.0" -> 8
}

function findJava (gameDir, requiredMajor, version) {
  const candidates = []
  if (version && version.javaVersion && version.javaVersion.component) {
    const bin = path.join(gameDir, 'runtime', version.javaVersion.component, 'bin',
      process.platform === 'win32' ? 'java.exe' : 'java')
    candidates.push(bin)
  }
  if (process.env.JAVA_HOME) {
    candidates.push(path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'))
  }
  candidates.push(process.platform === 'win32' ? 'java.exe' : 'java')
  const problems = []
  for (const c of candidates) {
    const major = javaMajor(c)
    if (!major) { problems.push(`${c}: not runnable`); continue }
    if (requiredMajor && major < requiredMajor) {
      problems.push(`${c}: Java ${major} < required ${requiredMajor}`)
      continue
    }
    return { path: c, major }
  }
  const err = new Error('no suitable Java found:\n  ' + problems.join('\n  ') +
    `\nRun: node launcher.js install-java ${version ? version.id : '<version>'} --dir "${gameDir}"`)
  err.problems = problems
  throw err
}

module.exports = { findJava, javaMajor, parseMajor }
