'use strict'
// live terminal: whatever the player types is queued and sent to the game
// (same 5-second rule as everything else — the queue enforces it)
const readline = require('readline')

const HELP = [
  'terminal commands:',
  '  <anything>   sent to the game chat as-is (colors ok: &a&l ...)',
  '  /lifesteal   example game command — same for any /command',
  '  :help        this help',
  '  :queue       show queue status',
  '  :quit        stop the bot and exit'
]

function startTerminal (cfg, queue, log, onQuit) {
  if (!process.stdin.isTTY) {
    log('no interactive terminal attached — running queue only (type commands when run from a shell)')
    return null
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' })
  console.log('[bot] terminal ready — type a chat message or /command, :help for help')
  rl.prompt()
  rl.on('line', line => {
    const s = line.trim()
    if (!s) { rl.prompt(); return }
    if (s === ':help' || s === ':h') HELP.forEach(l => console.log('  ' + l))
    else if (s === ':queue' || s === ':q') console.log(`  queued: ${queue.size}, sent total: ${queue.sent}`)
    else if (s === ':quit' || s === ':exit') { rl.close(); onQuit(); return }
    else queue.push(s).catch(() => {})
    rl.prompt()
  })
  rl.on('close', () => {})
  return rl
}

module.exports = { startTerminal }
