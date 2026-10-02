import { Link, Outlet, useMatch } from 'react-router'
import { TableGlyph } from '@/components/TableGlyph'
import { Toaster } from '@/components/ui/sonner'
import { cn } from '@/lib/utils'

type NavTabProps = { to: string; active: boolean; children: string }

function NavTab({ to, active, children }: NavTabProps) {
  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-brass focus-visible:outline-none',
        active ? 'text-white' : 'text-white/65 hover:text-white',
      )}
    >
      {children}
      {active && (
        <span
          aria-hidden="true"
          className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-brass"
        />
      )}
    </Link>
  )
}

export function Layout() {
  const onRoot = useMatch('/') !== null
  const onPlan = useMatch('/plany/*') !== null
  const onGuests = useMatch('/goscie') !== null

  return (
    <div className="min-h-dvh">
      <a
        href="#tresc"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2"
      >
        Przejdź do treści
      </a>
      <header className="sticky top-0 z-40 border-b border-white/10 bg-ink text-primary-foreground">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4">
          <Link
            to="/"
            className="flex items-center gap-2 rounded-md py-2 focus-visible:ring-2 focus-visible:ring-brass focus-visible:outline-none"
          >
            <TableGlyph seats={8} className="size-9 text-white" />
            <span className="font-display text-xl font-semibold tracking-tight">Stoliki</span>
          </Link>
          <nav aria-label="Główna nawigacja" className="flex items-center gap-1">
            <NavTab to="/" active={onRoot || onPlan}>
              Plany
            </NavTab>
            <NavTab to="/goscie" active={onGuests}>
              Goście
            </NavTab>
          </nav>
        </div>
      </header>
      <main id="tresc" className="mx-auto max-w-7xl px-4 py-8 sm:py-10">
        <Outlet />
      </main>
      <Toaster />
    </div>
  )
}
