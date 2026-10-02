import { clusterOf } from '@/domain/companions'
import { linkColumns } from '@/domain/linkColumns'
import type { ClusterOverview, DataWarning, Guest, LinkLevel } from '@/domain/types'

/**
 * Pure logic of the per-group checklist in the link editor (003-frontend-design §5): which guests
 * are offered, what a Save would change, and a display-only preview of who comes along. Nothing
 * here scores a plan; the server stays the source of truth for clusters and warnings.
 */

export type PickerRow = {
  guest: Guest
  /** The group this guest is linked at today (one pair = one link), if any. */
  currentLevel: LinkLevel | undefined
  /** In the group-0 cluster of the edited guest without a link of their own with them. */
  viaCluster: boolean
  /** For `viaCluster`: the person the guest reaches them through ("zmień przy X"). */
  via: number | undefined
}

const polish = new Intl.Collator('pl')

/** Every other guest, alphabetical (Polish collation), with what the editor needs to show them. */
export function pickerRows(
  guest: Guest,
  guests: Guest[],
  overview: ClusterOverview | undefined,
): PickerRow[] {
  const level = new Map(guest.links.map((entry) => [entry.guestId, entry.level]))
  const mates = new Set(overview ? (clusterOf(guest.id, overview)?.guestIds ?? []) : [])
  const via = new Map(
    linkColumns(guest.id, guests, overview)[0].flatMap((entry) =>
      entry.via ? [[entry.guestId, entry.via.guestId] as const] : [],
    ),
  )
  return guests
    .filter((other) => other.id !== guest.id)
    .sort((a, b) => polish.compare(a.displayName, b.displayName))
    .map((other) => ({
      guest: other,
      currentLevel: level.get(other.id),
      viaCluster: mates.has(other.id) && level.get(other.id) !== 0,
      via: via.get(other.id),
    }))
}

/** The guests linked directly at this level: the checklist starts with them ticked. */
export function selectedAt(guest: Guest, level: LinkLevel): Set<number> {
  return new Set(guest.links.filter((entry) => entry.level === level).map((entry) => entry.guestId))
}

export type LinkDiff = {
  /** Ticked, no link today. */
  add: number[]
  /** Ticked, linked at another level today: the pair keeps ONE link, so it moves. */
  move: { guestId: number; from: LinkLevel }[]
  /** Linked at this level today, unticked. */
  remove: number[]
}

/** What Save would do, against the guest's current direct links. */
export function diffSelection(
  guest: Guest,
  level: LinkLevel,
  selected: ReadonlySet<number>,
): LinkDiff {
  const current = new Map(guest.links.map((entry) => [entry.guestId, entry.level]))
  const ticked = [...selected].sort((a, b) => a - b)
  const add: number[] = []
  const move: LinkDiff['move'] = []
  for (const id of ticked) {
    const now = current.get(id)
    if (now === undefined) add.push(id)
    else if (now !== level) move.push({ guestId: id, from: now })
  }
  const remove = [...selectedAt(guest, level)]
    .filter((id) => !selected.has(id))
    .sort((a, b) => a - b)
  return { add, move, remove }
}

export function diffIsEmpty(diff: LinkDiff): boolean {
  return diff.add.length + diff.move.length + diff.remove.length === 0
}

/** One request per entry: `level: null` deletes the pair's link, a level upserts it. */
export type LinkChange = { otherId: number; level: LinkLevel | null }

/** Removals first, then moves and additions, which are the same upsert at the picked level. */
export function linkChangesOf(level: LinkLevel, diff: LinkDiff): LinkChange[] {
  return [
    ...diff.remove.map((otherId) => ({ otherId, level: null })),
    ...diff.move.map(({ guestId }) => ({ otherId: guestId, level })),
    ...diff.add.map((otherId) => ({ otherId, level })),
  ]
}

export type Joining = { guestId: number; viaId: number }

/**
 * Group 1/2 links reach whole clusters (glossary: cluster affinity): ticking Michał also brings
 * his group-0 mates (Ola). Lists those who are not ticked themselves, with the ticked guest
 * they come along through. The guest's own cluster is excluded.
 */
export function joiningViaCluster(
  guestId: number,
  selected: ReadonlySet<number>,
  overview: ClusterOverview,
): Joining[] {
  const own = new Set(clusterOf(guestId, overview)?.guestIds ?? [guestId])
  const seen = new Set<number>()
  const joining: Joining[] = []
  for (const viaId of [...selected].sort((a, b) => a - b)) {
    for (const mate of clusterOf(viaId, overview)?.guestIds ?? []) {
      if (mate === viaId || selected.has(mate) || own.has(mate) || seen.has(mate)) continue
      seen.add(mate)
      joining.push({ guestId: mate, viaId })
    }
  }
  return joining
}

export type ClusterPreview = { memberIds: number[]; seatedSize: number }

/**
 * The group-0 cluster (connected component of the group-0 graph, disabled guests included) the
 * guest would be in after saving this group-0 selection. Seated size counts enabled members only.
 */
export function clusterAfter(
  guest: Guest,
  guests: Guest[],
  selected: ReadonlySet<number>,
): ClusterPreview {
  const byId = new Map(guests.map((other) => [other.id, other]))
  const neighbours = (id: number): number[] => {
    if (id === guest.id) return [...selected]
    const own = (byId.get(id)?.links ?? [])
      .filter((entry) => entry.level === 0 && entry.guestId !== guest.id)
      .map((entry) => entry.guestId)
    return selected.has(id) ? [...own, guest.id] : own
  }
  const members = new Set([guest.id])
  const queue = [guest.id]
  for (const current of queue) {
    for (const next of neighbours(current)) {
      if (members.has(next)) continue
      members.add(next)
      queue.push(next)
    }
  }
  const memberIds = [...members]
  const seatedSize = memberIds.filter((id) => byId.get(id)?.enabled !== false).length
  return { memberIds, seatedSize }
}

/** The same thresholds as the server's data warnings: > 8 (8-seat plan) and > 12 (no plan). */
export function clusterSizeWarning(seatedSize: number): DataWarning['code'] | null {
  if (seatedSize > 12) return 'cluster_exceeds_12'
  if (seatedSize > 8) return 'cluster_exceeds_8'
  return null
}
