import {
  dropHintLabel,
  GENERATE_SAVED_MESSAGE,
  peopleCountLabel,
  tablesNeededSummary,
  tableSizeBadgeLabel,
  tableSizePrintLabel,
  errorLabel,
  fillStatusLabel,
  groupLabel,
  guestCountsLabel,
  linkDiffLabel,
  preferredHereLabel,
  sourceUnderFloorLabel,
  strangerPairsLabel,
  missingLinksSummary,
  scoreLabel,
  relationCountLabel,
  relationReasonLabel,
  planContentsLabel,
  tableCountLabel,
  viaLabel,
  violationCountLabel,
  violationLabel,
  warningLabel,
} from '@/domain/labels'
import type { DataWarning, ErrorCode, ErrorItem, LinkLevel, Violation } from '@/domain/types'

// `Record<Code, true>` makes this list complete at compile time: when the contract gains a code,
// regenerating the schema breaks this file until the new code (and its label) is added.
const VIOLATION_CODES: Record<Violation['code'], true> = {
  cluster_split: true,
  over_capacity: true,
  under_floor: true,
  unseated_guests: true,
  oversized_cluster: true,
}
const WARNING_CODES: Record<DataWarning['code'], true> = {
  cluster_exceeds_9: true,
  cluster_exceeds_12: true,
  conflicting_link_levels: true,
}
const ERROR_CODES: Record<ErrorCode, true> = {
  bad_request: true,
  validation_failed: true,
  duplicate_name: true,
  not_found: true,
  version_conflict: true,
  import_invalid: true,
  payload_too_large: true,
  internal_error: true,
  unauthenticated: true,
  invalid_pin: true,
  too_many_attempts: true,
  csrf_header_missing: true,
}

const violation = (code: Violation['code'], overrides: Partial<Violation> = {}): Violation => ({
  code,
  message: 'English message from the server',
  tableNumber: 3,
  guestIds: [1, 2],
  ...overrides,
})
const warning = (code: DataWarning['code']): DataWarning => ({
  code,
  message: 'English message from the server',
  guestIds: [1],
})
const error = (code: ErrorCode, field: string | null = null): ErrorItem => ({
  code,
  field,
  message: 'English message from the server',
})

describe('Polish labels', () => {
  it.each(Object.keys(VIOLATION_CODES) as Violation['code'][])('violation %s', (code) => {
    const label = violationLabel(violation(code), 8)
    expect(label).not.toBe('')
    expect(label).not.toMatch(/English message/)
  })

  it.each(Object.keys(WARNING_CODES) as DataWarning['code'][])('data warning %s', (code) => {
    const label = warningLabel(warning(code))
    expect(label).not.toBe('')
    expect(label).not.toMatch(/English message/)
  })

  it.each(Object.keys(ERROR_CODES) as ErrorCode[])('error %s', (code) => {
    const label = errorLabel(error(code))
    expect(label).not.toBe('')
    expect(label).not.toMatch(/English message/)
  })

  it('names the table in table violations', () => {
    expect(violationLabel(violation('over_capacity'), 8)).toBe('Stół 3 jest przepełniony')
    expect(violationLabel(violation('under_floor'), 8)).toBe('Stół 3 ma za mało osób (minimum 8)')
    expect(violationLabel(violation('under_floor'), 9)).toBe('Stół 3 ma za mało osób (minimum 9)')
  })

  it.each([
    [1, '1 osoba bez stołu'],
    [2, '2 osoby bez stołu'],
    [5, '5 osób bez stołu'],
    [12, '12 osób bez stołu'],
    [22, '22 osoby bez stołu'],
  ])('uses the right Polish plural for %i unseated', (count, expected) => {
    const guestIds = Array.from({ length: count }, (_, i) => i + 1)
    expect(violationLabel(violation('unseated_guests', { tableNumber: null, guestIds }), 8)).toBe(
      expected,
    )
  })

  it('explains a duplicate name in plain language', () => {
    expect(errorLabel(error('duplicate_name', 'firstName'))).toBe(
      'Gość o takim imieniu i nazwisku już jest na liście.',
    )
  })

  it.each<[LinkLevel, string]>([
    [0, 'Grupa 0'],
    [1, 'Grupa 1'],
    [2, 'Grupa 2'],
  ])('labels link level %i', (level, expected) => {
    expect(groupLabel(level)).toBe(expected)
  })
})

