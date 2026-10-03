import { useState } from 'react'
import { toast } from 'sonner'
import { errorMessage } from '@/api/errorMessage'
import { ApiError } from '@/api/errors'
import { useAcceptProposal, useDiscardProposals, useDropProposal } from '@/api/scenarios'
import { Button } from '@/components/ui/button'
import { acceptConflictMessage } from '@/domain/labels'
import { isProposalStale, toAcceptTables } from '@/domain/planView'
import type { Capacity, Proposal, Scenario } from '@/domain/types'
import { ProposalCard } from '@/features/plans/ProposalCard'

type ProposalPreviewProps = {
  proposals: Proposal[]
  scenarios: Scenario[]
}

/**
 * The preview of Generate (state machine §2 "Previewing"): four proposals side by side with the
 * figures of today's plans. Nothing is stored until a proposal is accepted; each accept is its own
 * version-checked PUT, so a conflict hits only that plan and the others stay accepted.
 */
export function ProposalPreview({ proposals, scenarios }: ProposalPreviewProps) {
  const { mutateAsync: accept } = useAcceptProposal()
  const dropProposal = useDropProposal()
  const discard = useDiscardProposals()
  const [busy, setBusy] = useState(false)

  const scenarioOf = (capacity: Capacity) => scenarios.find((s) => s.capacity === capacity)
  const staleOf = (proposal: Proposal) => isProposalStale(proposal, scenarioOf(proposal.capacity))

  /** Accepts the given proposals in parallel; returns the capacities that were stored. */
  async function acceptAll(chosen: Proposal[]): Promise<Capacity[]> {
    setBusy(true)
    try {
      const results = await Promise.allSettled(
        chosen.map(async (proposal) => {
          await accept({
            capacity: proposal.capacity,
            basedOnVersion: proposal.basedOnVersion,
            tables: toAcceptTables(proposal.plan),
          })
          dropProposal(proposal.capacity)
          return proposal.capacity
        }),
      )
      const stored: Capacity[] = []
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          stored.push(result.value)
          return
        }
        const capacity = chosen[index]?.capacity ?? 0
        const conflict = result.reason instanceof ApiError && result.reason.status === 409
        toast.error(conflict ? acceptConflictMessage(capacity) : errorMessage(result.reason))
      })
      return stored
    } finally {
      setBusy(false)
    }
  }

  async function onAcceptOne(proposal: Proposal) {
    const stored = await acceptAll([proposal])
    if (stored.length > 0) toast.success(`Zapisano plan na ${proposal.capacity} miejsc.`)
  }

  async function onAcceptAll() {
    const fresh = proposals.filter((proposal) => !staleOf(proposal))
    const stored = await acceptAll(fresh)
    if (stored.length > 0) toast.success(`Zapisano plany: ${stored.join(', ')} miejsc.`)
    for (const proposal of proposals) {
      if (staleOf(proposal)) toast.error(acceptConflictMessage(proposal.capacity))
    }
  }

  return (
    <section
      aria-labelledby="podglad"
      className="space-y-4 rounded-2xl border-2 border-dashed border-brass bg-brass/10 p-4 sm:p-5"
    >
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-prose space-y-1">
          <h2 id="podglad" className="text-2xl font-semibold">
            Propozycje do przejrzenia
          </h2>
          <p className="text-sm text-muted-foreground">
            To tylko podgląd, nic nie zostało zapisane. Zaakceptuj wybrany plan, kilka albo
            wszystkie. Przypięte paczki zostają przy swoich stołach.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={busy} onClick={() => void onAcceptAll()}>
            Akceptuj wszystkie
          </Button>
          <Button type="button" variant="outline" disabled={busy} onClick={discard}>
            Odrzuć
          </Button>
        </div>
      </header>
      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {proposals.map((proposal) => (
          <li key={proposal.capacity}>
            <ProposalCard
              proposal={proposal}
              current={scenarioOf(proposal.capacity)}
              stale={staleOf(proposal)}
              busy={busy}
              onAccept={() => void onAcceptOne(proposal)}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}
