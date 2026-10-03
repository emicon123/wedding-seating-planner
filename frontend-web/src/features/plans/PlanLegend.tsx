import { CircleHelpIcon, PinIcon, TriangleAlertIcon } from 'lucide-react'
import { GroupMark } from '@/components/GroupMark'

/** Key to the marks on the floor plan. Collapsed by default: a reminder, not furniture. */
export function PlanLegend() {
  return (
    <details className="group rounded-lg border bg-card text-sm">
      <summary className="flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-2 font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <CircleHelpIcon aria-hidden="true" className="size-4" />
        Legenda
      </summary>
      <dl className="grid gap-x-4 gap-y-2 px-3 pt-1 pb-3 sm:grid-cols-2">
        <div className="space-y-0.5">
          <dt>
            <GroupMark level={0} count={2} />
          </dt>
          <dd className="text-muted-foreground">Paczka: siedzą razem, przenosisz ją w całości.</dd>
        </div>
        <div className="space-y-0.5">
          <dt>
            <GroupMark level={1} />
          </dt>
          <dd className="text-muted-foreground">
            Serduszko „2/5”: tylu preferowanych gości jest przy stole.
          </dd>
        </div>
        <div className="space-y-0.5">
          <dt>
            <GroupMark level={2} />
          </dt>
          <dd className="text-muted-foreground">
            Kółko przerywane: ktoś z grupy 2, tylko awaryjnie.
          </dd>
        </div>
        <div className="space-y-0.5">
          <dt className="flex items-center gap-1 font-semibold">
            <PinIcon aria-hidden="true" className="size-4" /> Pinezka
          </dt>
          <dd className="text-muted-foreground">
            Paczka zostaje przy stole po przeliczeniu planu.
          </dd>
        </div>
        <div className="space-y-0.5 sm:col-span-2">
          <dt className="flex items-center gap-1 font-semibold text-brick">
            <TriangleAlertIcon aria-hidden="true" className="size-4" /> Ostrzeżenie
          </dt>
          <dd className="text-muted-foreground">
            Za dużo osób (czerwone, poza kołem miejsc) albo za mało (przerywany stół, minimum 8).
            Plan można zapisać mimo to.
          </dd>
        </div>
      </dl>
    </details>
  )
}
