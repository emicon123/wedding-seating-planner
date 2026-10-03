import { CircleDashedIcon, HeartIcon, UserXIcon } from 'lucide-react'
import { isIsolated } from '@/domain/isolation'
import { ISOLATED_HINT, ISOLATED_LABEL } from '@/domain/labels'
import type { GuestScore } from '@/domain/types'
import { cn } from '@/lib/utils'

/**
 * A guest's satisfaction at their table, from the server's evaluation: hearts for group 1
 * ("2/5" preferred people at the table), a dashed ring for group 2 people who sit there only
 * as the fallback. Icon + digits + full text for screen readers and tooltips, never colour alone. A guest with partners but none at the
 * table ("bez znajomych przy stole", negative satisfaction) gets a badge before the hearts.
 */
export function GuestScoreMark({ score }: { score: GuestScore }) {
  const { preferredAtTable, preferredTotal, fallbackAtTable } = score
  const isolated = isIsolated(score)
  if (preferredTotal === 0 && fallbackAtTable === 0 && !isolated) return null
  const lonely = preferredTotal > 0 && preferredAtTable === 0
  return (
    <span className="ml-auto flex shrink-0 items-center gap-1">
      {isolated && (
        <span
          title={`${ISOLATED_LABEL}: ${ISOLATED_HINT}`}
          className="inline-flex items-center rounded-full border-2 border-brick bg-brick/10 p-0.5 text-brick"
        >
          <UserXIcon aria-hidden="true" className="size-3" />
          <span className="sr-only">{ISOLATED_LABEL}</span>
        </span>
      )}
      {preferredTotal > 0 && (
        <span
          title={`Przy stole ${preferredAtTable} z ${preferredTotal} preferowanych osób (grupa 1)`}
          className={cn(
            'inline-flex items-center gap-0.5 rounded-full border-2 border-group-1 bg-group-1/10 px-1 text-[11px] leading-4 font-semibold',
            lonely && 'border-brick bg-brick/10 text-brick',
          )}
        >
          <HeartIcon aria-hidden="true" className={cn('size-3', !lonely && 'text-group-1')} />
          <span aria-hidden="true">
            {preferredAtTable}/{preferredTotal}
          </span>
          <span className="sr-only">
            Przy stole {preferredAtTable} z {preferredTotal} preferowanych osób
          </span>
        </span>
      )}
      {fallbackAtTable > 0 && (
        <span
          title={`${fallbackAtTable} z grupy 2 przy stole (tylko awaryjnie)`}
          className="inline-flex items-center gap-0.5 rounded-full border border-dashed border-group-2 bg-group-2/10 px-1 text-[11px] leading-4 font-semibold"
        >
          <CircleDashedIcon aria-hidden="true" className="size-3 text-group-2" />
          <span aria-hidden="true">{fallbackAtTable}</span>
          <span className="sr-only">{fallbackAtTable} z grupy 2 przy stole, tylko awaryjnie</span>
        </span>
      )}
    </span>
  )
}
