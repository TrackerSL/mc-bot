'use strict'
// Virtual display for headless servers.
// The full vanilla client needs an X display. On a server with no monitor we
// boot Xvfb (virtual framebuffer) and let Mesa's llvmpipe software renderer
// drive OpenGL — the REAL game runs exactly as on a desktop, just without a
// physical screen. Auto-enabled on Linux when $DISPLAY is unset.
const { spawn } = require('child_process')
const fs = require('fs')

function displayBusy (n) {
  return fs.existsSync(`/tmp/.X11-unix/X${n}`) || fs.existsSync(`/tmp/.X${n}-lock`)
}

async function ensureDisplay (opts = {}) {
  const { width = 1280, height = 720, depth = 24, timeout = 8000 } = opts
  if (process.platform !== 'linux') return null
  if (process.env.DISPLAY) return null // a real display exists — use it
  let n = 10
  while (displayBusy(n) && n < 200) n++
  const display = `:${n}`
  const child = spawn('Xvfb', [display, '-screen', '0', `${width}x${height}x${depth}`, '-nolisten', 'tcp'],
    { stdio: 'ignore', detached: true })
  child.unref()
  const ok = await new Promise((resolve) => {
    const t0 = Date.now()
    const iv = setInterval(() => {
      if (fs.existsSync(`/tmp/.X11-unix/X${n}`)) { clearInterval(iv); resolve(true) }
      else if (child.exitCode !== null || Date.now() - t0 > timeout) { clearInterval(iv); resolve(false) }
    }, 100)
  })
  if (!ok) {
    try { child.kill('SIGTERM') } catch {}
    throw new Error('Xvfb failed to start — install it: sudo apt-get install xvfb')
  }
  return {
    display,
    pid: child.pid,
    stop () {
      try { process.kill(child.pid, 'SIGTERM') } catch {}
      try { fs.unlinkSync(`/tmp/.X${n}-lock`) } catch {}
    }
  }
}

module.exports = { ensureDisplay }
