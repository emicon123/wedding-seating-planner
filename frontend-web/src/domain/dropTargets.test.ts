import { TRAY_ID, parseDropId, stepTarget, tableDropId } from '@/domain/dropTargets'

describe('drop ids', () => {
  it('round-trips tables and the tray', () => {
    expect(parseDropId(tableDropId(4))).toEqual({ kind: 'table', number: 4 })
    expect(parseDropId(TRAY_ID)).toEqual({ kind: 'tray' })
    expect(parseDropId('whatever')).toBeNull()
    expect(parseDropId(undefined)).toBeNull()
  })
})

describe('stepTarget (keyboard drag)', () => {
  const ids = [tableDropId(1), tableDropId(2), tableDropId(3), TRAY_ID]

  it.each([
    ['ArrowRight', 'table-1', 'table-2'],
    ['ArrowDown', 'table-1', 'table-2'],
    ['ArrowLeft', 'table-3', 'table-2'],
    ['ArrowUp', 'table-3', 'table-2'],
    ['ArrowRight', 'table-3', 'tray'],
    ['ArrowRight', 'tray', 'tray'], // clamps, never wraps past the end
    ['ArrowLeft', 'table-1', 'table-1'],
    ['Home', 'table-3', 'table-1'],
    ['End', 'table-1', 'tray'],
  ])('%s from %s lands on %s', (key, from, to) => {
    expect(stepTarget(ids, from, key)).toBe(to)
  })

  it('ignores other keys', () => {
    expect(stepTarget(ids, 'table-1', 'KeyA')).toBeNull()
  })

  it('starts from the first target when the current one is unknown', () => {
    expect(stepTarget(ids, undefined, 'ArrowRight')).toBe('table-1')
  })
})
