import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import { AccessGate } from '@/app/AccessGate'
import { Layout } from '@/app/Layout'
import { Loading } from '@/app/Loading'
import { PlanRoute } from '@/app/PlanRoute'
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

// Routes only: the router itself (basename /wesele) is mounted in main.tsx, so tests can supply
// a MemoryRouter.
export function App() {
  return (
    <Routes>
      <Route element={<AccessGate />}>
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
            path="plany/:planKey"
            element={
              <PlanRoute
                render={(planKey) => (
                  <Suspense fallback={<Loading />}>
                    <PlanDetailPage planKey={planKey} />
                  </Suspense>
                )}
              />
            }
          />
        </Route>
        <Route
          path="druk/:planKey"
          element={
            <PlanRoute
              render={(planKey) => (
                <Suspense fallback={<Loading />}>
                  <PrintView planKey={planKey} />
                </Suspense>
              )}
            />
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
