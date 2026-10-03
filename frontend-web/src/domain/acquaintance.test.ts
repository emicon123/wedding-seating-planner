import { familyReach, reachStatus } from '@/domain/acquaintance'
import type { Cluster, Guest } from '@/domain/types'
import { makeCluster, makeGuest, makeOverview } from '@/test/builders'

/** `size` adults named after the cluster (id = key * 100 + n), as one family. */
function family(key: number, name: string, size: number, children = 0) {
  const ids = Array.from({ length: size + children }, (_, i) => key * 100 + i)
  const guests = ids.map((id, i) =>
    makeGuest({ id, firstName: i === 0 ? name : `${name}${i}`, isChild: i >= size }),
  )
  return { guests, ids }
}

type Spec = { key: number; name: string; size: number; children?: number; links?: number[] }

function build(specs: Spec[]): { guests: Guest[]; clusters: Cluster[] } {
  const guests: Guest[] = []
  const clusters: Cluster[] = []
  for (const spec of specs) {
    const { guests: members, ids } = family(spec.key, spec.name, spec.size, spec.children ?? 0)
    guests.push(...members)
    clusters.push(
      makeCluster({
        key: spec.key,
        guestIds: ids,
        affinities: (spec.links ?? []).map((clusterKey) => ({ clusterKey, level: 1 as const })),
      }),
    )
  }
  return { guests, clusters }
}

function reachOf(specs: Spec[]) {
  const { guests, clusters } = build(specs)
  return familyReach(guests, makeOverview(clusters))
}
const byKey = (rows: ReturnType<typeof reachOf>, key: number) =>
  rows.find((row) => row.clusterKey === key)!

describe('reachStatus', () => {
  it.each([
    [1, 'none'],
    [7, 'none'],
    [8, 'partial'],
    [11, 'partial'],
    [12, 'ok'],
    [30, 'ok'],
  ] as const)('reach %i is %s', (reach, expected) => {
    expect(reachStatus(reach)).toBe(expected)
  })
})

