import { expect, it } from 'vitest'
import { performanceEvidence } from './performance-evidence.mjs'
const expected = { engineRevision: 'current', baseline: 'frozen', fixtures: [{ id: 'roof', hash: 'roof-input', sections: 1 }, { id: 'orthogonal-50', hash: 'large-input', sections: 50 }] }
const report = () => ({ engineRevision: 'current', baseline: 'frozen', samples: 100, measurements: expected.fixtures.map(fixture => ({
  id: fixture.id, inputSha256: fixture.hash, batchSize: 20, warmupCalculations: 1500, geometry: { sections: fixture.sections },
  old: { p50: 0.3, p95: 0.4 }, current: { p50: 0.4, p95: 0.5 }, passed: true,
  memory: { old: { peakRssKiB: 100000, samples: 100, signature: { canExportMaterials: true } }, current: { peakRssKiB: 120000, samples: 100, signature: { canExportMaterials: true } } },
})) })
it('requires current implementation and every required scene instead of accepting a previous small-scene success', () => {
  expect(performanceEvidence(report(), expected).accepted).toBe(true)
  const previous = report(); previous.engineRevision = 'old'
  expect(performanceEvidence(previous, expected).accepted).toBe(false)
  const incomplete = report(); incomplete.measurements.pop()
  expect(performanceEvidence(incomplete, expected).reasons).toContain('orthogonal-50: missing or changed input')
})
it('recomputes time and memory ceilings even if a report claims success with looser limits', () => {
  const time = report(); time.measurements[1].old = { p50: 100, p95: 120 }; time.measurements[1].current = { p50: 301, p95: 140 }
  time.measurements[1].limits = { p50: 1000, p95: 1000 }
  expect(performanceEvidence(time, expected).reasons).toContain('orthogonal-50: latency budget exceeded')
  const memory = report(); memory.measurements[0].memory.current.peakRssKiB = 300001
  expect(performanceEvidence(memory, expected).reasons).toContain('roof: peak memory budget exceeded')
})
it('rejects invalid early-exit drawings, changed inputs and incomplete memory samples', () => {
  const invalid = report(); invalid.measurements[0].memory.current.signature.canExportMaterials = false
  expect(performanceEvidence(invalid, expected).reasons).toContain('roof: invalid drawing used as benchmark')
  const changed = report(); changed.measurements[1].inputSha256 = 'different'
  expect(performanceEvidence(changed, expected).accepted).toBe(false)
  const short = report(); short.measurements[1].memory.current.samples = 10
  expect(performanceEvidence(short, expected).reasons).toContain('orthogonal-50: incomplete peak memory evidence')
})

it.each(['p50', 'p95', 'memory'])('uses the same strict threefold boundary for %s on small and large drawings', metric => {
  for (const ratio of [2.99, 3, 3.01]) {
    const sample = report()
    for (const item of sample.measurements) {
      item.old = { p50: 0.25, p95: 0.5 }
      item.current = { p50: 0.25, p95: 0.5 }
      if (metric === 'memory') item.memory.current.peakRssKiB = item.memory.old.peakRssKiB * ratio
      else item.current[metric] = item.old[metric] * ratio
    }
    expect(performanceEvidence(sample, expected).accepted).toBe(ratio < 3)
  }
})

it('excludes the user-rejected 200-section stress load without weakening other scene budgets', () => {
  const scope = {...expected, fixtures:[...expected.fixtures,{id:'orthogonal-200',hash:'stress',sections:200}]}
  expect(performanceEvidence(report(),scope).accepted).toBe(true)
  const sample=report()
  sample.measurements.push({...sample.measurements[1],id:'orthogonal-200',inputSha256:'stress',geometry:{sections:200},current:{p50:10000,p95:20000}})
  expect(performanceEvidence(sample,scope).accepted).toBe(true)
  expect(performanceEvidence(sample,scope).scenes).toEqual(['roof','orthogonal-50'])
  sample.measurements[1].current.p50=10000
  expect(performanceEvidence(sample,scope).reasons).toContain('orthogonal-50: latency budget exceeded')
})
