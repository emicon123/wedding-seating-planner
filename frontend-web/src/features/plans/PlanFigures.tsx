import { CircleCheckIcon, TriangleAlertIcon, UserXIcon } from 'lucide-react'
import { ISOLATED_LABEL, peopleLabel, scoreLabel, violationCountLabel } from '@/domain/labels'
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

type PlanFiguresProps = {
  summary: PlanSummary
  /** Guests "bez znajomych przy stole" (derived from the guest scores); a note, not a violation. */
  isolated?: number
}

/** Table count, satisfaction score and violation count of a plan: the three numbers to compare. */
export function PlanFigures({ summary, isolated = 0 }: PlanFiguresProps) {
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
      {isolated > 0 && (
        <p className="flex items-center gap-1 text-sm font-medium text-brick">
          <UserXIcon aria-hidden="true" className="size-4 shrink-0" />
          {ISOLATED_LABEL}: {isolated} os.
        </p>
      )}
    </div>
  )
}