describe('familyReach', () => {
  it('a triangle of 3 + 3 + 3 reaches 9 for everyone', () => {
    const rows = reachOf([
      { key: 1, name: 'Ala', size: 3, links: [2, 3] },
      { key: 2, name: 'Basia', size: 3, links: [1, 3] },
      { key: 3, name: 'Cela', size: 3, links: [1, 2] },
    ])
    expect(rows.map((row) => row.reach)).toEqual([9, 9, 9])
    expect(rows.every((row) => row.status === 'partial')).toBe(true)
    expect(byKey(rows, 1).knownPeople).toBe(8) // 3 - 1 + 3 + 3
    expect(byKey(rows, 1).groupKeys).toEqual([2, 3])
  })

  it('a path A-B-C (A and C strangers): B reaches the heavier pair, not all three', () => {
    const rows = reachOf([
      { key: 1, name: 'Ala', size: 4, links: [2] },
      { key: 2, name: 'Basia', size: 3, links: [1, 3] },
      { key: 3, name: 'Cela', size: 5, links: [2] },
    ])
    expect(byKey(rows, 2).reach).toBe(8) // B + C = 3 + 5, not 12
    expect(byKey(rows, 2).groupKeys).toEqual([3])
    expect(byKey(rows, 2).knownPeople).toBe(2 + 4 + 5)
    expect(byKey(rows, 1).reach).toBe(7)
    expect(byKey(rows, 3).reach).toBe(8)
  })

  it('two disjoint groups do not mix', () => {
    const rows = reachOf([
      { key: 1, name: 'Ala', size: 6, links: [2] },
      { key: 2, name: 'Basia', size: 6, links: [1] },
      { key: 3, name: 'Cela', size: 2, links: [4] },
      { key: 4, name: 'Dora', size: 2, links: [3] },
    ])
    expect(byKey(rows, 1).reach).toBe(12)
    expect(byKey(rows, 1).status).toBe('ok')
    expect(byKey(rows, 3).reach).toBe(4)
    expect(byKey(rows, 3).status).toBe('none')
  })

  it('a family with no links reaches its own seats and knows its own members only', () => {
    const [row] = reachOf([{ key: 1, name: 'Ala', size: 4 }])
    expect(row).toMatchObject({
      seats: 4,
      knownPeople: 3,
      reach: 4,
      status: 'none',
      groupKeys: [],
      groupGuestIds: [],
    })
  })

  it('a link written on one side only counts, in both directions', () => {
    const rows = reachOf([
      { key: 1, name: 'Ala', size: 5, links: [2] },
      { key: 2, name: 'Basia', size: 5 },
    ])
    expect(byKey(rows, 2).reach).toBe(10)
    expect(byKey(rows, 2).groupKeys).toEqual([1])
  })

  it('ignores links to unknown clusters and to itself', () => {
    const rows = reachOf([{ key: 1, name: 'Ala', size: 4, links: [1, 99] }])
    expect(rows[0]).toMatchObject({ reach: 4, knownPeople: 3 })
  })

  it('a children-only cluster is a node but not a row, and joins a group through its own links', () => {
    const rows = reachOf([
      { key: 1, name: 'Ala', size: 5, links: [2] },
      { key: 2, name: 'Dzieci', size: 0, children: 3, links: [1] },
    ])
    expect(rows.map((row) => row.clusterKey)).toEqual([1])
    expect(rows[0]).toMatchObject({ reach: 8, knownPeople: 4 + 3 })
    expect(rows[0]!.groupKeys).toEqual([2])
  })

  it('children count as seats of their family', () => {
    const [row] = reachOf([{ key: 1, name: 'Ala', size: 2, children: 2 }])
    expect(row).toMatchObject({ seats: 4, reach: 4, knownPeople: 3 })
  })

  it('disabled members take no seat and are not listed', () => {
    const { guests, clusters } = build([{ key: 1, name: 'Ala', size: 3 }])
    const off = guests.map((guest) => (guest.id === 102 ? { ...guest, enabled: false } : guest))
    const cluster = clusters[0]!
    const overview = makeOverview([{ ...cluster, enabledGuestIds: [100, 101], seatedSize: 2 }])
    const [row] = familyReach(off, overview)
    expect(row?.memberIds).toEqual([100, 101])
    expect(row?.seats).toBe(2)
  })

  it('a cluster with no enabled seats is not a node', () => {
    const { guests, clusters } = build([
      { key: 1, name: 'Ala', size: 5, links: [2] },
      { key: 2, name: 'Basia', size: 5, links: [1] },
    ])
    const idle = { ...clusters[1]!, enabledGuestIds: [], seatedSize: 0 }
    const rows = familyReach(guests, makeOverview([clusters[0]!, idle]))
    expect(rows.map((row) => row.clusterKey)).toEqual([1])
    expect(rows[0]).toMatchObject({ reach: 5, knownPeople: 4 })
  })

  it('lists the worst first: reach, then known people, then name', () => {
    const rows = reachOf([
      { key: 1, name: 'Zenon', size: 3 },
      { key: 2, name: 'Ala', size: 3 },
      { key: 3, name: 'Basia', size: 2 },
      { key: 4, name: 'Cela', size: 6, links: [5] },
      { key: 5, name: 'Dora', size: 6, links: [4] },
    ])
    expect(rows.map((row) => row.clusterKey)).toEqual([3, 2, 1, 4, 5])
  })

  it('names the other families of the group in name order', () => {
    const rows = reachOf([
      { key: 1, name: 'Zofia', size: 2, links: [2, 3] },
      { key: 2, name: 'Marek', size: 2, links: [1, 3] },
      { key: 3, name: 'Ala', size: 2, links: [1, 2] },
    ])
    const row = byKey(rows, 1)
    expect(row.groupKeys).toEqual([3, 2])
    expect(row.groupGuestIds).toEqual([300, 200])
  })

  it('is deterministic: shuffled inputs give identical output', () => {
    const specs: Spec[] = [
      { key: 1, name: 'Ala', size: 3, links: [2, 3] },
      { key: 2, name: 'Basia', size: 3, links: [1, 3, 4] },
      { key: 3, name: 'Cela', size: 3, links: [1, 2, 4] },
      { key: 4, name: 'Dora', size: 3, links: [2, 3] },
    ]
    const { guests, clusters } = build(specs)
    const forward = familyReach(guests, makeOverview(clusters))
    const shuffled = familyReach(
      [...guests].reverse(),
      makeOverview(
        [...clusters].reverse().map((c) => ({ ...c, affinities: [...c.affinities].reverse() })),
      ),
    )
    expect(shuffled).toEqual(forward)
    // 2-3 are in both triangles (1,2,3) and (2,3,4): equal weight, the smaller key list wins
    expect(byKey(forward, 2).groupKeys).toEqual([1, 3])
  })
})

