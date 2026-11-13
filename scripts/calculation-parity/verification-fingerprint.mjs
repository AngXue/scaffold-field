import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
const root = resolve(import.meta.dirname, '../..')
export function verificationFingerprint() {
  const walk = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name)
    return entry.isDirectory() ? walk(path) : [path]
  })
  const paths = [...walk(resolve(root, 'src')), ...walk(resolve(root, 'scripts')), ...walk(resolve(root, 'fixtures')),
    ...walk(resolve(root, 'docs/fixtures')), ...walk(resolve(root, '.github/workflows')), ...['package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.app.json'].map(file => resolve(root, file))].sort()
  return createHash('sha256').update(JSON.stringify(paths.map(path => [relative(root, path),
    createHash('sha256').update(readFileSync(path)).digest('hex')]))).digest('hex')
}
