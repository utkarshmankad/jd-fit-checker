// Lets `node --experimental-strip-types` load app modules the same way the
// Next.js build does: `@/x` -> `src/x(.ts|.tsx)`, and extensionless relative
// imports -> `.ts`, and extensionless package subpaths (next/server) -> `.js`.
// Used only by the evaluation and unit-test commands.
import { existsSync, statSync } from 'node:fs'
import { registerHooks } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))

function firstFile(base) {
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    let file = null
    if (specifier.startsWith('@/')) {
      file = firstFile(path.join(root, 'src', specifier.slice(2)))
    } else if (/^\.\.?\//.test(specifier) && !path.extname(specifier) && context.parentURL?.startsWith('file:')) {
      file = firstFile(path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier))
    }
    if (file) return { url: pathToFileURL(file).href, shortCircuit: true }
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      // Packages without an "exports" map (e.g. next/server) need the extension
      // under Node's ESM resolver; bundlers add it implicitly.
      if (error?.code === 'ERR_MODULE_NOT_FOUND' && /^[a-z@][^:]*\/[^.]+$/i.test(specifier)) return nextResolve(`${specifier}.js`, context)
      throw error
    }
  },
})
