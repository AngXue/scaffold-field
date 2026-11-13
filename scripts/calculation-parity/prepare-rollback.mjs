import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
const root = resolve(import.meta.dirname, '../..')
const { baseline } = JSON.parse(readFileSync(resolve(root, 'fixtures/rules/manifest.json'), 'utf8'))
const directory = mkdtempSync(resolve(tmpdir(), 'scaffold-rollback-'))
const archive = execFileSync('git', ['archive', baseline, 'src', 'public', 'scripts', 'docs/fixtures', 'index.html',
  'vite.config.ts', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json'], { cwd: root, maxBuffer: 20 * 1024 * 1024 })
execFileSync('tar', ['-xf', '-', '-C', directory], { input: archive })
const hash = value => createHash('sha256').update(value).digest('hex')
const lockSha256 = hash(readFileSync(resolve(directory, 'package-lock.json')))
assert.equal(lockSha256, hash(readFileSync(resolve(root, 'package-lock.json'))), 'Rollback dependencies differ; use an independently installed frozen lockfile')
// The exact same dependency lock permits a read-only link. Never write the old
// checkout over the active repository, nor modify any existing browser storage.
symlinkSync(resolve(root, 'node_modules'), resolve(directory, 'node_modules'), 'dir')
execFileSync('npm', ['run', 'build'], { cwd: directory, stdio: 'inherit' })
const metadata = { baseline, directory, archiveSha256: hash(archive), lockSha256, node: process.version }
mkdirSync(resolve(root, 'artifacts/rule-migration'), { recursive: true })
writeFileSync(resolve(root, 'artifacts/rule-migration/rollback-build.json'), JSON.stringify(metadata, null, 2))
writeFileSync(resolve(directory, 'rollback-release.json'), JSON.stringify(metadata, null, 2))
execFileSync('tar', ['-czf', resolve(root, 'artifacts/rule-migration/rollback-release.tar.gz'), '-C', directory, 'dist', 'package-lock.json', 'rollback-release.json'])
console.log(JSON.stringify(metadata, null, 2))
