/* eslint-disable @typescript-eslint/no-require-imports -- Node --require preload must be CommonJS. */
// Offline instrumentation of real child construction. No injected evidence.
const fs = require('node:fs')
const read = fs.readFileSync
const events = []
const ids = new WeakMap()
let nextId = 0
function id(value) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return null
  if (!ids.has(value)) ids.set(value, ++nextId)
  return ids.get(value)
}
global.__replacementBindingProbe = (operation, registry, key, value) => {
  events.push({ operation, registry: id(registry), key: id(key), value })
}
fs.readFileSync = function (path, ...args) {
  const source = read.call(this, path, ...args)
  if (typeof source !== 'string' || !String(path).replaceAll('\\', '/').endsWith('/lib/ai-gateway/flagship-replacement.ts')) return source
  events.push({ operation: 'module', path: String(path) })
  return source
    .replace('if (typeof model', "globalThis.__replacementBindingProbe('register', adapters, model, { type: typeof model, modelId: typeof model === 'object' ? model.modelId : null }); if (typeof model")
    .replace('if (model &&', "globalThis.__replacementBindingProbe('bind', providers, provider, { registered: !!model && typeof model !== 'string' && adapters.has(model), modelId }); if (model &&")
    .replace('return providers.get(provider) ?? null', "globalThis.__replacementBindingProbe('lookup', providers, provider, { present: providers.has(provider) }); return providers.get(provider) ?? null")
}
let networkAttempts = 0
const blocked = () => { networkAttempts++; throw new Error('OFFLINE_NETWORK_BLOCKED') }
global.fetch = blocked
require('node:http').request = blocked
require('node:http').get = blocked
require('node:https').request = blocked
require('node:https').get = blocked
require('node:net').Socket.prototype.connect = blocked
process.on('exit', () => {
  if (process.send) process.send({ events, networkAttempts })
})
