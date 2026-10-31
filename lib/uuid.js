'use strict'
// Offline ("cracked") UUID: MD5("OfflinePlayer:" + name), RFC-4122 v3 bits.
// Verified byte-identical to the CWR server's own success uuid for
// Test_ashole247 -> 906a662c-a037-3133-9783-2c43299ae2d6 (server logs).
const crypto = require('crypto')

function offlineUuid (username) {
  const h = crypto.createHash('md5').update('OfflinePlayer:' + username, 'utf8').digest()
  h[6] = (h[6] & 0x0f) | 0x30 // version 3
  h[8] = (h[8] & 0x3f) | 0x80 // RFC-4122 variant
  const x = h.toString('hex')
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`
}

module.exports = { offlineUuid }
