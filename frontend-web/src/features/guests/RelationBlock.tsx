import { BabyIcon, EyeOffIcon, XIcon } from 'lucide-react'
import { GroupMark } from '@/components/GroupMark'
import { GROUP_FRAME } from '@/components/groupFrame'
import { Button } from '@/components/ui/button'
import { GROUP_HINT, GROUP_TAGLINE, relationCountLabel, relationReasonLabel } from '@/domain/labels'
import type { Relation, RelationBlock as Block } from '@/domain/relations'
import type { Guest } from '@/domain/types'
import { cn } from '@/lib/utils'

type MemberProps = {
  relation: Relation
  guest: Guest | undefined
  nameOf: (guestId: number) => string
  onOpen: (guestId: number) => void
  onRemove: (guestId: number) => void
}

function Member({ relation, guest, nameOf, onOpen, onRemove }: MemberProps) {
  const name = nameOf(relation.guestId)
  const off = guest?.enabled === false
  return (
    <li className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <button
            type="button"
            aria-label={`Przejdź do: ${name}`}
            onClick={() => onOpen(relation.guestId)}
            className={cn(
              'rounded text-left font-medium underline decoration-dotted underline-offset-4 outline-none hover:decoration-solid focus-visible:ring-[3px] focus-visible:ring-ring/50',
              off && 'text-muted-foreground',
            )}
          >
            {name}
          </button>
          {guest?.isChild && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-brass-ink">
              <BabyIcon aria-hidden="true" className="size-3.5" />
              Dziecko
            </span>
          )}
          {off && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <EyeOffIcon aria-hidden="true" className="size-3.5" />
              wyłączony
            </span>
          )}
        </p>
        <p className="text-xs text-muted-foreground">{relationReasonLabel(relation, nameOf)}</p>
      </div>
      {relation.direct && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => onRemove(relation.guestId)}
          className="shrink-0 text-muted-foreground hover:text-brick"
        >
          <XIcon aria-hidden="true" />
          <span className="sr-only">Usuń powiązanie: {name}</span>
        </Button>
      )}
    </li>
  )
}

type RelationBlockProps = {
  block: Block
  guestById: ReadonlyMap<number, Guest>
  nameOf: (guestId: number) => string
  onOpen: (guestId: number) => void
  /** The button that was pressed comes along so the editor can give focus back to it. */
  onEdit: (level: Block['level'], opener: HTMLElement) => void
  onRemove: (guestId: number) => void
  /** One click removes the whole family: every direct link of this guest to its members. */
  onRemoveFamily: (family: Block['families'][number]) => void
}

/**
 * One group of the relationships panel: who is linked at this level, grouped by family (group-0
 * cluster) and with the reason for each person. Colour, outline form, icon and text all carry
 * the group (GroupMark), so it also reads in greyscale.
 */
export function RelationBlock({
  block,
  guestById,
  nameOf,
  onOpen,
  onEdit,
  onRemove,
  onRemoveFamily,
}: RelationBlockProps) {
  const { level, families } = block
  const empty = block.personCount === 0
  return (
    <section
      aria-label={`Grupa ${level}`}
      className="space-y-3 rounded-lg border bg-background/60 p-3"
    >
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <GroupMark level={level} />
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={empty ? `Wybierz gości do grupy ${level}` : `Edytuj grupę ${level}`}
            onClick={(event) => onEdit(level, event.currentTarget)}
          >
            {empty ? 'Wybierz gości…' : 'Edytuj'}
          </Button>
        </div>
        <p className="text-sm font-medium">
          {GROUP_TAGLINE[level][0]?.toUpperCase()}
          {GROUP_TAGLINE[level].slice(1)}
        </p>
        <p className="text-xs text-muted-foreground">{GROUP_HINT[level]}</p>
        <p className="text-sm font-semibold">
          {relationCountLabel(
            block.personCount,
            level === 0 ? block.personCount : block.familyCount,
          )}
        </p>
      </div>

      {!empty && (
        <ul className="space-y-2">
          {families.map((family) => {
            const directCount = family.members.filter((member) => member.direct).length
            const removable = family.members.length > 1 && directCount > 0
            return (
              <li key={family.key}>
                <ul className={cn('space-y-2 rounded-md p-2', GROUP_FRAME[level])}>
                  {family.members.map((relation) => (
                    <Member
                      key={relation.guestId}
                      relation={relation}
                      guest={guestById.get(relation.guestId)}
                      nameOf={nameOf}
                      onOpen={onOpen}
                      onRemove={onRemove}
                    />
                  ))}
                  {removable && (
                    <li className="flex justify-end pt-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onRemoveFamily(family)}
                        className="text-muted-foreground hover:text-brick"
                        aria-label={`Usuń rodzinę: ${family.members.map((member) => nameOf(member.guestId)).join(', ')}`}
                      >
                        <XIcon aria-hidden="true" />
                        Usuń rodzinę
                      </Button>
                    </li>
                  )}
                </ul>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