describe('guestCountsLabel', () => {
  it('reads like the counters of the guest page', () => {
    expect(guestCountsLabel({ total: 92, enabled: 85, children: 7 })).toBe(
      '92 gości, 85 uwzględnionych, 7 dzieci',
    )
  })

  it('uses the singular forms', () => {
    expect(guestCountsLabel({ total: 1, enabled: 1, children: 1 })).toBe(
      '1 gość, 1 uwzględniony, 1 dziecko',
    )
  })
})

describe('viaLabel', () => {
  it('names the guest through whom someone comes along', () => {
    expect(viaLabel('cluster', 'Michał')).toBe('przez grupę 0: Michał')
    expect(viaLabel('link', 'Karolina')).toBe('przez powiązanie: Karolina')
  })
})

describe('plan labels', () => {
  it('counts tables and violations with Polish plurals', () => {
    expect([1, 2, 5, 12, 22].map(tableCountLabel)).toEqual([
      '1 stół',
      '2 stoły',
      '5 stołów',
      '12 stołów',
      '22 stoły',
    ])
    expect([0, 1, 3, 7].map(violationCountLabel)).toEqual([
      'Bez naruszeń',
      '1 naruszenie',
      '3 naruszenia',
      '7 naruszeń',
    ])
  })

  it('words a fill that breaks a rule, and stays silent when it is fine', () => {
    expect(fillStatusLabel('over', 11, 10, 8)).toBe('Za dużo osób: 11/10')
    expect(fillStatusLabel('under', 4, 10, 8)).toBe('Za mało osób (minimum 8)')
    expect(fillStatusLabel('under', 8, 12, 9)).toBe('Za mało osób (minimum 9)')
    expect(fillStatusLabel('ok', 8, 10, 8)).toBeNull()
  })

  it('words the drop hint with counts only', () => {
    const preview = { fillAfter: 9, overCapacity: false, underFloorSource: false, preferredHere: 3 }
    expect(dropHintLabel(preview, 10)).toBe('Po przeniesieniu: 9/10')
    expect(dropHintLabel({ ...preview, fillAfter: 11, overCapacity: true }, 10)).toBe(
      'Po przeniesieniu: 11/10, za dużo osób',
    )
    expect(dropHintLabel({ ...preview, fillAfter: 11 }, 12, 11)).toBe(
      'Po przeniesieniu: 11 os. → stół 11-os.',
    )
    expect(dropHintLabel({ ...preview, fillAfter: 13, overCapacity: true }, 12, 12)).toBe(
      'Po przeniesieniu: 13 os., za dużo osób',
    )
    expect(preferredHereLabel(3)).toBe('3 osoby z grupy 1')
    expect(preferredHereLabel(0)).toBe('Nikogo z grupy 1')
  })
})

describe('linkDiffLabel', () => {
  it('names every kind of change, with the move called out', () => {
    expect(linkDiffLabel({ add: [1, 2, 3], move: [{ guestId: 4, from: 1 }], remove: [5, 6] })).toBe(
      'Dodaj: 3, przenieś z innej grupy: 1, usuń: 2',
    )
  })

  it('leaves out what is not changing, and keeps the first word capitalised', () => {
    expect(linkDiffLabel({ add: [], move: [{ guestId: 4, from: 1 }], remove: [5] })).toBe(
      'Przenieś z innej grupy: 1, usuń: 1',
    )
    expect(linkDiffLabel({ add: [1], move: [], remove: [] })).toBe('Dodaj: 1')
  })
})

