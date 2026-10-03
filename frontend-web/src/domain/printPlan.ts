import { guestTableMap, sortPlacements } from '@/domain/planView'
import type { GuestIndex } from '@/domain/guestIndex'
import { fillStatus, type FillStatus } from '@/domain/tableStatus'
import type { PlanKind } from '@/domain/plans'
import { tableSize, type TableSize } from '@/domain/tableSizes'
import type { ClusterPlacement, Guest, SeatingPlan } from '@/domain/types'

// The printout's data: plain shapes the print components only have to draw. The plan lists
// enabled members only, so a disabled guest never appears on paper.

export type PrintGuest = { id: number; name: string; isChild: boolean }
export type PrintCluster = { key: number; guests: PrintGuest[] }
export type PrintTable = {
  number: number
  fill: number
  /** Seats the venue provides here; null for an empty table. */
  size: TableSize | null
  status: FillStatus
  clusters: PrintCluster[]
}
export type PrintTables = { tables: PrintTable[]; unseated: PrintCluster[] }

const byName = (a: string, b: string) => a.localeCompare(b, 'pl')

function nameFor(index: GuestIndex, guestId: number): string {
  return index.byId.get(guestId)?.displayName ?? `Gość ${guestId}`
}

function printCluster(cluster: ClusterPlacement, index: GuestIndex): PrintCluster {
  const guests = cluster.guestIds
    .map((id) => ({
      id,
      name: nameFor(index, id),
      isChild: index.byId.get(id)?.isChild ?? false,
    }))
    .sort((a, b) => byName(a.name, b.name))
  return { key: cluster.clusterKey, guests }
}

function printClusters(clusters: ClusterPlacement[], index: GuestIndex): PrintCluster[] {
  const named = clusters.map((cluster) => ({
    ...cluster,
    guestIds: printCluster(cluster, index).guests.map((guest) => guest.id),
  }))
  return sortPlacements(named, (id) => nameFor(index, id)).map((cluster) =>
    printCluster(cluster, index),
  )
}

/** Every table with its paczki (biggest first) and guests (by name), plus the unseated paczki. */
export function buildPrintTables(
  plan: SeatingPlan,
  kind: PlanKind,
  index: GuestIndex,
): PrintTables {
  return {
    tables: plan.tables.map((table) => ({
      number: table.number,
      fill: table.fill,
      size: tableSize(table.fill, kind),
      status: fillStatus(table.fill, kind.capacity, plan.tables.length),
      clusters: printClusters(table.clusters, index),
    })),
    unseated: printClusters(plan.unseated, index),
  }
}

export type NameIndexEntry = {
  guestId: number
  displayName: string
  /** The part the list is sorted by: the last name, or the first name when there is none. */
  surname: string
  given: string | null
  isChild: boolean
  /** null = the guest has no table in this plan. */
  tableNumber: number | null
}
export type NameIndexSection = { letter: string; entries: NameIndexEntry[] }

function entryFor(guestId: number, tableNumber: number | null, index: GuestIndex): NameIndexEntry {
  const guest: Guest | undefined = index.byId.get(guestId)
  if (!guest) {
    return {
      guestId,
      displayName: nameFor(index, guestId),
      surname: nameFor(index, guestId),
      given: null,
      isChild: false,
      tableNumber,
    }
  }
  return {
    guestId,
    displayName: guest.displayName,
    surname: guest.lastName ?? guest.firstName,
    given: guest.lastName ? guest.firstName : null,
    isChild: guest.isChild,
    tableNumber,
  }
}

/** "Kto przy którym stole": every seated guest A-Z by surname, grouped by initial letter. */
export function buildNameIndex(plan: SeatingPlan, index: GuestIndex): NameIndexSection[] {
  const entries = [...guestTableMap(plan)]
    .map(([guestId, tableNumber]) => entryFor(guestId, tableNumber, index))
    .sort(
      (a, b) =>
        byName(a.surname, b.surname) ||
        byName(a.given ?? '', b.given ?? '') ||
        a.guestId - b.guestId,
    )

  const sections: NameIndexSection[] = []
  for (const entry of entries) {
    const letter = entry.surname.charAt(0).toLocaleUpperCase('pl')
    const last = sections.at(-1)
    if (last?.letter === letter) last.entries.push(entry)
    else sections.push({ letter, entries: [entry] })
  }
  return sections
}
