'use strict'
// AuthMe: /login + /register are built in — the player never types them.
// First run on the name  -> server says nothing after /login, so we
// /register then /login. Later runs -> /login alone succeeds.
const { sleep } = require('./sender')

async function runAuth (cfg, queue, game, log) {
  log(`auth: sending /login (AUTH=on, password ${'*'.repeat(Math.max(3, String(cfg.password).length))})`)
  await queue.push(`/login ${cfg.password}`)
  await sleep(3500)
  if (game.logTail().includes('login was successful')) { log('auth: logged in'); return true }

  log('auth: not registered yet — registering first time')
  await queue.push(`/register ${cfg.password} ${cfg.password}`)
  await sleep(1800)
  await queue.push(`/login ${cfg.password}`)
  await sleep(3500)
  const ok = game.logTail().includes('login was successful')
  log(ok ? 'auth: logged in' : 'auth: FAILED — check PASSWORD / server state')
  return ok
}

module.exports = { runAuth }
