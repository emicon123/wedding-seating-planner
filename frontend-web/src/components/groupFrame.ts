import type { LinkLevel } from '@/domain/types'

/** The outline a block of people of this group gets: solid / solid / dashed, like the mark. */
export const GROUP_FRAME: Record<LinkLevel, string> = {
  0: 'border border-group-0/60 bg-group-0/5',
  1: 'border-2 border-group-1/50 bg-group-1/5',
  2: 'border border-dashed border-group-2 bg-group-2/5',
}
