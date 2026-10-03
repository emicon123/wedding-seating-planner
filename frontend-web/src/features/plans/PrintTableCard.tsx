import { TriangleAlertIcon } from 'lucide-react'
import { GroupMark } from '@/components/GroupMark'
import { fillStatusLabel, tableSizePrintLabel } from '@/domain/labels'
import { isMixed, type PlanKind } from '@/domain/plans'
import type { PrintCluster, PrintTable } from '@/domain/printPlan'
import { PrintGuestName } from '@/features/plans/PrintGuestName'
import { TableSeats } from '@/features/plans/TableSeats'

/**
 * A paczka (group 0) is one framed block with a "Grupa 0" mark, so "these sit together" reads on
 * paper without colour: frame = form, link icon + text = label. A lone guest is a plain line.
 */
export function PrintCluster({ cluster }: { cluster: PrintCluster }) {
  const names = cluster.guests.map((guest) => (
    <li key={guest.id} className="leading-snug">
      <PrintGuestName guest={guest} />
    </li>
  ))
  if (cluster.guests.length === 1) return <ul className="px-2">{names}</ul>
  return (
    <div className="space-y-0.5 rounded-md border-2 border-ink px-2 py-1">
      <GroupMark
        level={0}
        className="-ml-1 px-1.5 py-0 text-[0.7rem] print:border-0 print:bg-transparent print:px-0 print:text-black"
      />
      <ul>{names}</ul>
    </div>
  )
}

/** Seats drawn at an empty mixed-plan table (it needs no size). */
const FALLBACK_SEATS = 9

type PrintTableCardProps = { table: PrintTable; kind: PlanKind }

/** One table on paper: number, seat glyph, fill and the guests. Never split across two pages. */
export function PrintTableCard({ table, kind }: PrintTableCardProps) {
  const { capacity } = kind
  const mixed = isMixed(kind)
  const statusText = fillStatusLabel(table.status, table.fill, capacity)
  return (
    <section
      aria-label={`Stół ${table.number}`}
      className="flex break-inside-avoid flex-col gap-2 rounded-xl border-2 border-ink bg-white p-3 print:gap-1.5 print:p-2.5"
    >
      <header className="flex items-center gap-3 border-b border-ink/30 pb-2 print:pb-1.5">
        <TableSeats
          number={table.number}
          capacity={mixed ? (table.size ?? FALLBACK_SEATS) : capacity}
          clusterSizes={table.clusters.map((cluster) => cluster.guests.length)}
          status={table.status}
          className="size-20 shrink-0 print:size-16"
        />
        <div className="min-w-0">
          <h2 className="font-display text-2xl leading-none font-semibold">
            Stół {table.number}
            {mixed && table.size !== null && ` · ${tableSizePrintLabel(table.size)}`}
          </h2>
          <p className="mt-1 font-display text-xl leading-none">
            <span className="font-semibold">{table.fill}</span>
            {!mixed && <span className="text-ink-soft print:text-black">/{capacity}</span>}
            <span className="ml-1.5 font-sans text-sm text-ink-soft print:text-black">osób</span>
          </p>
          {statusText && (
            <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-brick print:text-black">
              <TriangleAlertIcon aria-hidden="true" className="size-3.5 shrink-0" />
              {statusText}
            </p>
          )}
        </div>
      </header>
      <ul className="space-y-1.5 text-[0.95rem] print:space-y-1 print:text-[10pt]">
        {table.clusters.map((cluster) => (
          <li key={cluster.key}>
            <PrintCluster cluster={cluster} />
          </li>
        ))}
        {table.clusters.length === 0 && <li className="px-2 text-ink-soft italic">Pusty stół</li>}
      </ul>
    </section>
  )
}
