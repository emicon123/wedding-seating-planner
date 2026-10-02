import { useQuery } from '@tanstack/react-query'
import { client, unwrap } from '@/api/client'
import { keys } from '@/api/keys'
import type { ClusterOverview } from '@/domain/types'

export function useClusterOverview() {
  return useQuery({
    queryKey: keys.clusters,
    queryFn: async (): Promise<ClusterOverview> => (await unwrap(client.GET('/clusters'))).data,
  })
}
