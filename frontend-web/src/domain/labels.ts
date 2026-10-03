// Polish copy for every code the server sends (one place, DRY). The server's own `message`
// is English and for logs only; the UI always maps `code` to these.
import type { DropPreview } from '@/domain/dropPreview'
import type { GuestCounts } from '@/domain/guestList'
import type { ViaReason } from '@/domain/linkColumns'
import type { LinkDiff } from '@/domain/linkSelection'
import { MIXED_KEY } from '@/domain/plans'
import type { TablesNeeded, TableSize } from '@/domain/tableSizes'
import { seatsTotal, tablesNeededLabel } from '@/domain/tableSizes'
import type { FillStatus } from '@/domain/tableStatus'
import type {
  DataWarning,
  ErrorCode,
  ErrorItem,
  LinkLevel,
  PlanKey,
  PlanSummary,
  Violation,
} from '@/domain/types'

/** Polish noun plural: 1 osoba, 2-4 osoby, 5-21 osób, 22-24 osoby ... */
export function pluralPl(count: number, one: string, few: string, many: string): string {
  const lastTwo = count % 100
  const last = count % 10
  if (count === 1) return `${count} ${one}`
  if (last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14)) return `${count} ${few}`
  return `${count} ${many}`
}

export function groupLabel(level: LinkLevel): string {
  return `Grupa ${level}`
}

/** One line per group, used wherever the user decides or reads what a group means. */
export const GROUP_HINT: Record<LinkLevel, string> = {
  0: 'Muszą siedzieć razem, przy jednym stole.',
  1: 'Chcą siedzieć razem, jeśli się da.',
  2: 'Mogą siedzieć razem, tylko gdy nie ma innej opcji.',
}

/** The short names of the three blocks in the relationships panel. */
export const GROUP_TAGLINE: Record<LinkLevel, string> = {
  0: 'siedzą razem',
  1: 'chcą siedzieć razem',
  2: 'ewentualnie',
}

export function violationLabel(violation: Violation, floor: number): string {
  const table = violation.tableNumber === null ? 'Stół' : `Stół ${violation.tableNumber}`
  const labels: Record<Violation['code'], string> = {
    over_capacity: `${table} jest przepełniony`,
    under_floor: `${table} ma za mało osób (minimum ${floor})`,
    cluster_split: 'Paczka jest rozdzielona między stoły',
    unseated_guests: `${pluralPl(violation.guestIds.length, 'osoba', 'osoby', 'osób')} bez stołu`,
    oversized_cluster: 'Paczka jest za duża na stół w tym planie',
  }
  return labels[violation.code]
}

export function warningLabel(warning: Pick<DataWarning, 'code'>): string {
  const labels: Record<DataWarning['code'], string> = {
    cluster_exceeds_9: 'Ta paczka (grupa 0) jest za duża na stół 9-osobowy',
    cluster_exceeds_12:
      'Ta paczka (grupa 0) jest za duża na stół 12-osobowy, nie zmieści się w żadnym planie',
    conflicting_link_levels: 'Te paczki są powiązane jednocześnie grupą 1 i 2, obowiązuje grupa 1',
  }
  return labels[warning.code]
}

export function errorLabel(error: ErrorItem): string {
  const labels: Record<ErrorCode, string> = {
    bad_request: 'Nie udało się wysłać tego żądania. Odśwież stronę i spróbuj ponownie.',
    validation_failed: 'Dane są niepoprawne. Popraw je i spróbuj ponownie.',
    duplicate_name: 'Gość o takim imieniu i nazwisku już jest na liście.',
    not_found: 'Nie znaleziono tego elementu. Mógł zostać usunięty.',
    version_conflict: 'Ktoś zmienił te dane w międzyczasie. Dane zostały odświeżone.',
    import_invalid: 'Plik zawiera błędy. Popraw go i wybierz ponownie.',
    payload_too_large: 'Plik jest za duży.',
    internal_error: 'Coś poszło nie tak po stronie serwera. Spróbuj ponownie za chwilę.',
    unauthenticated: 'Podaj PIN',
    invalid_pin: 'Zły PIN',
    too_many_attempts: 'Za dużo prób — spróbuj za chwilę',
    csrf_header_missing: 'Nie udało się wysłać tego żądania. Odśwież stronę i spróbuj ponownie.',
  }
  return labels[error.code]
}

/** "92 gości, 85 uwzględnionych, 7 dzieci" — the counters above the guest list. */
export function guestCountsLabel({ total, enabled, children }: GuestCounts): string {
  return [
    pluralPl(total, 'gość', 'gości', 'gości'),
    pluralPl(enabled, 'uwzględniony', 'uwzględnionych', 'uwzględnionych'),
    pluralPl(children, 'dziecko', 'dzieci', 'dzieci'),
  ].join(', ')
}

/**
 * Why someone comes along without a link of their own: "przez grupę 0: Michał". A colon instead of
 * a case ending, because inflecting names ("Michała", "Oli") cannot be done reliably.
 */
