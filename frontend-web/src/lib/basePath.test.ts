import { API_BASE, BASE_PATH } from '@/lib/basePath'

describe('base path', () => {
  it('serves everything under /wesele (single source: Vite base)', () => {
    expect(BASE_PATH).toBe('/wesele')
    expect(API_BASE).toBe('/wesele/api')
  })
})