describe('familyReach on bigger graphs', () => {
  /** Seeded pseudo-random numbers, so a failure reproduces. */
  function rng(seed: number) {
    let state = seed
    return () => {
      state = (state * 1664525 + 1013904223) % 4294967296
      return state / 4294967296
    }
  }

  function randomSpecs(count: number, density: number, seed: number): Spec[] {
    const random = rng(seed)
    const links = new Map<number, Set<number>>()
    for (let a = 1; a <= count; a++) {
      for (let b = a + 1; b <= count; b++) {
        if (random() < density) {
          links.set(a, (links.get(a) ?? new Set()).add(b))
        }
      }
    }
    return Array.from({ length: count }, (_, i) => ({
      key: i + 1,
      name: `F${String(i + 1).padStart(2, '0')}`,
      size: 1 + Math.floor(random() * 4),
      links: [...(links.get(i + 1) ?? [])],
    }))
  }

  const adjacency = (specs: Spec[]) => {
    const adjacent = new Map<number, Set<number>>(specs.map((s) => [s.key, new Set()]))
    for (const spec of specs) {
      for (const other of spec.links ?? []) {
        adjacent.get(spec.key)?.add(other)
        adjacent.get(other)?.add(spec.key)
      }
    }
    return adjacent
  }

  it('a 50-family sparse graph is fast and every reported group is a clique', () => {
    const specs = randomSpecs(50, 0.08, 7)
    const adjacent = adjacency(specs)
    const started = performance.now()
    const rows = reachOf(specs)
    const elapsed = performance.now() - started
    expect(elapsed).toBeLessThan(50)
    expect(rows).toHaveLength(50)
    for (const row of rows) {
      const group = [row.clusterKey, ...row.groupKeys]
      for (const a of group) {
        for (const b of group) {
          if (a !== b) expect(adjacent.get(a)?.has(b)).toBe(true)
        }
      }
      const weight = group.reduce((sum, key) => sum + specs.find((s) => s.key === key)!.size, 0)
      expect(weight).toBe(row.reach)
    }
  })

  it.each([1, 2, 3, 4, 5])(
    'matches a brute-force maximum-weight clique on a random 11-node graph (seed %i)',
    (seed) => {
      const specs = randomSpecs(11, 0.4, seed)
      const adjacent = adjacency(specs)
      const weights = new Map(specs.map((s) => [s.key, s.size]))
      const best = new Map<number, number>()
      for (let mask = 1; mask < 1 << specs.length; mask++) {
        const members = specs.filter((_, i) => mask & (1 << i)).map((s) => s.key)
        const isClique = members.every((a) =>
          members.every((b) => a === b || adjacent.get(a)?.has(b)),
        )
        if (!isClique) continue
        const weight = members.reduce((sum, key) => sum + (weights.get(key) ?? 0), 0)
        for (const key of members) best.set(key, Math.max(best.get(key) ?? 0, weight))
      }
      const rows = reachOf(specs)
      for (const row of rows) expect(row.reach).toBe(best.get(row.clusterKey))
    },
  )
})
