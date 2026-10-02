import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import { CapacityRoute } from '@/app/CapacityRoute'
import { Layout } from '@/app/Layout'
import { PlansPage } from '@/features/plans/PlansPage'

// The landing screen is in the main bundle; the heavy screens (guest table, the drag & drop hall,
// the print view) load on first visit.
const GuestsPage = lazy(() =>
  import('@/features/guests/GuestsPage').then((m) => ({ default: m.GuestsPage })),
)
const PlanDetailPage = lazy(() =>
  import('@/features/plans/PlanDetailPage').then((m) => ({ default: m.PlanDetailPage })),
)
const PrintView = lazy(() =>
  import('@/features/plans/PrintView').then((m) => ({ default: m.PrintView })),
)

function Loading() {
  return <p className="p-4 text-muted-foreground">Wczytuję…</p>
}

// Routes only: the router itself (basename /wesele) is mounted in main.tsx, so tests can supply
// a MemoryRouter.
export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<PlansPage />} />
        <Route
          path="goscie"
          element={
            <Suspense fallback={<Loading />}>
              <GuestsPage />
            </Suspense>
          }
        />
        <Route
          path="plany/:capacity"
          element={
            <CapacityRoute
              render={(capacity) => (
                <Suspense fallback={<Loading />}>
                  <PlanDetailPage capacity={capacity} />
                </Suspense>
              )}
            />
          }
        />
      </Route>
      <Route
        path="druk/:capacity"
        element={
          <CapacityRoute
            render={(capacity) => (
              <Suspense fallback={<Loading />}>
                <PrintView capacity={capacity} />
              </Suspense>
            )}
          />
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
