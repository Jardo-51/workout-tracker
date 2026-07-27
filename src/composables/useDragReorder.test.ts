import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import { useDragReorder } from '@/composables/useDragReorder'

/**
 * The composable is the only part of the reorder gesture that talks to the
 * DOM, so testing it means giving it one. A hand-built stub rather than jsdom
 * or happy-dom: it needs six window members and four element methods, all of
 * which it reads exactly once each, and a real DOM implementation would cost a
 * dependency to lay out rows this file has to fake the geometry of anyway —
 * nothing here has a layout engine to ask.
 *
 * The frame queue and the listener registry are stubbed rather than merely
 * recorded because the tests drive them: a drag is only over when something
 * dispatches the pointerup, and the autoscroll only advances when a frame is
 * run with a timestamp of the test's choosing.
 */

interface ListStub { querySelectorAll: () => ItemStub[] }
interface ItemStub {
  dataset: { dragId: string }
  getBoundingClientRect: () => { top: number, height: number }
  parentElement: ListStub
}
interface HandleStub {
  closest: () => ItemStub
  setPointerCapture: (pointerId: number) => void
}

/** Three rows 100 tall with a 10 px gap, so the midpoints are 50, 160, 270. */
const ROWS = [
  { id: 'a', top: 0 },
  { id: 'b', top: 110 },
  { id: 'c', top: 220 },
]
const ROW_HEIGHT = 100
const ROW_MARGIN = 10
/** What a row that is passed slides by: its neighbour's height plus the gap. */
const STEP = ROW_HEIGHT + ROW_MARGIN
const VIEWPORT_HEIGHT = 800

let handles: HandleStub[]
let listeners: Map<string, Set<(event: unknown) => void>>
let frames: Map<number, (now: number) => void>
let nextFrameId: number

