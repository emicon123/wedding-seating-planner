// Polish copy for every code the server sends (one place, DRY). The server's own `message`
// is English and for logs only; the UI always maps `code` to these.
import { MIN_TABLE_FILL, type DropPreview } from '@/domain/dropPreview'
import type { GuestCounts } from '@/domain/guestList'
import type { ViaReason } from '@/domain/linkColumns'
import type { FillStatus } from '@/domain/tableStatus'
import type { DataWarning, ErrorCode, ErrorItem, LinkLevel, Violation } from '@/domain/types'

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

export function violationLabel(violation: Violation): string {
  const table = violation.tableNumber === null ? 'Stół' : `Stół ${violation.tableNumber}`
  const labels: Record<Violation['code'], string> = {
    over_capacity: `${table} jest przepełniony`,
    under_floor: `${table} ma za mało osób (minimum ${MIN_TABLE_FILL})`,
    cluster_split: 'Paczka jest rozdzielona między stoły',
    unseated_guests: `${pluralPl(violation.guestIds.length, 'osoba', 'osoby', 'osób')} bez stołu`,
    oversized_cluster: 'Paczka jest za duża na stół w tym planie',
  }
  return labels[violation.code]
}

export function warningLabel(warning: DataWarning): string {
  const labels: Record<DataWarning['code'], string> = {
    cluster_exceeds_8: 'Ta paczka (grupa 0) jest za duża na stół 8-osobowy',
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

// --- plans ------------------------------------------------------------------------------------

export const tableCountLabel = (count: number) => pluralPl(count, 'stół', 'stoły', 'stołów')

export const peopleLabel = (count: number) => pluralPl(count, 'osoba', 'osoby', 'osób')

/** "Bez naruszeń" / "2 naruszenia": the plan card's verdict line. */
export function violationCountLabel(count: number): string {
  return count === 0 ? 'Bez naruszeń' : pluralPl(count, 'naruszenie', 'naruszenia', 'naruszeń')
}

/** A fill counter that breaks a hard rule: shown as text next to an icon, never colour alone. */
export function fillStatusLabel(status: FillStatus, fill: number, capacity: number): string | null {
  if (status === 'over') return `Za dużo osób: ${fill}/${capacity}`
  if (status === 'under') return `Za mało osób (minimum ${MIN_TABLE_FILL})`
  return null
}

/** The hint over a hovered table while dragging (counts only, scores come from the server). */
export function dropHintLabel(preview: DropPreview, capacity: number): string {
  const base = `Po przeniesieniu: ${preview.fillAfter}/${capacity}`
  return preview.overCapacity ? `${base}, za dużo osób` : base
}

export function preferredHereLabel(count: number): string {
  return count === 0 ? 'Nikogo z grupy 1' : `${pluralPl(count, 'osoba', 'osoby', 'osób')} z grupy 1`
}

export function sourceUnderFloorLabel(tableNumber: number): string {
  return `Stół ${tableNumber} będzie miał za mało osób (minimum ${MIN_TABLE_FILL})`
}

export function placeLabel(place: number | 'unseated' | 'disabled'): string {
  if (place === 'unseated') return 'bez stołu'
  if (place === 'disabled') return 'wyłączony'
  return `stół ${place}`
}

export const acceptConflictMessage = (capacity: number) =>
  `Plan na ${capacity} miejsc zmienił się od wygenerowania propozycji. Wygeneruj plany ponownie.`

/** A satisfaction score the way the server computed it: 301 or 318,5 (never rounded further). */
export const scoreLabel = (score: number) =>
  score.toLocaleString('pl-PL', { maximumFractionDigits: 1 })
