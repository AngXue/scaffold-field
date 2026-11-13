// User-confirmed on 2026-11-13: exactly threefold and above is over budget.
export const PERFORMANCE_POLICY = Object.freeze({ id: '2026-11-13-representative-under-threefold', maxRatioExclusive: 3,
  excludedSceneIds: Object.freeze(['orthogonal-200']) })
// User excludes the unrealistic 200-section load from performance, not correctness.
export const isPerformanceScene = id => !PERFORMANCE_POLICY.excludedSceneIds.includes(id)

/** Evidence must describe the current implementation and all required fixtures.
 * Recompute ceilings from the approved policy instead of trusting a stored
 * `passed` flag or stored limits. This is also used by the final migration gate.
 */
export function performanceEvidence(report, expected) {
  const reasons = []
  if (!report || report.engineRevision !== expected.engineRevision) reasons.push('implementation fingerprint differs or report missing')
  if (report?.baseline !== expected.baseline) reasons.push('baseline differs')
  if (!(report?.samples >= 100)) reasons.push('fewer than 100 paired samples')
  const fixtures = expected.fixtures.filter(fixture => isPerformanceScene(fixture.id))
  const measurements = (report?.measurements ?? []).filter(item => isPerformanceScene(item.id))
  if (new Set(measurements.map(item => item.id)).size !== measurements.length) reasons.push('duplicate scene measurements')
  const positive = value => Number.isFinite(value) && value > 0
  for (const fixture of fixtures) {
    const item = measurements.find(item => item.id === fixture.id)
    if (!item || item.inputSha256 !== fixture.hash) { reasons.push(`${fixture.id}: missing or changed input`); continue }
    if (![item.old?.p50, item.old?.p95, item.current?.p50, item.current?.p95].every(positive)) {
      reasons.push(`${fixture.id}: invalid latency values`); continue
    }
    if (item.current.p50 / item.old.p50 >= PERFORMANCE_POLICY.maxRatioExclusive
      || item.current.p95 / item.old.p95 >= PERFORMANCE_POLICY.maxRatioExclusive) reasons.push(`${fixture.id}: latency budget exceeded`)
    if (fixture.id === 'roof' && (!(item.batchSize >= 20) || !(item.warmupCalculations >= 1500))) reasons.push('roof: insufficient batched measurement')
    if (item.geometry?.sections !== fixture.sections) reasons.push(`${fixture.id}: incorrect scene size`)
    const memory = item.memory
    if (![memory?.old?.peakRssKiB, memory?.current?.peakRssKiB].every(positive)
      || !(memory?.old?.samples >= 100 && memory?.current?.samples >= 100)) reasons.push(`${fixture.id}: incomplete peak memory evidence`)
    else if (memory.current.peakRssKiB / memory.old.peakRssKiB >= PERFORMANCE_POLICY.maxRatioExclusive) reasons.push(`${fixture.id}: peak memory budget exceeded`)
    if (!memory?.old?.signature?.canExportMaterials || !memory?.current?.signature?.canExportMaterials) reasons.push(`${fixture.id}: invalid drawing used as benchmark`)
  }
  return { accepted: reasons.length === 0, policy: PERFORMANCE_POLICY, reasons, scenes: fixtures.map(fixture => fixture.id) }
}
