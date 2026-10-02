// Drop target ids shared by the floor plan (droppables), the drag handlers and the keyboard path.

export const TRAY_ID = 'tray'

export type DropTarget = { kind: 'table'; number: number } | { kind: 'tray' }

/** DOM id of a table card, for scrolling a found guest's table into view. */
export const tableElementId = (number: number) => `stol-${number}`

export const tableDropId = (number: number) => `table-${number}`

export function parseDropId(id: string | number | undefined | null): DropTarget | null {
  if (id === TRAY_ID) return { kind: 'tray' }
  const match = typeof id === 'string' ? /^table-(\d+)$/.exec(id) : null
  return match?.[1] ? { kind: 'table', number: Number(match[1]) } : null
}

/**
 * Keyboard drag: which target an arrow key selects. The targets are ordered tables 1..n, then the
 * tray; right/down go on, left/up go back, Home/End jump. It clamps at the ends (never wraps), so
 * a user always knows where "the end" is. `null` for any other key.
 */
export function stepTarget(
  ids: readonly string[],
  current: string | undefined,
  key: string,
): string | null {
  const last = ids.length - 1
  const at = current === undefined ? -1 : ids.indexOf(current)
  const target =
    key === 'ArrowRight' || key === 'ArrowDown'
      ? Math.min(at + 1, last)
      : key === 'ArrowLeft' || key === 'ArrowUp'
        ? Math.max(at - 1, 0)
        : key === 'Home'
          ? 0
          : key === 'End'
            ? last
            : null
  return target === null ? null : (ids[target] ?? null)
}
