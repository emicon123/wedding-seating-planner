import { BabyIcon, SearchIcon, XIcon } from 'lucide-react'
import { useId } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  hasActiveFilters,
  type GroupFilter,
  type GuestFilters as Filters,
  type StatusFilter,
} from '@/domain/guestFilters'
import { cn } from '@/lib/utils'

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Wszyscy' },
  { value: 'on', label: 'Uwzględnieni' },
  { value: 'off', label: 'Wyłączeni' },
]

const GROUP_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'Każda grupa' },
  { value: '0', label: 'Ma grupę 0' },
  { value: '1', label: 'Ma grupę 1' },
  { value: '2', label: 'Ma grupę 2' },
  { value: 'brak', label: 'Bez powiązań' },
]

function groupFromValue(value: string): GroupFilter {
  if (value === '0') return 0
  if (value === '1') return 1
  if (value === '2') return 2
  return value === 'brak' ? 'none' : 'all'
}

function groupToValue(group: GroupFilter): string {
  if (group === 'all') return 'all'
  return group === 'none' ? 'brak' : `${group}`
}

type GuestFiltersProps = {
  filters: Filters
  onChange: (next: Filters) => void
  onClear: () => void
}

export function GuestFilters({ filters, onChange, onClear }: GuestFiltersProps) {
  const searchId = useId()
  const groupId = useId()
  const radioName = useId()

  return (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
      <div className="min-w-52 flex-1">
        <label htmlFor={searchId} className="mb-1 block text-sm font-medium">
          Szukaj gościa
        </label>
        <div className="relative">
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            id={searchId}
            type="search"
            value={filters.query}
            onChange={(event) => onChange({ ...filters, query: event.target.value })}
            placeholder="np. michal"
            autoComplete="off"
            className="pl-9"
          />
        </div>
      </div>

      <fieldset>
        <legend className="mb-1 text-sm font-medium">Status</legend>
        <div className="inline-flex rounded-md border border-input bg-card p-0.5">
          {STATUS_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={cn(
                'cursor-pointer rounded-[5px] px-3 py-1.5 text-sm font-medium transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50',
                filters.status === option.value
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent',
              )}
            >
              <input
                type="radio"
                name={radioName}
                value={option.value}
                checked={filters.status === option.value}
                onChange={() => onChange({ ...filters, status: option.value })}
                className="sr-only"
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>

      <Button
        type="button"
        variant="outline"
        aria-pressed={filters.childrenOnly}
        onClick={() => onChange({ ...filters, childrenOnly: !filters.childrenOnly })}
        className={cn('h-10', filters.childrenOnly && 'border-brass bg-brass/20')}
      >
        <BabyIcon aria-hidden="true" />
        Dzieci
      </Button>

      <div>
        <label htmlFor={groupId} className="mb-1 block text-sm font-medium">
          Grupa
        </label>
        <select
          id={groupId}
          value={groupToValue(filters.group)}
          onChange={(event) => onChange({ ...filters, group: groupFromValue(event.target.value) })}
          className="h-10 rounded-md border border-input bg-card px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
        >
          {GROUP_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {hasActiveFilters(filters) && (
        <Button type="button" variant="ghost" onClick={onClear} className="h-10">
          <XIcon aria-hidden="true" />
          Wyczyść filtry
        </Button>
      )}
    </div>
  )
}
