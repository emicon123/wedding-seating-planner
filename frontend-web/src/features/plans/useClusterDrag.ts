import {
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DndContextProps,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core'
import { useMemo, useRef, useState } from 'react'
import { dropPreview } from '@/domain/dropPreview'
import {
  TRAY_ID,
  parseDropId,
  stepTarget,
  tableDropId,
  type DropTarget,
} from '@/domain/dropTargets'
import { dropHintLabel, peopleLabel } from '@/domain/labels'
import type { PlanKind } from '@/domain/plans'
import { sizeAfterDrop } from '@/domain/tableSizes'
import type { ClusterOverview, ClusterPlacement, SeatingPlan } from '@/domain/types'
import type { DropHint } from '@/features/plans/TableCard'

const NO_OVERVIEW: ClusterOverview = { clusters: [], warnings: [] }

/** Pointer: the table under the finger. Keyboard (no pointer): the target nearest the chip. */
const detectDropTarget: CollisionDetection = (args) =>
  args.pointerCoordinates ? pointerWithin(args) : closestCenter(args)

const INSTRUCTIONS =
  'Aby przenieść paczkę, naciśnij spację. Strzałkami wybierz stół lub pole „Bez stołu”, spacją upuść, Escape anuluje. Możesz też użyć przycisku „Przenieś do stołu…”.'

type Located = { cluster: ClusterPlacement; table: number | null }

type Options = {
  plan: SeatingPlan
  kind: PlanKind
  overview: ClusterOverview | undefined
  nameOf: (guestId: number) => string
  onMove: (cluster: ClusterPlacement, toTable: number | null) => void
}

type Drag = { clusterKey: number; over: DropTarget | null }

/**
 * Drag state machine of the floor plan (001-state-machine §3): pointer + touch + keyboard
 * sensors, Polish screen-reader announcements and the hover preview. Only `over` changes while
 * dragging, so a pointer move re-renders nothing but the dnd-kit overlay.
 */
export function useClusterDrag({ plan, kind, overview, nameOf, onMove }: Options) {
  const [drag, setDrag] = useState<Drag | null>(null)
  const cursor = useRef<string | undefined>(undefined)

  const located = useMemo(() => {
    const byKey = new Map<number, Located>()
    for (const table of plan.tables) {
      for (const cluster of table.clusters) {
        byKey.set(cluster.clusterKey, { cluster, table: table.number })
      }
    }
    for (const cluster of plan.unseated) byKey.set(cluster.clusterKey, { cluster, table: null })
    return byKey
  }, [plan])

  const order = useMemo(
    () => [...plan.tables.map((table) => tableDropId(table.number)), TRAY_ID],
    [plan.tables],
  )

  const coordinateGetter = useMemo<KeyboardCoordinateGetter>(
    () =>
      (event, { context: { droppableRects, collisionRect }, currentCoordinates }) => {
        const next = stepTarget(order, cursor.current, event.code)
        if (next === null) return undefined
        event.preventDefault()
        cursor.current = next
        const rect = droppableRects.get(next)
        if (!rect || !collisionRect) return currentCoordinates
        // put the middle of the dragged chip on the middle of the chosen table
        return {
          x: rect.left + rect.width / 2 - collisionRect.width / 2,
          y: rect.top + rect.height / 2 - collisionRect.height / 2,
        }
      },
    [order],
  )

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // a short press-and-hold, so that swiping still scrolls the page on a phone
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter }),
  )

  const activeLocation = drag ? located.get(drag.clusterKey) : undefined
  const over = drag?.over ?? null

  const preview = (location: Located, target: DropTarget) =>
    dropPreview(
      plan,
      location.cluster,
      target.kind === 'table' ? target.number : null,
      kind.capacity,
      overview ?? NO_OVERVIEW,
    )

  const hint = useMemo<DropHint | null>(() => {
    if (!activeLocation || over?.kind !== 'table') return null
    const sameTable = activeLocation.table === over.number
    return {
      preview: dropPreview(
        plan,
        activeLocation.cluster,
        over.number,
        kind.capacity,
        overview ?? NO_OVERVIEW,
      ),
      sameTable,
      sourceNumber: sameTable ? null : activeLocation.table,
    }
  }, [activeLocation, over, plan, kind.capacity, overview])

  const locationOf = (id: string | number): Located | undefined => {
    const key = String(id).replace(/^cluster-/, '')
    return located.get(Number(key))
  }
  const namesOf = (location: Located | undefined) =>
    location ? location.cluster.guestIds.map(nameOf).join(', ') : 'paczka'

  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      `Podniesiono paczkę: ${namesOf(locationOf(active.id))}. ${peopleLabel(locationOf(active.id)?.cluster.guestIds.length ?? 0)}.`,
    onDragOver: ({ active, over: hovered }) => {
      const target = parseDropId(hovered?.id)
      const location = locationOf(active.id)
      if (!target || !location) return 'Poza stołami.'
      if (target.kind === 'tray') return 'Pole „Bez stołu”. Upuszczenie zdejmie paczkę ze stołu.'
      const after = preview(location, target)
      const size = sizeAfterDrop(after.fillAfter, kind)
      return `Stół ${target.number}. ${dropHintLabel(after, kind.capacity, size)}.`
    },
    onDragEnd: ({ active, over: dropped }) => {
      const target = parseDropId(dropped?.id)
      const names = namesOf(locationOf(active.id))
      if (!target) return `Anulowano. Paczka ${names} zostaje na miejscu.`
      return target.kind === 'tray'
        ? `Paczka ${names} przeniesiona do pola „Bez stołu”.`
        : `Paczka ${names} przeniesiona do stołu ${target.number}.`
    },
    onDragCancel: ({ active }) =>
      `Anulowano. Paczka ${namesOf(locationOf(active.id))} zostaje na miejscu.`,
  }

  const dndProps: Omit<DndContextProps, 'children'> = {
    sensors,
    collisionDetection: detectDropTarget,
    accessibility: { announcements, screenReaderInstructions: { draggable: INSTRUCTIONS } },
    onDragStart: ({ active }) => {
      const key = active.data.current?.clusterKey
      if (typeof key !== 'number') return
      const at = located.get(key)?.table ?? null
      cursor.current = at === null ? TRAY_ID : tableDropId(at)
      setDrag({
        clusterKey: key,
        over: at === null ? { kind: 'tray' } : { kind: 'table', number: at },
      })
    },
    onDragOver: ({ over: hovered }) =>
      setDrag((current) => (current ? { ...current, over: parseDropId(hovered?.id) } : current)),
    onDragEnd: ({ active, over: dropped }) => {
      const location = locationOf(active.id)
      const target = parseDropId(dropped?.id)
      setDrag(null)
      if (!location || !target) return
      if (target.kind === 'tray') {
        if (location.table !== null) onMove(location.cluster, null)
      } else if (location.table !== target.number) {
        onMove(location.cluster, target.number)
      }
    },
    onDragCancel: () => setDrag(null),
  }

  return {
    dndProps,
    dragging: drag !== null,
    activeCluster: activeLocation?.cluster ?? null,
    over,
    hint,
  }
}
