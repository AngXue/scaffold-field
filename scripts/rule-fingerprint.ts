import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
const root = resolve(import.meta.dirname, '..')
const destination = resolve(root, 'src/domain/rules/diagnostics/build.ts')
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name)
    return entry.isDirectory() ? files(path) : [path]
  })
}
export function ensureRuleFingerprint(checkOnly = false) {
  const sources = [...files(resolve(root, 'src/domain')).filter(path => path.endsWith('.ts') && !path.endsWith('.test.ts') && path !== destination),
    ...files(resolve(root, 'docs/fixtures')).filter(path => path.endsWith('.json')),
    resolve(root, 'package-lock.json'), resolve(root, 'scripts/rule-fingerprint.ts')].sort()
  const entries = sources.map(path => [relative(root, path), createHash('sha256').update(readFileSync(path)).digest('hex')])
  const revision = createHash('sha256').update(JSON.stringify(entries)).digest('hex')
  const generated = `/** Generated from all runtime domain sources, fixtures and locked dependencies. */\nexport const ENGINE_REVISION = '${revision}'\n`
  const previous = existsSync(destination) ? readFileSync(destination, 'utf8') : ''
  if (checkOnly && previous !== generated) throw new Error('Calculation implementation fingerprint is stale; run npm run rules:fingerprint')
  if (!checkOnly && previous !== generated) writeFileSync(destination, generated)
  return revision
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) ensureRuleFingerprint(process.argv.includes('--check'))
