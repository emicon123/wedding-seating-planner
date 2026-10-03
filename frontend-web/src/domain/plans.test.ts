import {
  isMixed,
  isRetiredPlanKey,
  minTableFill,
  parsePlanKey,
  PLAN_KEYS,
  planHeading,
  planName,
  planTitle,
} from '@/domain/plans'

describe('PLAN_KEYS', () => {
  it('lists the five plans in order, mixed last', () => {
    expect(PLAN_KEYS).toEqual(['9', '10', '11', '12', 'mixed'])
  })
})

describe('parsePlanKey', () => {
  it.each(['9', '10', '11', '12', 'mixed'])('accepts %s', (raw) => {
    expect(parsePlanKey(raw)).toBe(raw)
  })

  it.each([undefined, '', '8', '13', '08', '10.0', 'Mixed', 'abc'])('rejects %s', (raw) => {
    expect(parsePlanKey(raw)).toBeNull()
  })
})

describe('isRetiredPlanKey', () => {
  it('recognises the retired 8-seat plan, and nothing else', () => {
    expect(isRetiredPlanKey('8')).toBe(true)
    expect(isRetiredPlanKey('9')).toBe(false)
    expect(isRetiredPlanKey('mixed')).toBe(false)
    expect(isRetiredPlanKey(undefined)).toBe(false)
  })
})

describe('plan names', () => {
  it('names the plans for lists, sentences and headings', () => {
    expect(planName('10')).toBe('10 miejsc')
    expect(planName('mixed')).toBe('Mieszany')
    expect(planTitle('10')).toBe('plan na 10 miejsc')
    expect(planTitle('mixed')).toBe('plan mieszany')
    expect(planHeading('10')).toBe('Plan na 10 miejsc')
    expect(planHeading('mixed')).toBe('Plan mieszany')
  })

  it('knows the mixed plan', () => {
    expect(isMixed({ key: 'mixed' })).toBe(true)
    expect(isMixed({ key: '12' })).toBe(false)
  })
})

describe('minTableFill', () => {
  it('is 9 in the mixed plan and 8 in every uniform plan', () => {
    expect(minTableFill({ key: 'mixed' })).toBe(9)
    expect(PLAN_KEYS.filter((key) => key !== 'mixed').map((key) => minTableFill({ key }))).toEqual([
      8, 8, 8, 8,
    ])
  })
})
