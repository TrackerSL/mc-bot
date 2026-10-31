'use strict'
// Dependency-free HTTPS downloader with sha1 verification + retries.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const https = require('https')
const http = require('http')

function fetchBuffer (url, redirects = 3) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('http:') ? http : https
    const req = mod.get(url, { headers: { 'User-Agent': 'mc-launcher/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume()
        return resolve(fetchBuffer(new URL(res.headers.location, url).href, redirects - 1))
      }
      if (res.statusCode !== 200) {
        res.resume()
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`))
      }
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks)))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.setTimeout(60000, () => req.destroy(new Error(`timeout: ${url}`)))
  })
}

function sha1 (buf) {
  return crypto.createHash('sha1').update(buf).digest('hex')
}

async function downloadTo (url, dest, expectedSha1, retries = 3) {
  if (fs.existsSync(dest)) {
    if (!expectedSha1) return { skipped: true }
    const have = sha1(fs.readFileSync(dest))
    if (have === expectedSha1) return { skipped: true }
  }
  let lastErr
  for (let i = 0; i < retries; i++) {
    try {
      const buf = await fetchBuffer(url)
      if (expectedSha1 && sha1(buf) !== expectedSha1) {
        throw new Error(`sha1 mismatch for ${url}`)
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      const tmp = dest + '.part'
      fs.writeFileSync(tmp, buf)
      fs.renameSync(tmp, dest)
      return { bytes: buf.length }
    } catch (e) {
      lastErr = e
      await new Promise(r => setTimeout(r, 400 * (i + 1)))
    }
  }
  throw lastErr
}

async function fetchJson (url) {
  return JSON.parse((await fetchBuffer(url)).toString('utf8'))
}

// fixed-size pool over async tasks
async function pool (items, concurrency, worker) {
  const queue = [...items]
  const results = []
  let active = 0
  return new Promise((resolve, reject) => {
    const next = () => {
      while (active < concurrency && queue.length) {
        const item = queue.shift()
        active++
        Promise.resolve()
          .then(() => worker(item))
          .then(r => { results.push(r) })
          .catch(reject)
          .finally(() => { active--; if (active === 0 && queue.length === 0) resolve(results); else next() })
      }
      if (active === 0 && queue.length === 0) resolve(results)
    }
    next()
  })
}

module.exports = { fetchBuffer, fetchJson, downloadTo, sha1, pool }
