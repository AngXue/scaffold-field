/** Evidence must describe the current implementation and all required fixtures.
 * Recompute ceilings from the approved policy instead of trusting a stored
 * `passed` flag or stored limits. This is also used by the final migration gate.
 */
export function performanceEvidence(report, expected) {
  const reasons = []
  if (!report || report.engineRevision !== expected.engineRevision) reasons.push('implementation fingerprint differs or report missing')
  if (report?.baseline !== expected.baseline) reasons.push('baseline differs')
  if (!(report?.samples >= 100)) reasons.push('fewer than 100 paired samples')
  const measurements = report?.measurements ?? []
  if (new Set(measurements.map(item => item.id)).size !== measurements.length) reasons.push('duplicate scene measurements')
  const positive = value => Number.isFinite(value) && value > 0
  for (const fixture of expected.fixtures) {
    const item = measurements.find(item => item.id === fixture.id)
    if (!item || item.inputSha256 !== fixture.hash) { reasons.push(`${fixture.id}: missing or changed input`); continue }
    if (![item.old?.p50, item.old?.p95, item.current?.p50, item.current?.p95].every(positive)) {
      reasons.push(`${fixture.id}: invalid latency values`); continue
    }
    const small = item.old.p50 < 1
    const p50Limit = small ? item.old.p50 + 0.25 : item.old.p50 * 1.20
    const p95Limit = small ? item.old.p95 + 0.5 : item.old.p95 * 1.25
    if (item.current.p50 > p50Limit || item.current.p95 > p95Limit) reasons.push(`${fixture.id}: latency budget exceeded`)
    if (fixture.id === 'roof' && (!(item.batchSize >= 20) || !(item.warmupCalculations >= 1500))) reasons.push('roof: insufficient batched measurement')
    if (item.geometry?.sections !== fixture.sections) reasons.push(`${fixture.id}: incorrect scene size`)
    const memory = item.memory
    if (![memory?.old?.peakRssKiB, memory?.current?.peakRssKiB].every(positive)
      || !(memory?.old?.samples >= 100 && memory?.current?.samples >= 100)) reasons.push(`${fixture.id}: incomplete peak memory evidence`)
    else if (memory.current.peakRssKiB > memory.old.peakRssKiB * 1.25) reasons.push(`${fixture.id}: peak memory budget exceeded`)
    if (!memory?.old?.signature?.canExportMaterials || !memory?.current?.signature?.canExportMaterials) reasons.push(`${fixture.id}: invalid drawing used as benchmark`)
  }
  return { accepted: reasons.length === 0, reasons, scenes: expected.fixtures.map(fixture => fixture.id) }
}
