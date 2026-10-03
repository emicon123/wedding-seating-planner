import { CircleCheckIcon, TriangleAlertIcon } from 'lucide-react'
import { peopleLabel, scoreLabel, violationCountLabel } from '@/domain/labels'
import type { PlanSummary } from '@/domain/types'
import { cn } from '@/lib/utils'

type FigureProps = {
  label: string
  value: string
  tone?: 'bad'
  icon?: React.ReactNode
}

function Figure({ label, value, tone, icon }: FigureProps) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'flex items-center gap-1 font-display text-3xl leading-tight font-semibold',
          tone === 'bad' && 'text-brick',
        )}
      >
        {icon}
        {value}
      </dd>
    </div>
  )
}

/** Table count, satisfaction score and violation count of a plan: the three numbers to compare. */
export function PlanFigures({ summary }: { summary: PlanSummary }) {
  const broken = summary.violationCount > 0
  return (
    <div className="space-y-2">
      <dl className="grid grid-cols-3 gap-2">
        <Figure label="Stoły" value={String(summary.tableCount)} />
        <Figure label="Zadowolenie" value={scoreLabel(summary.score)} />
        <Figure
          label="Naruszenia"
          value={String(summary.violationCount)}
          tone={broken ? 'bad' : undefined}
          icon={
            broken ? (
              <TriangleAlertIcon aria-hidden="true" className="size-5" />
            ) : (
              <CircleCheckIcon aria-hidden="true" className="size-5 text-sage" />
            )
          }
        />
      </dl>
      <p className="text-sm text-muted-foreground">
        <span className={cn(broken && 'font-medium text-brick')}>
          {violationCountLabel(summary.violationCount)}
        </span>
        {' · '}
        posadzonych {summary.seatedCount}
        {summary.unseatedCount > 0 && (
          <>
            {', '}
            <span className="font-medium text-brick">
              {peopleLabel(summary.unseatedCount)} bez stołu
            </span>
          </>
        )}
      </p>
    </div>
  )
}
