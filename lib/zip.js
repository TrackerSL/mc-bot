'use strict'
// Minimal ZIP reader for natives extraction — no dependencies.
// Walks the central directory, inflates entries with zlib, skips META-INF.
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

function findEOCD (buf) {
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i
  }
  throw new Error('not a zip file (EOCD missing)')
}

function extractZip (zipFile, destDir) {
  fs.mkdirSync(destDir, { recursive: true })
  const buf = fs.readFileSync(zipFile)
  const eocd = findEOCD(buf)
  const count = buf.readUInt16LE(eocd + 10)
  let off = buf.readUInt32LE(eocd + 16)
  let extracted = 0
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('bad central directory entry')
    const method = buf.readUInt16LE(off + 10)
    const compSize = buf.readUInt32LE(off + 20)
    const nameLen = buf.readUInt16LE(off + 28)
    const extraLen = buf.readUInt16LE(off + 30)
    const commentLen = buf.readUInt16LE(off + 32)
    const localOff = buf.readUInt32LE(off + 42)
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen)
    off += 46 + nameLen + extraLen + commentLen
    if (name.endsWith('/')) continue // directory
    if (name.startsWith('META-INF/') || /^META-INF\\/.test(name)) continue // launcher convention
    // local header: skip its name+extra
    const lNameLen = buf.readUInt16LE(localOff + 26)
    const lExtraLen = buf.readUInt16LE(localOff + 28)
    const dataStart = localOff + 30 + lNameLen + lExtraLen
    const raw = buf.subarray(dataStart, dataStart + compSize)
    let data
    if (method === 0) data = raw
    else if (method === 8) data = zlib.inflateRawSync(raw)
    else throw new Error(`unsupported zip method ${method} in ${name}`)
    const out = path.join(destDir, name)
    fs.mkdirSync(path.dirname(out), { recursive: true })
    fs.writeFileSync(out, data)
    extracted++
  }
  return extracted
}

module.exports = { extractZip }
