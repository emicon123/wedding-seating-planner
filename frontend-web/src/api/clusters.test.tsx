import { waitFor } from '@testing-library/react'
import { useClusterOverview } from '@/api/clusters'
import { MACIEK_FAMILY_OVERVIEW } from '@/test/builders'
import { HttpResponse, mockApi, single } from '@/test/server'
import { renderHookWithClient } from '@/test/wrapper'

describe('useClusterOverview', () => {
  it('returns clusters and warnings', async () => {
    mockApi('get', '/clusters', () => HttpResponse.json(single(MACIEK_FAMILY_OVERVIEW)))

    const { result } = renderHookWithClient(() => useClusterOverview())

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(MACIEK_FAMILY_OVERVIEW)
  })
})
