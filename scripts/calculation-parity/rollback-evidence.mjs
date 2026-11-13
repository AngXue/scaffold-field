import assert from 'node:assert/strict'
export const ROLLBACK_CASES = ['roof', 'stack', 'corridor-independent', 'adjacent-houses', 'narrow', 'legacy']
export function rollbackEvidence(report, current) {
  try {
    assert.equal(report?.status, 'passed', 'Missing successful rollback run')
    for (const key of ['baseline', 'engineRevision', 'sourceFingerprint']) assert.equal(report[key], current[key], `Stale rollback ${key}`)
    assert.deepEqual(report.bundles, current.bundles, 'Rollback build differs from delivered build')
    assert.equal(report.build.baseline, current.baseline, 'Wrong rollback baseline')
    assert.equal(report.checks.length, ROLLBACK_CASES.length, 'Missing rollback cases')
    assert.deepEqual(report.checks.map(check => check.id).sort(), [...ROLLBACK_CASES].sort(), 'Wrong rollback cases')
    for (const check of report.checks) {
      assert.equal(check.passed, true, `Failed rollback case: ${check.id}`)
      assert.deepEqual(check.versions, ['current', 'frozen', 'restored'], `Incomplete saved project round trip: ${check.id}`)
      assert.deepEqual(check.defaultVersions, ['current', 'frozen', 'restored'], `Incomplete default project round trip: ${check.id}`)
    }
    return { accepted: true, cases: report.checks.length, pending: [] }
  } catch (error) { return { accepted: false, pending: [error.message] } }
}