describe('relation labels', () => {
  it.each([
    [0, 0, 'brak'],
    [1, 1, '1 osoba'],
    [3, 3, '3 osoby'],
    [2, 1, '2 osoby w 1 rodzinie'],
    [9, 5, '9 osób w 5 rodzinach'],
    [4, 2, '4 osoby w 2 rodzinach'],
  ])('%i people in %i families -> %s', (people, families, expected) => {
    expect(relationCountLabel(people, families)).toBe(expected)
  })

  it('names the reason a person is listed', () => {
    const nameOf = () => 'Michał'
    expect(relationReasonLabel({ direct: true }, nameOf)).toBe('wpisany bezpośrednio')
    expect(
      relationReasonLabel({ direct: false, via: { guestId: 6, reason: 'cluster' } }, nameOf),
    ).toBe('przez grupę 0: Michał')
    expect(
      relationReasonLabel({ direct: false, via: { guestId: 6, reason: 'link' } }, nameOf),
    ).toBe('przez powiązanie: Michał')
  })
})

describe('planContentsLabel', () => {
  it('says what a plan holds, with Polish plurals', () => {
    expect(planContentsLabel({ tableCount: 3, seatedCount: 24 })).toBe(
      '3 stoły i 24 osoby przy stołach',
    )
    expect(planContentsLabel({ tableCount: 5, seatedCount: 1 })).toBe(
      '5 stołów i 1 osoba przy stołach',
    )
  })
})

describe('mixed plan copy (task 013)', () => {
  it('words the "Potrzebne stoły" line with a Polish plural for the seats', () => {
    expect(
      tablesNeededSummary([
        { size: 12, count: 5 },
        { size: 11, count: 3 },
        { size: 9, count: 1 },
      ]),
    ).toBe('Potrzebne stoły: 5 × 12, 3 × 11, 1 × 9 (102 miejsca)')
    expect(tablesNeededSummary([{ size: 12, count: 9 }])).toBe(
      'Potrzebne stoły: 9 × 12 (108 miejsc)',
    )
  })

  it('words sizes and counters', () => {
    expect(tableSizeBadgeLabel(11)).toBe('stół 11-os.')
    expect(tableSizePrintLabel(11)).toBe('11-osobowy')
    expect(peopleCountLabel(11)).toBe('11 os.')
  })

  it('names the saved plans, with the mixed one last', () => {
    expect(GENERATE_SAVED_MESSAGE(['9', '10', '11', '12', 'mixed'])).toBe(
      'Zapisano nowe plany: 9, 10, 11, 12 miejsc i mieszany.',
    )
  })

  it('words the under-floor hint with the plan floor', () => {
    expect(sourceUnderFloorLabel(2, 8)).toBe('Stół 2 będzie miał za mało osób (minimum 8)')
    expect(sourceUnderFloorLabel(2, 9)).toBe('Stół 2 będzie miał za mało osób (minimum 9)')
  })

  it.each([
    [0, '0 par obcych'],
    [1, '1 para obcych'],
    [3, '3 pary obcych'],
    [5, '5 par obcych'],
    [22, '22 pary obcych'],
  ])('uses the right Polish plural for %i stranger pairs', (count, expected) => {
    expect(strangerPairsLabel(count)).toBe(expected)
  })

  it('words the missing-links header with Polish plurals', () => {
    expect(missingLinksSummary(1, 4)).toBe(
      'Braki powiązań: 1 rodzina bez stołu w gronie znajomych, 4 tylko na mniejszy stół',
    )
    expect(missingLinksSummary(3, 0)).toBe(
      'Braki powiązań: 3 rodziny bez stołu w gronie znajomych, 0 tylko na mniejszy stół',
    )
    expect(missingLinksSummary(11, 2)).toContain('11 rodzin bez stołu')
  })

  it('formats a negative bilans', () => {
    expect(scoreLabel(-4)).toBe('-4')
  })
})
