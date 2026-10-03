import { useCallback, useEffect, useState } from 'react'

const TICK_MS = 1000

/** Whole seconds left until a deadline; recomputed from the clock so a sleeping tab catches up. */
export function useCountdown() {
  const [state, setState] = useState({ deadline: 0, remaining: 0 })
  const running = state.remaining > 0

  useEffect(() => {
    if (!running) return
    const id = setInterval(() => {
      setState((current) => ({
        ...current,
        remaining: Math.max(0, Math.ceil((current.deadline - Date.now()) / TICK_MS)),
      }))
    }, TICK_MS)
    return () => clearInterval(id)
  }, [running])

  const start = useCallback((seconds: number) => {
    setState({ deadline: Date.now() + seconds * TICK_MS, remaining: seconds })
  }, [])

  return { remaining: state.remaining, start }
}
