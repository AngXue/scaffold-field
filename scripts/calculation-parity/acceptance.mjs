import './loader.mjs'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { acceptanceEvidence } from './acceptance-evidence.mjs'
import { verificationFingerprint } from './verification-fingerprint.mjs'
import { ENGINE_REVISION } from '../../src/domain/rules/diagnostics/build.ts'
import { RULES } from '../../src/domain/rules/catalog.ts'
const root = resolve(import.meta.dirname, '../..')
const output = resolve(root, 'artifacts/rule-migration')
const read = name => JSON.parse(readFileSync(name, 'utf8'))
const current = { root, sourceFingerprint: verificationFingerprint(), engineRevision: ENGINE_REVISION, rules: RULES.map(rule => rule.id) }
const manifest = read(resolve(root, 'fixtures/rules/acceptance-matrix.json'))
mkdirSync(output, { recursive: true })
const rawPath = resolve(output, 'acceptance-vitest.json'), evidencePath = resolve(output, 'acceptance-tests.json')
if (!process.argv.includes('--check')) {
  // Remove an old report before spawning, so failed startup cannot reuse it.
  writeFileSync(rawPath, '{}\n')
  writeFileSync(evidencePath, JSON.stringify({ ...current, run: { success: false, testResults: [] } }))
  const run = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--reporter=json', `--outputFile=${rawPath}`], { cwd: root, stdio: 'inherit' })
  assert.equal(run.status, 0, 'Acceptance test runner failed')
  assert.equal(verificationFingerprint(), current.sourceFingerprint, 'Sources changed during test run')
  writeFileSync(evidencePath, JSON.stringify({ sourceFingerprint: current.sourceFingerprint, engineRevision: ENGINE_REVISION, run: read(rawPath) }, null, 2))
}
const browserArg = process.argv.find(arg => arg.startsWith('--browser-report='))
const browserPath = resolve(output, 'acceptance-browser.json')
if (browserArg) writeFileSync(browserPath, readFileSync(resolve(browserArg.slice('--browser-report='.length))))
const results = existsSync(evidencePath) ? read(evidencePath) : undefined
const browser = existsSync(browserPath) ? read(browserPath) : undefined
const evidence = acceptanceEvidence(manifest, results, browser, current)
writeFileSync(resolve(output, 'acceptance.json'), JSON.stringify({ ...current, ...evidence }, null, 2))
console.log(JSON.stringify(evidence, null, 2))
assert(process.argv.includes('--domain-only') ? evidence.domainAccepted : evidence.accepted, 'Acceptance matrix incomplete; inspect pending reasons')
