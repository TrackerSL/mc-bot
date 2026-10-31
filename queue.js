'use strict'
// serial command queue — every command waits `delayMs` BEFORE it is sent,
// including the very first one. Nothing ever goes out faster than the delay.
const { sleep } = require('./sender')

class CmdQueue {
  constructor (delayMs, sender, log) {
    this.delayMs = delayMs
    this.sender = sender
    this.log = log || (() => {})
    this.items = []
    this.running = false
    this.sent = 0
  }

  get size () { return this.items.length }

  push (text) {
    return new Promise((resolve, reject) => {
      this.items.push({ text: String(text), resolve, reject })
      this._pump()
    })
  }

  async _pump () {
    if (this.running) return
    this.running = true
    while (this.items.length) {
      const item = this.items.shift()
      await sleep(this.delayMs) // <- the required gap, before the first cmd too
      try {
        await this.sender.send(item.text)
        this.sent++
        this.log(`sent [${item.text}] (queue left: ${this.items.length})`)
        item.resolve()
      } catch (e) {
        this.log(`send failed [${item.text}]: ${e.message}`)
        item.reject(e)
      }
    }
    this.running = false
  }
}

module.exports = { CmdQueue }
