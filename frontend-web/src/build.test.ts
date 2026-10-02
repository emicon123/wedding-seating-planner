// @vitest-environment node
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'vite'

describe('production build', () => {
  it('references every asset under /wesele/assets/', { timeout: 120_000 }, async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), 'stoliki-build-'))
    try {
      await build({ logLevel: 'silent', build: { outDir, emptyOutDir: true } })
      const html = await readFile(path.join(outDir, 'index.html'), 'utf8')
      const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1] ?? '')
      const assetRefs = refs.filter((r) => r.includes('/assets/'))

      expect(assetRefs.length).toBeGreaterThan(0)
      for (const ref of assetRefs) expect(ref.startsWith('/wesele/assets/')).toBe(true)
      // nothing is root-absolute outside the prefix
      for (const ref of refs.filter((r) => r.startsWith('/'))) {
        expect(ref.startsWith('/wesele/')).toBe(true)
      }
      expect((await readdir(path.join(outDir, 'assets'))).length).toBeGreaterThan(0)
    } finally {
      await rm(outDir, { recursive: true, force: true })
    }
  })
})
