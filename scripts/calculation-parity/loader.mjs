import { registerHooks } from 'node:module'
import { readFileSync } from 'node:fs'
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.endsWith('?raw')) return { url: new URL(specifier, context.parentURL).href, shortCircuit: true }
    try { return next(specifier, context) } catch (error) {
      if (specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier)) return next(specifier + '.ts', context)
      throw error
    }
  },
  load(url, context, next) {
    if (url.endsWith('?raw')) return { format: 'module', source: `export default ${JSON.stringify(readFileSync(new URL(url.slice(0, -4)), 'utf8'))}`, shortCircuit: true }
    return next(url, context)
  },
})
