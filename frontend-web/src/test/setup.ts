import '@testing-library/jest-dom/vitest'
import { toast } from 'sonner'
import { server } from '@/test/server'

// Browser stubs for jsdom; the build test runs in the node environment and needs none.
if (typeof window !== 'undefined') {
  // jsdom has no matchMedia (sonner reads it) and no scrollIntoView (Radix focus handling).
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
    }),
  })

  // jsdom lacks pointer capture, which sonner calls when a toast is pressed.
  Element.prototype.setPointerCapture ??= () => {}
  Element.prototype.releasePointerCapture ??= () => {}

  // Radix measures some controls (checkbox, switch) with ResizeObserver.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  toast.dismiss() // sonner keeps its toasts in a module-level store that outlives a test
})
afterAll(() => server.close())
