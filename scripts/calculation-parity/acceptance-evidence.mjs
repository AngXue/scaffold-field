import assert from 'node:assert/strict'
import { relative, resolve } from 'node:path'

// These are the approved acceptance rows, not a list inferred from whatever a
// caller happened to include in its report. Removing a row cannot waive it.
export const REQUIRED_ACCEPTANCE = [
  ...Array.from({ length: 15 }, (_, i) => `T${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 8 }, (_, i) => `K${String(i + 1).padStart(2, '0')}`),
]

export function acceptanceEvidence(manifest, results, browser, current) {
  try {
    assert.equal(manifest.version, 1, 'Unknown matrix version')
    assert.deepEqual(manifest.rows.map(row => row.id).sort(), [...REQUIRED_ACCEPTANCE].sort(), 'Missing or duplicate acceptance row')
    assert.deepEqual([...new Set(manifest.rows.flatMap(row => row.rules))].sort(), [...current.rules].sort(), 'Rule coverage differs')
    assert.equal(results.sourceFingerprint, current.sourceFingerprint, 'Stale test sources or fixtures')
    assert.equal(results.engineRevision, current.engineRevision, 'Stale test engine')
    const run = results.run
    assert.equal(run.success, true, 'Test run failed')
    assert.equal(run.numFailedTests, 0, 'Failed tests')
    assert.equal(run.numPendingTests, 0, 'Skipped tests')
    assert.equal(run.numTodoTests, 0, 'Todo tests')
    assert(run.testResults.length > 0, 'Missing runner results')
    const files = new Map()
    let tested = 0
    for (const file of run.testResults) {
      const path = relative(current.root, resolve(current.root, file.name)).replaceAll('\\', '/')
      assert(!path.startsWith('../') && !files.has(path), 'Duplicate or external test file')
      assert.equal(file.status, 'passed', `Test file failed: ${path}`)
      const titles = new Map()
      for (const test of file.assertionResults) {
        assert.equal(test.status, 'passed', `Test did not pass: ${path}: ${test.title}`)
        titles.set(test.title, (titles.get(test.title) ?? 0) + 1)
        tested++
      }
      files.set(path, titles)
    }
    assert.equal(tested, run.numTotalTests, 'Test result count differs')
    assert.equal(tested, run.numPassedTests, 'Passed count differs')
    const rows = manifest.rows.map(row => {
      assert(row.title && row.assertions.length > 0, `${row.id}: missing assertions`)
      const references = new Set()
      for (const test of row.assertions) {
        assert(Number.isInteger(test.count) && test.count > 0, `${row.id}: invalid assertion count`)
        const key = JSON.stringify([test.file, test.title])
        assert(!references.has(key), `${row.id}: duplicate assertion`)
        references.add(key)
        assert.equal(files.get(test.file)?.get(test.title), test.count, `${row.id}: missing assertion ${test.title}`)
      }
      return { id: row.id, assertions: row.assertions.reduce((sum, test) => sum + test.count, 0), passed: true }
    })
    // Domain tests do not prove real browser exports. Without current browser
    // evidence T14 remains explicitly pending, even if all 23 domain rows pass.
    const pending = []
    if (!browser) pending.push('T14 current production browser exports and tablet layout')
    else {
      assert.equal(browser.status, 'passed', 'Browser run failed')
      assert.equal(browser.engineRevision, current.engineRevision, 'Stale served browser engine')
      assert.equal(browser.sourceFingerprint, current.sourceFingerprint, 'Stale browser sources')
      assert.equal(manifest.browserChecks.length, 11, 'Browser coverage differs')
      assert.deepEqual(browser.checks, manifest.browserChecks, 'Missing browser flows')
    }
    return { accepted: pending.length === 0, domainAccepted: true, tests: tested, rows, pending }
  } catch (error) {
    return { accepted: false, domainAccepted: false, rows: [], pending: [error.message] }
  }
}
