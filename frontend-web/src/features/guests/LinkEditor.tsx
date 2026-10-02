import { ArrowLeftIcon, ListFilterIcon } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { errorMessage } from '@/api/errorMessage'
import { useApplyLinkChanges } from '@/api/guests'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { warningsForGuest } from '@/domain/linkColumns'
import { relationsOf, type Family } from '@/domain/relations'
import type { ClusterOverview, Guest, LinkLevel } from '@/domain/types'
import { ClusterWarnings } from '@/features/guests/ClusterWarnings'
import { LinkPicker } from '@/features/guests/LinkPicker'
import { RelationBlock } from '@/features/guests/RelationBlock'

const LEVELS: LinkLevel[] = [0, 1, 2]

type LinkEditorProps = {
  /** The person the panel opened on; names inside it open the next person. */
  guestId: number
  guests: Guest[]
  /** Undefined while loading or when it failed: own links still show, the derived part waits. */
  overview: ClusterOverview | undefined
  onClose: () => void
  /** Narrow the guest list to this person and their relations. */
  onShowInList: (guestId: number) => void
}

/**
 * The relationships panel of one guest (003-frontend-design §5): who is connected to them, by
 * group, with the reason for each person; every name opens that person (a trail with "Wróć" lets
 * the user walk the graph); "Edytuj" opens the checklist of one group. Group 0 is the whole
 * cluster (everyone who must sit with them, through chains too), not just the stored links, and
 * links are symmetric, so a link set from one guest shows on the other.
 */
export function LinkEditor({ guestId, guests, overview, onClose, onShowInList }: LinkEditorProps) {
  const apply = useApplyLinkChanges()
  const [trail, setTrail] = useState<number[]>(() => [guestId])
  const [picking, setPicking] = useState<LinkLevel | null>(null)
  // Radix only hands focus back to a Dialog.Trigger; ours is a plain button in the panel.
  const opener = useRef<HTMLElement | null>(null)

  const byId = useMemo(() => new Map(guests.map((guest) => [guest.id, guest])), [guests])
  const nameOf = (id: number) => byId.get(id)?.displayName ?? `Gość ${id}`
  const currentId = trail.at(-1) ?? guestId
  const guest = byId.get(currentId)
  const relations = useMemo(
    () => relationsOf(currentId, guests, overview),
    [currentId, guests, overview],
  )
  if (!guest) return null

  const warnings = overview ? warningsForGuest(guest.id, overview) : []
  const previousId = trail.length > 1 ? trail[trail.length - 2] : undefined

  async function removeLink(otherId: number) {
    const failed = await apply.mutateAsync({
      guestId: currentId,
      changes: [{ otherId, level: null }],
    })
    if (failed[0]) toast.error(errorMessage(failed[0].error))
  }

  /** One click removes the whole family: every direct link of this guest to its members. */
  async function removeFamily(family: Family) {
    const directIds = family.members.filter((member) => member.direct).map((member) => member.guestId)
    if (directIds.length === 0) return
    const failed = await apply.mutateAsync({
      guestId: currentId,
      changes: directIds.map((otherId) => ({ otherId, level: null })),
    })
    if (failed.length > 0) {
      const who = failed.map(({ otherId }) => nameOf(otherId)).join(', ')
      const why = [...new Set(failed.map(({ error }) => errorMessage(error)))].join(' ')
      toast.error(`Nie udało się usunąć: ${who}. ${why}`)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          {previousId !== undefined && (
            <nav aria-label="Ścieżka" className="-ml-2 flex flex-wrap items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setTrail((current) => current.slice(0, -1))}
              >
                <ArrowLeftIcon aria-hidden="true" />
                Wróć: {nameOf(previousId)}
              </Button>
              <span className="text-xs text-muted-foreground">{trail.map(nameOf).join(' › ')}</span>
            </nav>
          )}
          <DialogTitle>Powiązania: {guest.displayName}</DialogTitle>
          <DialogDescription>
            Powiązania są dwustronne: widać je też u drugiej osoby. Grupa 0 to cała paczka, także
            osoby połączone przez kogoś innego. Grupy 1 i 2 obejmują całe paczki po obu stronach.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold">Łącznie powiązanych: {relations.total}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => onShowInList(guest.id)}>
            <ListFilterIcon aria-hidden="true" />
            Pokaż na liście
          </Button>
        </div>

        <ClusterWarnings warnings={warnings} nameOf={nameOf} />

        <div className="grid gap-3 md:grid-cols-3">
          {LEVELS.map((level) => (
            <RelationBlock
              key={level}
              block={relations.blocks[level]}
              guestById={byId}
              nameOf={nameOf}
              onOpen={(id) => setTrail((current) => [...current, id])}
              onEdit={(level, button) => {
                opener.current = button
                setPicking(level)
              }}
              onRemove={(otherId) => void removeLink(otherId)}
              onRemoveFamily={(family) => void removeFamily(family)}
            />
          ))}
        </div>
        {!overview && (
          <p className="text-sm text-muted-foreground">
            Wczytuję paczki, żeby pokazać wszystkich powiązanych…
          </p>
        )}

        {picking !== null && (
          <LinkPicker
            key={`${currentId}-${picking}`}
            guest={guest}
            guests={guests}
            overview={overview}
            level={picking}
            onClose={() => setPicking(null)}
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              opener.current?.focus()
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
