import './loader.mjs'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'

// Each engine has its own process, imports and heap. The OS high-water RSS is
// a real process peak, not an end-of-call heap sample presented as a peak.
const [enginePath, inputPath] = process.argv.slice(2)
assert(enginePath && inputPath && typeof globalThis.gc === 'function')
const engine = await import(pathToFileURL(enginePath))
const input = JSON.parse(readFileSync(inputPath, 'utf8'))
const before = JSON.stringify(input)
for (let i = 0; i < 10; i++) engine.calculateSite(input.scene, input.parameters)
globalThis.gc()
const startingHeapBytes = process.memoryUsage().heapUsed
let maximumEndOfCallHeapBytes = 0, signature
const start = performance.now()
for (let i = 0; i < 100; i++) {
  globalThis.gc()
  const layout = engine.calculateSite(input.scene, input.parameters)
  maximumEndOfCallHeapBytes = Math.max(maximumEndOfCallHeapBytes, process.memoryUsage().heapUsed)
  signature = { pipes: layout.pipeSegments.length, connectors: layout.connectors.length, bases: layout.baseChannels.length,
    decks: layout.decks.length, actualLength: layout.materials.actualLength, canExportMaterials: layout.canExportMaterials }
}
assert.equal(JSON.stringify(input), before)
process.stdout.write(JSON.stringify({ samples: 100, warmupCalculations: 10, peakRssKiB: process.resourceUsage().maxRSS,
  startingHeapBytes, maximumEndOfCallHeapBytes, durationMs: performance.now() - start, signature }))
