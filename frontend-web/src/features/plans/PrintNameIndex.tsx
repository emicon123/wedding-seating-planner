import { BabyIcon } from 'lucide-react'
import type { NameIndexEntry, NameIndexSection } from '@/domain/printPlan'
import { cn } from '@/lib/utils'

/** A short letter is kept in one column; a long one may flow on, its heading stays with the first rows. */
const SHORT_SECTION = 8

function IndexRow({ entry }: { entry: NameIndexEntry }) {
  return (
    <li className="flex break-inside-avoid items-baseline gap-2 py-px print:py-0">
      <span className="min-w-0">
        <span className="font-semibold">{entry.surname}</span>
        {entry.given && <span> {entry.given}</span>}
        {entry.isChild && (
          <>
            <BabyIcon aria-hidden="true" className="ml-1 inline size-3.5 align-[-2px]" />
            <span className="sr-only"> dziecko</span>
          </>
        )}
      </span>
      <span aria-hidden="true" className="min-w-3 flex-1 border-b border-dotted border-ink/50" />
      {entry.tableNumber === null ? (
        <span className="shrink-0 text-sm font-semibold italic">bez stołu</span>
      ) : (
        <span className="w-9 shrink-0 rounded-md border-2 border-ink text-center font-display text-lg leading-6 font-semibold">
          <span className="sr-only">stół </span>
          {entry.tableNumber}
        </span>
      )}
    </li>
  )
}

/**
 * "Kto przy którym stole": the page people actually read at the venue. Alphabetical by surname,
 * a letter heading per initial, the table number big and boxed at the end of a dotted leader.
 */
export function PrintNameIndex({ sections }: { sections: NameIndexSection[] }) {
  return (
    <div className="columns-1 gap-x-8 text-[0.95rem] sm:columns-2 print:columns-3 print:gap-x-6 print:text-[10pt]">
      {sections.map((section) => (
        <section
          key={section.letter}
          aria-label={`Litera ${section.letter}`}
          className={cn('mb-3', section.entries.length <= SHORT_SECTION && 'break-inside-avoid')}
        >
          <h3 className="mb-0.5 break-after-avoid border-b-2 border-ink font-display text-xl leading-tight font-semibold">
            {section.letter}
          </h3>
          <ul>
            {section.entries.map((entry) => (
              <IndexRow key={entry.guestId} entry={entry} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
