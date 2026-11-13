import { expect, it } from 'vitest'
import { acceptanceEvidence, REQUIRED_ACCEPTANCE } from './acceptance-evidence.mjs'
const current = { root: '/repo', rules: ['S01'], sourceFingerprint: 'sources', engineRevision: 'engine' }
function fixture() {
  const manifest = { version: 1, rows: REQUIRED_ACCEPTANCE.map(id => ({ id, title: id, rules: ['S01'], assertions: [{ file: 'test.ts', title: 'actual check', count: 1 }] })),
    browserChecks: Array.from({ length: 11 }, (_, i) => `flow ${i}`) }
  const results = { sourceFingerprint: 'sources', engineRevision: 'engine', run: { success: true, numTotalTests: 1, numPassedTests: 1,
    numFailedTests: 0, numPendingTests: 0, numTodoTests: 0, testResults: [{ name: '/repo/test.ts', status: 'passed', assertionResults: [{ title: 'actual check', status: 'passed' }] }] } }
  const browser = { status: 'passed', sourceFingerprint: 'sources', engineRevision: 'engine', checks: [...manifest.browserChecks] }
  return { manifest, results, browser }
}
it('accepts each fixed row only with actual passed assertions and a matching served-browser version', () => {
  const { manifest, results, browser } = fixture()
  const outcome = acceptanceEvidence(manifest, results, browser, current)
  expect(outcome.accepted).toBe(true)
  expect(outcome.rows).toHaveLength(23)
  expect(outcome.tests).toBe(1)
})
it('leaves T14 pending without browser evidence even when all domain assertions pass', () => {
  const { manifest, results } = fixture()
  expect(acceptanceEvidence(manifest, results, undefined, current)).toMatchObject({ accepted: false, domainAccepted: true,
    pending: ['T14 current production browser exports and tablet layout'] })
})
it.each(['missing-row', 'duplicate-row', 'missing-rule', 'unknown-rule', 'empty-assertions', 'absent-test', 'wrong-count', 'duplicate-assertion',
  'runner-failed', 'test-failed', 'test-skipped', 'todo', 'fake-total', 'missing-file', 'duplicate-file', 'external-file',
  'stale-source', 'stale-engine', 'stale-browser', 'stale-browser-source', 'missing-browser-flow', 'browser-failed'])('rejects %s despite claimed passed results', kind => {
  const f = fixture(), row = f.manifest.rows[0], run = f.results.run
  if (kind === 'missing-row') f.manifest.rows.pop()
  if (kind === 'duplicate-row') f.manifest.rows[1].id = row.id
  if (kind === 'missing-rule') f.manifest.rows.forEach(row => { row.rules = [] })
  if (kind === 'unknown-rule') row.rules.push('UNKNOWN')
  if (kind === 'empty-assertions') row.assertions = []
  if (kind === 'absent-test') row.assertions[0].title = 'not executed'
  if (kind === 'wrong-count') row.assertions[0].count = 2
  if (kind === 'duplicate-assertion') row.assertions.push({ ...row.assertions[0] })
  if (kind === 'runner-failed') run.success = false
  if (kind === 'test-failed') run.testResults[0].assertionResults[0].status = 'failed'
  if (kind === 'test-skipped') run.testResults[0].assertionResults[0].status = 'skipped'
  if (kind === 'todo') run.numTodoTests = 1
  if (kind === 'fake-total') run.numPassedTests = 99
  if (kind === 'missing-file') run.testResults = []
  if (kind === 'duplicate-file') run.testResults.push({ ...run.testResults[0] })
  if (kind === 'external-file') run.testResults[0].name = '/another/test.ts'
  if (kind === 'stale-source') f.results.sourceFingerprint = 'old'
  if (kind === 'stale-engine') f.results.engineRevision = 'old'
  if (kind === 'stale-browser') f.browser.engineRevision = 'old'
  if (kind === 'stale-browser-source') f.browser.sourceFingerprint = 'old'
  if (kind === 'missing-browser-flow') f.browser.checks.pop()
  if (kind === 'browser-failed') f.browser.status = 'failed'
  expect(acceptanceEvidence(f.manifest, f.results, f.browser, current).accepted).toBe(false)
})

it('keeps fresh domain results usable while an old browser report remains pending', () => {
  const { manifest, results, browser } = fixture()
  browser.sourceFingerprint = 'previous sources'
  const outcome = acceptanceEvidence(manifest, results, browser, current)
  expect(outcome.domainAccepted).toBe(true)
  expect(outcome.accepted).toBe(false)
  expect(outcome.rows).toHaveLength(23)
  expect(outcome.pending[0]).toMatch(/T14: Stale browser sources/)
})
