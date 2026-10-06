// Lets `node --experimental-strip-types` load app modules the same way the
// Next.js build does: `@/x` -> `src/x(.ts|.tsx)`, and extensionless relative
// imports -> `.ts`. Used only by the evaluation and unit-test commands.
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
    return file ? { url: pathToFileURL(file).href, shortCircuit: true } : nextResolve(specifier, context)
  },
})
