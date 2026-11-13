import './loader.mjs'
import { compareApprovedDirection } from './approved-direction.mjs'
import { PERFORMANCE_POLICY, isPerformanceScene } from './performance-evidence.mjs'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
const root = resolve(import.meta.dirname, '../..')
const manifest = JSON.parse(readFileSync(resolve(root, 'fixtures/rules/manifest.json'), 'utf8'))
const large = JSON.parse(readFileSync(resolve(root, 'fixtures/rules/performance/manifest.json'), 'utf8'))
assert.equal(large.baseline, manifest.baseline, 'Large-scene baseline differs')
const directionApproval = JSON.parse(readFileSync(resolve(root, 'fixtures/rules/approved-stock-direction.json'), 'utf8'))
assert.equal(directionApproval.baseline, manifest.baseline, 'Approved change baseline differs')
const cases = [
  ...manifest.cases.map(id => ({ id, path: resolve(root, `fixtures/rules/${id}.json`), input: manifest.inputs[id], output: manifest.outputs[id] })),
  ...large.cases.map(id => ({ id, path: resolve(root, `fixtures/rules/performance/${id}.json`), input: large.inputs[id], output: large.outputs[id] })),
]
const memory = (enginePath, inputPath) => new Promise((done, reject) => {
  const child = spawn(process.execPath, ['--expose-gc', resolve(root, 'scripts/calculation-parity/memory-worker.mjs'), enginePath, inputPath], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = '', errors = ''
  child.stdout.on('data', chunk => { output += chunk })
  child.stderr.on('data', chunk => { errors += chunk })
  child.on('error', reject)
  child.on('close', code => {
    if (code !== 0) return reject(new Error(`Memory worker exited ${code}: ${errors}`))
    try { done(JSON.parse(output)) } catch (error) { reject(error) }
  })
})
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
  const { ENGINE_REVISION: engineRevision } = await import(pathToFileURL(resolve(root, 'src/domain/rules/diagnostics/build.ts')))
  if (process.argv.includes('--bench')) {
    const measurements = []
    for (const id of ['roof', 'corridor', 'adjacent-houses', 'wall-stroke', ...large.cases].filter(isPerformanceScene)) {
      const fixture = cases.find(item => item.id === id)
      const inputText = readFileSync(fixture.path, 'utf8')
      assert.equal(hash(inputText), fixture.input, `${id}: frozen benchmark input changed`)
      const input = JSON.parse(inputText)
      const before = JSON.stringify(input)
      const oldResult = old.calculateSite(input.scene, input.parameters), currentResult = current.calculateSite(input.scene, input.parameters)
      assert(oldResult.canExportMaterials && currentResult.canExportMaterials, `${id}: benchmark must be a calculable project`)
      assert.equal(hash(JSON.stringify(oldResult)), fixture.output, `${id}: baseline output drift`)
      compareApprovedDirection(JSON.parse(JSON.stringify(oldResult)), JSON.parse(JSON.stringify(currentResult)), fixture, directionApproval)
      const batchSize = id === 'roof' ? 20 : 1, warmupCalculations = id === 'roof' ? 1500 : 10
      for (let i = 0; i < warmupCalculations; i++) { old.calculateSite(input.scene, input.parameters); current.calculateSite(input.scene, input.parameters) }
      const samples = [[], []], engines = [old, current]
      for (let i = 0; i < 100; i++) for (const index of i % 2 ? [1, 0] : [0, 1]) {
        const start = performance.now()
        for (let repeat = 0; repeat < batchSize; repeat++) engines[index].calculateSite(input.scene, input.parameters)
        samples[index].push((performance.now() - start) / batchSize)
      }
      const stats = samples.map(values => { values.sort((a, b) => a - b); return { p50: values[49], p95: values[94] } })
      // User-confirmed strict ceiling; measurement protocol and exact parity stay unchanged.
      const limits = { p50: stats[0].p50 * PERFORMANCE_POLICY.maxRatioExclusive, p95: stats[0].p95 * PERFORMANCE_POLICY.maxRatioExclusive, exclusive: true }
      measurements.push({ id, batchSize, warmupCalculations, inputSha256: fixture.input, old: stats[0], current: stats[1],
        ratioP50: stats[1].p50 / stats[0].p50, ratioP95: stats[1].p95 / stats[0].p95, limits,
        passed: stats[1].p50 / stats[0].p50 < PERFORMANCE_POLICY.maxRatioExclusive && stats[1].p95 / stats[0].p95 < PERFORMANCE_POLICY.maxRatioExclusive,
        geometry: { sections: input.scene.sections.length, members: currentResult.members.length, pipes: currentResult.pipeSegments.length, decks: currentResult.decks.length } })
      assert.equal(JSON.stringify(input), before, `${id}: benchmark mutated input`)
      const oldMemory = await memory(resolve(temporary, 'src/domain/site.ts'), fixture.path)
      const currentMemory = await memory(resolve(root, 'src/domain/site.ts'), fixture.path)
      assert.deepEqual(currentMemory.signature, oldMemory.signature, `${id}: memory worker output differs`)
      const measurement = measurements.at(-1)
      measurement.memory = { method: 'isolated process OS high-water RSS; 10 warmups and 100 calculations with GC before each measured call',
        old: oldMemory, current: currentMemory, ratioPeakRss: currentMemory.peakRssKiB / oldMemory.peakRssKiB, limitRatio: PERFORMANCE_POLICY.maxRatioExclusive, exclusive: true,
        passed: currentMemory.peakRssKiB / oldMemory.peakRssKiB < PERFORMANCE_POLICY.maxRatioExclusive }
      measurement.passed &&= measurement.memory.passed
      console.log(JSON.stringify({ completed: id, passed: measurement.passed, ratioP50: measurement.ratioP50, ratioP95: measurement.ratioP95, ratioPeakRss: measurement.memory.ratioPeakRss }))
    }
    const report = { performancePolicy: PERFORMANCE_POLICY, engineRevision, baseline: manifest.baseline, generatedAt: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch, samples: 100,
      scope: 'paired latency and isolated-process peak RSS for representative small, 50-section and multi-elevation projects; 200-section performance excluded by user', measurements }
    writeFileSync(resolve(reportDirectory, 'latency.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
    assert(measurements.every(measurement => measurement.passed), 'Latency or memory budget exceeded; inspect artifacts/rule-migration/latency.json')
  }
  const differences = [], passed = [], approvedChanges = []
  for (const fixture of cases) {
    const { id } = fixture
    const text = readFileSync(fixture.path, 'utf8')
    assert.equal(hash(text), fixture.input, `${id}: frozen input changed`)
    const input = JSON.parse(text)
    const before = JSON.stringify(input)
    const original = old.calculateSite(input.scene, input.parameters)
    assert.equal(JSON.stringify(input), before, `${id}: baseline mutated input`)
    const result = current.calculateSite(input.scene, input.parameters)
    assert.equal(JSON.stringify(input), before, `${id}: candidate mutated input`)
    // JSON is the existing export boundary. Compare every field, including geometry,
    // references, warnings, issues, quantities and optional/unknown values.
    const baseline = JSON.parse(JSON.stringify(original)), candidate = JSON.parse(JSON.stringify(result))
    assert.equal(hash(JSON.stringify(baseline)), fixture.output, `${id}: old-engine replay drift`)
    try {
      const members = compareApprovedDirection(baseline, candidate, fixture, directionApproval)
      if (members.length) approvedChanges.push({ id, approval: directionApproval.id, members })
      passed.push(id)
    }
    catch {
      const fields = [...new Set([...Object.keys(baseline), ...Object.keys(candidate)])].filter(key => {
        try { assert.deepEqual(candidate[key], baseline[key]); return false } catch { return true }
      })
      differences.push({ id, fields })
      writeFileSync(resolve(reportDirectory, `${id}-before.json`), JSON.stringify(baseline))
      writeFileSync(resolve(reportDirectory, `${id}-after.json`), JSON.stringify(candidate))
    }
  }
  writeFileSync(resolve(reportDirectory, 'differences.json'), JSON.stringify({ engineRevision, generatedAt: new Date().toISOString(), baseline: manifest.baseline, passed, approvedChanges, differences }, null, 2))
  console.log(JSON.stringify({ baseline: manifest.baseline, passed: passed.length, approvedChanges, differences }, null, 2))
  assert.equal(differences.length, 0, 'Calculation parity failed; inspect artifacts/rule-migration')
} finally { rmSync(temporary, { recursive: true, force: true }) }
