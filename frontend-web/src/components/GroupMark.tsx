import { CircleDashedIcon, HeartIcon, Link2Icon, type LucideIcon } from 'lucide-react'
import type { LinkLevel } from '@/domain/types'
import { cn } from '@/lib/utils'

/**
 * The look of a guest group. Colour is never the only carrier of meaning (theme.css):
 *   group 0 = wine, SOLID fill, chain icon      (bound together, a hard rule)
 *   group 1 = teal, solid 2px OUTLINE, heart    (preferred)
 *   group 2 = ochre, DASHED outline, dashed ring (fallback, only if unavoidable)
 * and the text always names the group ("Grupa 1"), so the mark also reads in greyscale.
 */
const LOOK: Record<LinkLevel, { icon: LucideIcon; className: string }> = {
  0: { icon: Link2Icon, className: 'border border-group-0 bg-group-0 text-white' },
  1: { icon: HeartIcon, className: 'border-2 border-group-1 bg-group-1/10 text-ink' },
  2: {
    icon: CircleDashedIcon,
    className: 'border border-dashed border-group-2 bg-group-2/10 text-ink',
  },
}

const ICON_COLOUR: Record<LinkLevel, string> = {
  0: '',
  1: 'text-group-1',
  2: 'text-group-2',
}

type GroupMarkProps = {
  level: LinkLevel
  /** Compact form for list rows: icon, "Grupa N" (only the digit on a phone) and a count. */
  count?: number
  className?: string
}

export function GroupMark({ level, count, className }: GroupMarkProps) {
  const { icon: Icon, className: look } = LOOK[level]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap',
        look,
        className,
      )}
    >
      <Icon aria-hidden="true" className={cn('size-3.5', ICON_COLOUR[level])} />
      {count === undefined ? (
        `Grupa ${level}`
      ) : (
        <>
          <span aria-hidden="true">
            <span className="hidden sm:inline">Grupa </span>
            {level} ×{count}
          </span>
          <span className="sr-only">
            Grupa {level}: {count}
          </span>
        </>
      )}
    </span>
  )
}
