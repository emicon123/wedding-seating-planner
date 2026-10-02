import { XIcon } from 'lucide-react'
import { useMemo } from 'react'
import { toast } from 'sonner'
import { clusterOf } from '@/domain/companions'
import { errorMessage } from '@/api/errorMessage'
import { useCreateGuest, useDeleteLink, useUpsertLink } from '@/api/guests'
import { GroupMark } from '@/components/GroupMark'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { buildGuestIndex, type GuestIndex } from '@/domain/guestIndex'
import { linkKey } from '@/domain/guestList'
import { parseGuestName } from '@/domain/guestName'
import { pluralPl, viaLabel } from '@/domain/labels'
import { linkColumns, warningsForGuest, type ColumnEntry } from '@/domain/linkColumns'
import type { ClusterOverview, Guest, LinkLevel } from '@/domain/types'
import { ClusterWarnings } from '@/features/guests/ClusterWarnings'
import { GuestSearchCombobox } from '@/features/guests/GuestSearchCombobox'

const LEVELS: LinkLevel[] = [0, 1, 2]

const LEVEL_HINT: Record<LinkLevel, string> = {
  0: 'Muszą siedzieć razem, przy jednym stole.',
  1: 'Chcą siedzieć razem, jeśli się da.',
  2: 'Mogą siedzieć razem, tylko gdy nie ma innej opcji.',
}

type LinkColumnProps = {
  level: LinkLevel
  guest: Guest
  guests: Guest[]
  index: GuestIndex
  entries: ColumnEntry[]
  clusterSize: number | undefined
  nameOf: (guestId: number) => string
  onPick: (level: LinkLevel, other: Guest) => Promise<void>
  onCreate: (level: LinkLevel, name: string) => Promise<void>
  onRemove: (otherId: number) => void
}

function LinkColumn({
  level,
  guest,
  guests,
  index,
  entries,
  clusterSize,
  nameOf,
  onPick,
  onCreate,
  onRemove,
}: LinkColumnProps) {
  const excludeIds = useMemo(
    () => new Set([guest.id, ...entries.filter((entry) => entry.direct).map((e) => e.guestId)]),
    [guest.id, entries],
  )
  const currentLevel = (guestId: number) =>
    guest.links.find((link) => link.guestId === guestId)?.level

  return (
    <section
      aria-label={`Grupa ${level}`}
      className="space-y-2 rounded-lg border bg-background/60 p-3"
    >
      <div className="space-y-1">
        <GroupMark level={level} />
        <p className="text-xs text-muted-foreground">{LEVEL_HINT[level]}</p>
        {level === 0 && clusterSize !== undefined && clusterSize > 1 && (
          <p className="text-xs font-medium">
            Paczka: {pluralPl(clusterSize, 'osoba', 'osoby', 'osób')} przy jednym stole
          </p>
        )}
      </div>

      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nikogo.</p>
      ) : (
        <ul className="space-y-1">
          {entries.map((entry) => (
            <li key={entry.guestId} className="flex items-center justify-between gap-2 text-sm">
              {entry.direct ? (
                <>
                  <span className="font-medium">{nameOf(entry.guestId)}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => onRemove(entry.guestId)}
                    className="text-muted-foreground hover:text-brick"
                  >
                    <XIcon aria-hidden="true" />
                    <span className="sr-only">Usuń powiązanie: {nameOf(entry.guestId)}</span>
                  </Button>
                </>
              ) : (
                <span className="text-muted-foreground">
                  + <span className="font-medium text-foreground">{nameOf(entry.guestId)}</span>
                  {entry.via && <> ({viaLabel(entry.via.reason, nameOf(entry.via.guestId))})</>}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <GuestSearchCombobox
        label={`Dodaj do grupy ${level}`}
        guests={guests}
        index={index}
        excludeIds={excludeIds}
        currentLevel={currentLevel}
        onPick={(other) => onPick(level, other)}
        onCreate={(name) => onCreate(level, name)}
      />
    </section>
  )
}

type LinkEditorProps = {
  guest: Guest
  guests: Guest[]
  /** Undefined while loading or when it failed: own links still show, the derived part waits. */
  overview: ClusterOverview | undefined
  onClose: () => void
}

/**
 * Group 0 / 1 / 2 of one guest (003-frontend-design §5). Links are symmetric, so a link set here
 * shows on the other guest too. The derived part ("+ Ola (przez grupę 0: Michał)") is who comes
 * along automatically through the group-0 cluster; it is read-only.
 */
export function LinkEditor({ guest, guests, overview, onClose }: LinkEditorProps) {
  const upsert = useUpsertLink()
  const remove = useDeleteLink()
  const create = useCreateGuest()

  const index = useMemo(() => buildGuestIndex(guests), [guests])
  const names = useMemo(
    () => new Map(guests.map((candidate) => [candidate.id, candidate.displayName])),
    [guests],
  )
  const nameOf = (guestId: number) => names.get(guestId) ?? `Gość ${guestId}`
  const columns = linkColumns(guest.id, guests, overview)
  const cluster = overview ? clusterOf(guest.id, overview) : undefined
  const warnings = overview ? warningsForGuest(guest.id, overview) : []

  async function pick(level: LinkLevel, other: Guest) {
    await upsert.mutateAsync({ linkKey: linkKey(guest.id, other.id), level })
  }

  /** Two calls, one gesture: create the missing guest, then link them. */
  async function createAndLink(level: LinkLevel, name: string) {
    const parsed = parseGuestName(name)
    if (!parsed) return
    const created = await create.mutateAsync({ ...parsed, isChild: false })
    try {
      await upsert.mutateAsync({ linkKey: linkKey(guest.id, created.id), level })
    } catch (failure) {
      toast.error(
        `Dodano gościa ${created.displayName}, ale nie udało się go powiązać. ${errorMessage(failure)}`,
      )
    }
  }

  async function removeLink(otherId: number) {
    try {
      await remove.mutateAsync(linkKey(guest.id, otherId))
    } catch (failure) {
      toast.error(errorMessage(failure))
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Powiązania: {guest.displayName}</DialogTitle>
          <DialogDescription>
            Powiązania są dwustronne: widać je też u drugiej osoby. Osoby z grupy 0 dołączają
            automatycznie ze swoją paczką.
          </DialogDescription>
        </DialogHeader>

        <ClusterWarnings warnings={warnings} nameOf={nameOf} />

        <div className="grid gap-3 md:grid-cols-3">
          {LEVELS.map((level) => (
            <LinkColumn
              key={level}
              level={level}
              guest={guest}
              guests={guests}
              index={index}
              entries={columns[level]}
              clusterSize={cluster?.guestIds.length}
              nameOf={nameOf}
              onPick={pick}
              onCreate={createAndLink}
              onRemove={(otherId) => void removeLink(otherId)}
            />
          ))}
        </div>
        {!overview && (
          <p className="text-sm text-muted-foreground">
            Wczytuję paczki, żeby pokazać, kto dołącza automatycznie…
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
