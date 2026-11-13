import { it, expect } from 'vitest'
import { ROLLBACK_CASES, rollbackEvidence } from './rollback-evidence.mjs'
const current = { baseline: 'old', engineRevision: 'new', sourceFingerprint: 'sources', bundles: { current: 'bundle-new', frozen: 'bundle-old' } }
const fixture = () => ({ ...current, status: 'passed', build: { baseline: 'old' }, checks: ROLLBACK_CASES.map(id => ({ id, passed: true,
  versions: ['current', 'frozen', 'restored'], defaultVersions: ['current', 'frozen', 'restored'] })) })
it('accepts only the complete saved-project and default-project rollback for the delivered builds', () => {
  expect(rollbackEvidence(fixture(), current).accepted).toBe(true)
})
it('rejects missing, stale, partial or failed rollback evidence despite a passed headline', () => {
  const bad = [undefined, { ...fixture(), engineRevision: 'stale' }, { ...fixture(), sourceFingerprint: 'stale' },
    { ...fixture(), baseline: 'wrong' }, { ...fixture(), bundles: { ...current.bundles, current: 'stale' } },
    { ...fixture(), checks: fixture().checks.slice(1) }, { ...fixture(), status: 'failed' }]
  for (const patch of [{ passed: false }, { versions: ['current', 'frozen'] }, { defaultVersions: ['current'] }, { id: 'unknown' }]) {
    const report = fixture(); report.checks[0] = { ...report.checks[0], ...patch }; bad.push(report)
  }
  for (const report of bad) expect(rollbackEvidence(report, current).accepted).toBe(false)
})
