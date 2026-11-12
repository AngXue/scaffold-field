import './loader.mjs'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
const root = resolve(import.meta.dirname, '../..')
const manifest = JSON.parse(readFileSync(resolve(root, 'fixtures/rules/manifest.json'), 'utf8'))
const temporary = mkdtempSync(resolve(tmpdir(), 'scaffold-parity-'))
const reportDirectory = resolve(root, 'artifacts/rule-migration')
mkdirSync(reportDirectory, { recursive: true })
const hash = value => createHash('sha256').update(value).digest('hex')
try {
  const archive = execFileSync('git', ['archive', manifest.baseline, 'src/domain', 'docs/fixtures', 'package.json'], { cwd: root, maxBuffer: 20 * 1024 * 1024 })
  assert.equal(hash(archive), manifest.archiveSha256, 'Frozen source archive changed')
  execFileSync('tar', ['-xf', '-', '-C', temporary], { input: archive })
  const old = await import(pathToFileURL(resolve(temporary, 'src/domain/site.ts')))
  const current = await import(pathToFileURL(resolve(root, 'src/domain/site.ts')))
  if (process.argv.includes('--bench')) {
    const measurements = []
    for (const id of ['roof', 'corridor', 'adjacent-houses', 'wall-stroke']) {
      const input = JSON.parse(readFileSync(resolve(root, `fixtures/rules/${id}.json`), 'utf8'))
      for (let i = 0; i < 10; i++) { old.calculateSite(input.scene, input.parameters); current.calculateSite(input.scene, input.parameters) }
      const samples = [[], []], engines = [old, current]
      for (let i = 0; i < 100; i++) for (const index of i % 2 ? [1, 0] : [0, 1]) {
        const start = performance.now()
        engines[index].calculateSite(input.scene, input.parameters)
        samples[index].push(performance.now() - start)
      }
      const stats = samples.map(values => { values.sort((a, b) => a - b); return { p50: values[49], p95: values[94] } })
      measurements.push({ id, old: stats[0], current: stats[1], ratioP50: stats[1].p50 / stats[0].p50, ratioP95: stats[1].p95 / stats[0].p95 })
    }
    const report = { node: process.version, platform: process.platform, arch: process.arch, samples: 100,
      scope: 'paired latency only; memory and large-scene acceptance still pending', measurements }
    writeFileSync(resolve(reportDirectory, 'latency.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
  }
  const differences = [], passed = []
  for (const id of manifest.cases) {
    const text = readFileSync(resolve(root, `fixtures/rules/${id}.json`), 'utf8')
    assert.equal(hash(text), manifest.inputs[id], `${id}: frozen input changed`)
    const input = JSON.parse(text)
    const before = JSON.stringify(input)
    const original = old.calculateSite(input.scene, input.parameters)
    assert.equal(JSON.stringify(input), before, `${id}: baseline mutated input`)
    const result = current.calculateSite(input.scene, input.parameters)
    assert.equal(JSON.stringify(input), before, `${id}: candidate mutated input`)
    // JSON is the existing export boundary. Compare every field, including geometry,
    // references, warnings, issues, quantities and optional/unknown values.
    const baseline = JSON.parse(JSON.stringify(original)), candidate = JSON.parse(JSON.stringify(result))
    assert.equal(hash(JSON.stringify(baseline)), manifest.outputs[id], `${id}: old-engine replay drift`)
    try { assert.deepEqual(candidate, baseline); passed.push(id) }
    catch {
      const fields = [...new Set([...Object.keys(baseline), ...Object.keys(candidate)])].filter(key => {
        try { assert.deepEqual(candidate[key], baseline[key]); return false } catch { return true }
      })
      differences.push({ id, fields })
      writeFileSync(resolve(reportDirectory, `${id}-before.json`), JSON.stringify(baseline))
      writeFileSync(resolve(reportDirectory, `${id}-after.json`), JSON.stringify(candidate))
    }
  }
  writeFileSync(resolve(reportDirectory, 'differences.json'), JSON.stringify({ baseline: manifest.baseline, passed, differences }, null, 2))
  console.log(JSON.stringify({ baseline: manifest.baseline, passed: passed.length, differences }, null, 2))
  assert.equal(differences.length, 0, 'Calculation parity failed; inspect artifacts/rule-migration')
} finally { rmSync(temporary, { recursive: true, force: true }) }
