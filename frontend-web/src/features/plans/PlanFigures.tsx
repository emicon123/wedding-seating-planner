import { CircleCheckIcon, TriangleAlertIcon, UserXIcon } from 'lucide-react'
import {
  BILANS_HINT,
  BILANS_LABEL,
  ISOLATED_LABEL,
  peopleLabel,
  SCORE_ADULTS_HINT,
  scoreLabel,
  STRANGER_PAIRS_HINT,
  STRANGER_PAIRS_LABEL,
  violationCountLabel,
} from '@/domain/labels'
import type { PlanSummary } from '@/domain/types'
import { cn } from '@/lib/utils'

type FigureProps = {
  label: string
  value: string
  /** Tooltip explaining the number. */
  hint?: string
  tone?: 'bad'
  icon?: React.ReactNode
}

function Figure({ label, value, hint, tone, icon }: FigureProps) {
  return (
    <div className="min-w-0" title={hint}>
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
  /** Pairs of adults at one table who do not know each other (derived); a note, not a violation. */
  strangerPairs?: number
  /** Score minus 2 per stranger pair (derived), comparable across the five plans. */
  bilans?: number
  /** The mixed plan weighs satisfaction against strangers freely over the table count, so its line stands out. */
  bilansEmphasised?: boolean
}

/** Table count, satisfaction score and violation count of a plan: the three numbers to compare. */
export function PlanFigures({
  summary,
  isolated = 0,
  strangerPairs,
  bilans,
  bilansEmphasised = false,
}: PlanFiguresProps) {
  const broken = summary.violationCount > 0
  return (
    <div className="space-y-2">
      <dl className="grid grid-cols-3 gap-2">
        <Figure label="Stoły" value={String(summary.tableCount)} />
        <Figure label="Zadowolenie" value={scoreLabel(summary.score)} hint={SCORE_ADULTS_HINT} />
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
      {(strangerPairs !== undefined || bilans !== undefined) && (
        <p className="flex flex-wrap gap-x-3 text-sm text-muted-foreground">
          {strangerPairs !== undefined && (
            <span title={STRANGER_PAIRS_HINT}>
              {STRANGER_PAIRS_LABEL}: {scoreLabel(strangerPairs)}
            </span>
          )}
          {bilans !== undefined && (
            <span
              title={BILANS_HINT}
              className={cn(bilansEmphasised && 'font-medium text-foreground')}
            >
              {BILANS_LABEL}: {scoreLabel(bilans)}
            </span>
          )}
        </p>
      )}
    </div>
  )
}