beforeEach(() => {
  listeners = new Map()
  frames = new Map()
  nextFrameId = 1

  const items: ItemStub[] = []
  const list: ListStub = { querySelectorAll: () => items }
  for (const row of ROWS) {
    items.push({
      dataset: { dragId: row.id },
      getBoundingClientRect: () => ({ top: row.top, height: ROW_HEIGHT }),
      parentElement: list,
    })
  }
  handles = items.map(item => ({
    closest: () => item,
    setPointerCapture: vi.fn(),
  }))

  const win = {
    scrollY: 0,
    innerHeight: VIEWPORT_HEIGHT,
    scrollBy (_x: number, y: number) {
      win.scrollY += y
    },
    addEventListener (type: string, handler: (event: unknown) => void) {
      const set = listeners.get(type) ?? new Set<(event: unknown) => void>()
      set.add(handler)
      listeners.set(type, set)
    },
    removeEventListener (type: string, handler: (event: unknown) => void) {
      listeners.get(type)?.delete(handler)
    },
  }

  vi.stubGlobal('window', win)
  vi.stubGlobal('getComputedStyle', () => ({ marginBottom: `${ROW_MARGIN}px` }))
  vi.stubGlobal('requestAnimationFrame', (callback: (now: number) => void) => {
    frames.set(nextFrameId, callback)
    return nextFrameId++
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => void frames.delete(id))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function mount () {
  const onDrop = vi.fn()
  const scope = effectScope()
  const drag = scope.run(() => useDragReorder(onDrop))!
  return { drag, onDrop, scope }
}

function pointerDown (row: number, clientY: number, overrides: Partial<{ button: number, pointerId: number }> = {}) {
  return {
    button: 0,
    pointerId: 1,
    clientY,
    currentTarget: handles[row],
    ...overrides,
  } as unknown as PointerEvent
}

/**
 * Dispatches to a copy of the set, because the handlers being run are the ones
 * that tear themselves down: Escape unregisters the very `keydown` listener
 * that is handling it.
 */
function fire (type: string, event: unknown) {
  const handlers = new Set(listeners.get(type))
  for (const handler of handlers) {
    handler(event)
  }
}

/** How many listeners the composable currently has on `window`. */
function listenerCount () {
  return [...listeners.values()].reduce((total, set) => total + set.size, 0)
}

/** Runs the one frame the autoscroll has pending, at the given timestamp. */
function runFrame (now: number) {
  const [id, callback] = [...frames][0]!
  frames.delete(id)
  callback(now)
}

describe('useDragReorder', () => {
  it('drops the row it picked up, named by its id and not its index', () => {
    const { drag, onDrop } = mount()

    drag.start(pointerDown(0, 50))
    // 120 px down puts the first row's midpoint at 170, past the second row's
    // 160 and short of the third's 270.
    fire('pointermove', { pointerId: 1, clientY: 170 })
    fire('pointerup', { pointerId: 1 })

    expect(onDrop).toHaveBeenCalledExactlyOnceWith('a', 1)
  })

  it('says nothing when the row is let go where it was picked up', () => {
    const { drag, onDrop } = mount()

    drag.start(pointerDown(1, 160))
    fire('pointermove', { pointerId: 1, clientY: 170 })
    fire('pointerup', { pointerId: 1 })

    expect(onDrop).not.toHaveBeenCalled()
  })

  it('does not pick anything up with the secondary mouse button', () => {
    const { drag, onDrop } = mount()

    drag.start(pointerDown(0, 50, { button: 2 }))

    expect(listenerCount()).toBe(0)
    fire('pointerup', { pointerId: 1 })
    expect(onDrop).not.toHaveBeenCalled()
  })

  it('lifts the dragged row and slides the ones it has passed', () => {
    const { drag } = mount()

    drag.start(pointerDown(0, 50))
    fire('pointermove', { pointerId: 1, clientY: 170 })

    expect(drag.itemAttrs(0, 'a').class['drag-item--lifted']).toBe(true)
    expect(drag.itemAttrs(0, 'a').style).toEqual({ transform: 'translateY(120px)' })
    expect(drag.itemAttrs(1, 'b').style).toEqual({ transform: `translateY(-${STEP}px)` })
    // The third row was never passed, so it stays where it is.
    expect(drag.itemAttrs(2, 'c').style).toBeUndefined()
  })

  it('ignores a second finger resting on the screen mid-drag', () => {
    const { drag, onDrop } = mount()

    drag.start(pointerDown(0, 50))
    fire('pointermove', { pointerId: 1, clientY: 170 })

    // A second finger anywhere on the page: its move must not drag the row,
    // and neither its lift nor a cancel from it may end the gesture.
    fire('pointermove', { pointerId: 2, clientY: 780 })
    fire('pointerup', { pointerId: 2 })
    fire('pointercancel', { pointerId: 2 })

    expect(onDrop).not.toHaveBeenCalled()
    // Its move was near the bottom edge; had it landed, the page would be
    // autoscrolling now.
    expect(frames.size).toBe(0)

    fire('pointerup', { pointerId: 1 })
    expect(onDrop).toHaveBeenCalledExactlyOnceWith('a', 1)
  })

  it('puts the row back when its own pointer is cancelled', () => {
    const { drag, onDrop } = mount()

    drag.start(pointerDown(0, 50))
    fire('pointermove', { pointerId: 1, clientY: 170 })
    fire('pointercancel', { pointerId: 1 })

    expect(onDrop).not.toHaveBeenCalled()
    expect(listenerCount()).toBe(0)
    expect(drag.itemAttrs(0, 'a').style).toBeUndefined()
  })

  it('puts the row back on Escape', () => {
    const { drag, onDrop } = mount()
    const event = { key: 'Escape', preventDefault: vi.fn() }

    drag.start(pointerDown(0, 50))
    fire('pointermove', { pointerId: 1, clientY: 170 })
    fire('keydown', event)

    expect(onDrop).not.toHaveBeenCalled()
    expect(event.preventDefault).toHaveBeenCalled()
    expect(listenerCount()).toBe(0)
  })

  it('leaves nothing on window once the row is dropped', () => {
    const { drag } = mount()

    drag.start(pointerDown(0, 50))
    expect(listenerCount()).toBe(4)

    fire('pointermove', { pointerId: 1, clientY: 170 })
    fire('pointerup', { pointerId: 1 })
    expect(listenerCount()).toBe(0)
  })

  it('leaves nothing on window when the page is left mid-drag', () => {
    const { drag, scope } = mount()

    drag.start(pointerDown(0, 50))
    fire('pointermove', { pointerId: 1, clientY: 170 })
    scope.stop()

    expect(listenerCount()).toBe(0)
    expect(frames.size).toBe(0)
  })

  it('autoscrolls at a speed the frame rate cannot change', () => {
    const { drag } = mount()

    drag.start(pointerDown(0, 50))
    const started = performance.now()
    // Held in the bottom margin, which starts 160 px above the fold.
    fire('pointermove', { pointerId: 1, clientY: VIEWPORT_HEIGHT - 100 })

    // One long frame and ten short ones covering the same second scroll the
    // same distance, which counting pixels per frame would not.
    runFrame(started + 500)
    expect(window.scrollY).toBeCloseTo(350, 0)
    for (let frame = 1; frame <= 10; frame++) {
      runFrame(started + 500 + frame * 50)
    }
    expect(window.scrollY).toBeCloseTo(700, 0)
  })

  it('stops scrolling once the finger leaves the edge', () => {
    const { drag } = mount()

    drag.start(pointerDown(0, 50))
    fire('pointermove', { pointerId: 1, clientY: VIEWPORT_HEIGHT - 100 })
    expect(frames.size).toBe(1)

    fire('pointermove', { pointerId: 1, clientY: 400 })
    expect(frames.size).toBe(0)
  })
})