export function viaLabel(reason: ViaReason, viaName: string): string {
  return reason === 'cluster' ? `przez grupę 0: ${viaName}` : `przez powiązanie: ${viaName}`
}

/**
 * The Save summary of a link checklist: "Dodaj: 3, przenieś z innej grupy: 1, usuń: 2" (parts
 * with nothing to do are left out). Moves are named because the pair keeps ONE link.
 */
export function linkDiffLabel(diff: LinkDiff): string {
  const text = [
    diff.add.length > 0 ? `dodaj: ${diff.add.length}` : null,
    diff.move.length > 0 ? `przenieś z innej grupy: ${diff.move.length}` : null,
    diff.remove.length > 0 ? `usuń: ${diff.remove.length}` : null,
  ]
    .filter((part) => part !== null)
    .join(', ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** "brak" / "2 osoby" / "9 osób w 5 rodzinach" (the family part is left out when everyone is alone). */
export function relationCountLabel(personCount: number, familyCount: number): string {
  if (personCount === 0) return 'brak'
  const people = pluralPl(personCount, 'osoba', 'osoby', 'osób')
  if (familyCount === personCount) return people
  return `${people} w ${pluralPl(familyCount, 'rodzinie', 'rodzinach', 'rodzinach')}`
}

/** Why a person is listed: entered directly, or through whom they come along. */
export function relationReasonLabel(
  entry: { direct: boolean; via?: { guestId: number; reason: ViaReason } },
  nameOf: (guestId: number) => string,
): string {
  return entry.via ? viaLabel(entry.via.reason, nameOf(entry.via.guestId)) : 'wpisany bezpośrednio'
}

// --- plans ------------------------------------------------------------------------------------

export const tableCountLabel = (count: number) => pluralPl(count, 'stół', 'stoły', 'stołów')

export const peopleLabel = (count: number) => pluralPl(count, 'osoba', 'osoby', 'osób')

/** "3 stoły i 24 osoby przy stołach": what "Usuń plan" is about to clear. */
export const planContentsLabel = ({
  tableCount,
  seatedCount,
}: Pick<PlanSummary, 'tableCount' | 'seatedCount'>) =>
  `${tableCountLabel(tableCount)} i ${peopleLabel(seatedCount)} przy stołach`

/** "Bez naruszeń" / "2 naruszenia": the plan card's verdict line. */
export function violationCountLabel(count: number): string {
  return count === 0 ? 'Bez naruszeń' : pluralPl(count, 'naruszenie', 'naruszenia', 'naruszeń')
}

/** A fill counter that breaks a hard rule: shown as text next to an icon, never colour alone. */
export function fillStatusLabel(
  status: FillStatus,
  fill: number,
  capacity: number,
  floor: number,
): string | null {
  if (status === 'over') return `Za dużo osób: ${fill}/${capacity}`
  if (status === 'under') return `Za mało osób (minimum ${floor})`
  return null
}

/**
 * The hint over a hovered table while dragging (counts only, scores come from the server).
 * `size` is given only for a mixed-plan table: the size the table would have after the drop.
 */
export function dropHintLabel(
  preview: DropPreview,
  capacity: number,
  size?: TableSize | null,
): string {
  if (size === undefined) {
    const base = `Po przeniesieniu: ${preview.fillAfter}/${capacity}`
    return preview.overCapacity ? `${base}, za dużo osób` : base
  }
  const base = `Po przeniesieniu: ${peopleCountLabel(preview.fillAfter)}`
  if (preview.overCapacity) return `${base}, za dużo osób`
  return size === null ? base : `${base} → ${tableSizeBadgeLabel(size)}`
}

/** The short counter of a mixed-plan table, whose size follows its fill: "11 os." */
export const peopleCountLabel = (count: number) => `${count} os.`

/** The size badge of a table: "stół 11-os." */
export const tableSizeBadgeLabel = (size: TableSize) => `stół ${size}-os.`

/** A table of a mixed plan in print: "11-osobowy". */
export const tableSizePrintLabel = (size: TableSize) => `${size}-osobowy`

export const EMPTY_TABLE_LABEL = 'pusty — niepotrzebny'

/** "Potrzebne stoły: 5 × 12, 3 × 11, 1 × 9 (102 miejsca)": what the venue must provide. */
export function tablesNeededSummary(needed: TablesNeeded): string {
  const seats = pluralPl(seatsTotal(needed), 'miejsce', 'miejsca', 'miejsc')
  return `Potrzebne stoły: ${tablesNeededLabel(needed)} (${seats})`
}

/** Stranger pairs (task 015): adults at one table who do not know each other. */
export const STRANGER_PAIRS_LABEL = 'Pary obcych'
export const STRANGER_PAIRS_HINT =
  'Pary dorosłych przy jednym stole, którzy się nie znają (ani grupa 0, ani 1, ani 2)'
/** "1 para obcych", "3 pary obcych", "5 par obcych". */
export const strangerPairsLabel = (count: number) =>
  `${pluralPl(count, 'para', 'pary', 'par')} obcych`
export const BILANS_LABEL = 'Bilans'
export const BILANS_HINT = 'Zadowolenie minus 2 za każdą parę obcych (każda z dwóch osób traci 1)'

/** The line under "Mieszany" on its plan card: the table count is the algorithm's choice. */
export const MIXED_PLAN_SUBLINE = 'Stoły 9–12-osobowe, liczba stołów dobrana pod najlepszy bilans'

/** Generate now takes several seconds (the mixed plan tries every table count). */
export const GENERATE_WAIT_HINT = 'To może potrwać kilka sekund.'

// --- missing-links report (task 015) ----------------------------------------------------------

export const familyCountLabel = (count: number) => pluralPl(count, 'rodzina', 'rodziny', 'rodzin')

/** The header of the report: the two counts that matter. */
export const missingLinksSummary = (none: number, partial: number) =>
  `Braki powiązań: ${familyCountLabel(none)} bez stołu w gronie znajomych, ${partial} tylko na mniejszy stół`
export const MISSING_LINKS_ALL_OK = 'Każda rodzina ma grupę znajomych na pełny stół.'
export const MISSING_LINKS_HELP =
  'Żeby nikt nie siedział z obcymi, każda rodzina potrzebuje grupy co najmniej 8 osób, w której wszyscy się znają (grupa 0, 1 lub 2). Dopisz powiązania z grup 1/2 z rodzinami, które znają też ich znajomi.'
export const MISSING_LINKS_MIXED_NOTE = 'Plan mieszany ma minimum 9 osób przy stole.'
export const knownPeopleLabel = (count: number) => `Zna: ${count} os.`
export const reachLabel = (count: number) => `Największa grupa znajomych: ${count} os.`
export const REACH_NONE_BADGE = 'Za mało znajomych na stół (min. 8)'
export const reachPartialBadge = (reach: number) => `Stół bez obcych najwyżej na ${reach} os.`
export const REACH_ALONE = 'Nikt — dopisz pierwsze powiązania z grup 1/2'
export const reachWithLabel = (names: string) => `Razem z: ${names}`
export const restOkLabel = (count: number) =>
  `Pozostałe rodziny (${count}): wystarczy znajomych na pełny stół.`

export function preferredHereLabel(count: number): string {
  return count === 0 ? 'Nikogo z grupy 1' : `${pluralPl(count, 'osoba', 'osoby', 'osób')} z grupy 1`
}

export function sourceUnderFloorLabel(tableNumber: number, floor: number): string {
  return `Stół ${tableNumber} będzie miał za mało osób (minimum ${floor})`
}

export function placeLabel(place: number | 'unseated' | 'disabled'): string {
  if (place === 'unseated') return 'bez stołu'
  if (place === 'disabled') return 'wyłączony'
  return `stół ${place}`
}

/** Task 007: the plans changed between reading them and storing the Generate (409, nothing stored). */
export const GENERATE_CONFLICT_MESSAGE =
  'Plany zmieniły się w międzyczasie — kliknij „Generuj plany” jeszcze raz.'
export const GENERATE_SAVED_MESSAGE = (keys: readonly PlanKey[]) => {
  const sizes = keys.filter((key) => key !== MIXED_KEY).join(', ')
  return keys.includes(MIXED_KEY)
    ? `Zapisano nowe plany: ${sizes} miejsc i mieszany.`
    : `Zapisano nowe plany: ${sizes} miejsc.`
}
export const UNDO_DONE_MESSAGE = 'Przywrócono poprzednie plany.'
export const UNDO_REFUSED_MESSAGE = 'Nie można cofnąć — plany zmieniono po wygenerowaniu.'

/** Isolated guest (task 011): has group 1/2 partners, none of them at the table. */
export const ISOLATED_LABEL = 'Bez znajomych przy stole'
export const ISOLATED_HINT = 'nikt z grup 1 i 2 tu nie siedzi'

/** Children (task 014) take a seat but are not scored: the server sends them all-zero scores. */
export const CHILD_NOT_SCORED =
  'Dziecko — nie wlicza się do zadowolenia (zajmuje miejsce przy stole).'
export const STRANGERS_ADULTS_LABEL = 'Obcych dorosłych przy stole'
export const SCORE_ADULTS_HINT = 'Suma zadowolenia dorosłych — dzieci się nie liczą'

/**
 * A score the way the server computed it. Table and plan scores are whole numbers and can be
 * negative (a "-3" is fine: isolated guests cost 1 each); only a single guest's satisfaction can
 * end in ,5.
 */
export const scoreLabel = (score: number) =>
  score.toLocaleString('pl-PL', { maximumFractionDigits: 1 })

/** "30 s", "5 min", "2 godz." — the wait shown under the PIN field, rounded up so it never lies short. */
export function waitLabel(seconds: number): string {
  if (seconds < 60) return `${seconds} s`
  if (seconds < 3600) return `${Math.ceil(seconds / 60)} min`
  return `${Math.ceil(seconds / 3600)} godz.`
}
