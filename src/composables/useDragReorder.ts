import type { CSSProperties } from 'vue'
import { onScopeDispose, ref } from 'vue'
import { dropIndex } from '@/utils/reorder'

/**
 * How close to the top of the viewport the finger has to be before the page
 * starts scrolling under it. The bottom needs more room: the action bar and
 * the navigation together cover about 112 px there, and a finger held over
 * them is not near the edge of anything the user can see.
 */
const SCROLL_MARGIN_TOP = 72
const SCROLL_MARGIN_BOTTOM = 160
/**
 * Pixels a second. Measured against the clock rather than counted per frame,
 * because this is a phone-first app and phones ship 90 Hz and 120 Hz panels:
 * a per-frame step tuned at 60 Hz runs at twice the speed on one of those and
 * at half on a device that has throttled itself down to 30.
 */
const SCROLL_SPEED = 700

/**
 * Drag-to-reorder for a list of sibling elements, without the HTML drag & drop
 * API — that one is mouse-only, and this is a phone-first app, so the gesture
 * is built out of pointer events instead.
 *
 * The list is never reordered while the drag is in flight. The picked-up row
 * follows the finger and the rows it has passed slide out of its way, both as
 * transforms, which change nothing about the layout underneath: the elements
 * stay where they were, so the geometry the drop index is computed from stays
 * valid for the whole gesture and Vue is asked to re-render the list exactly
 * once, when the finger comes up.
 *
 * The caller marks each row with the attributes from `itemAttrs`, hands
 * `start` the pointerdown from that row's handle, and gets the finished move
 * as `onDrop`. Which row was picked up is read back off the DOM rather than
 * passed in, so the index and the geometry can only ever come from the same
 * list.
 *
 * @param onDrop called with the id the picked-up row was marked with, and the
 * gap it was dropped into counted in the list that row has been taken out of,
 * as `moveItem` expects. The id is read when the row is picked up, not when it
 * lands: a drag spans seconds, and by the end of one the index it started from
 * may well name a different row.
 */
export function useDragReorder (onDrop: (id: string, to: number) => void) {
  /** Which row is in the air, or null when nothing is being dragged. */
  const from = ref<number | null>(null)
  /** Which gap it would drop into if the finger came up now. */
  const to = ref(0)
  /** How far the picked-up row is drawn from where it sits. */
  const offset = ref(0)
  /** How far the rows it has passed are drawn from where they sit. */
  const step = ref(0)

  /**
   * Midpoints in *document* coordinates, so that scrolling the page mid-drag
   * does not invalidate them; the pointer is converted to the same space.
   */
  let midpoints: number[] = []
  /** Where the pointer went down, in document coordinates. */
  let origin = 0
  /**
   * What the picked-up row was marked with, read at pickup and handed back at
   * the drop so the caller never has to re-read the row from an index.
   */
  let dragId = ''
  /** The pointer's last position, kept so autoscrolling can re-derive the drag. */
  let pointerY = 0
  /**
   * Which pointer picked the row up. The listeners are on `window`, so they
   * hear every pointer on the page, and on a phone there is usually more than
   * one: a second finger resting on the screen raises its own `pointerup` and
   * would otherwise drop the row wherever the first finger happened to be, or
   * a `pointercancel` that would abandon the drag without a word.
   */
  let pointerId = -1
  let scrolling: number | undefined
  /** Timestamp of the last autoscroll frame, to measure the next one against. */
  let lastFrame = 0

  /**
   * Picks up the row the pointerdown's handle is on. Has to be called while
   * that event is still being dispatched — which a handler, or a component
   * that re-emits it, is — because the handle is `currentTarget`, and that is
   * only set for as long as the dispatch lasts.
   */
  function start (event: PointerEvent) {
    // The secondary mouse button opens a context menu; it does not pick things
    // up. Touch and pen report 0 here, like the primary button.
    if (event.button !== 0 || from.value !== null) {
      return
    }
    const handle = event.currentTarget as HTMLElement
    const item = handle.closest<HTMLElement>('[data-drag-item]')
    const list = item?.parentElement
    if (!item || !list) {
      return
    }
    const items = [...list.querySelectorAll<HTMLElement>(':scope > [data-drag-item]')]
    const index = items.indexOf(item)
    const id = item.dataset.dragId
    if (index === -1 || id === undefined) {
      return
    }

    midpoints = items.map(row => {
      const rect = row.getBoundingClientRect()
      return rect.top + rect.height / 2 + window.scrollY
    })
    // What the rows this one passes have to move by to leave a gap the right
    // size: the row's own height plus the margin below it, which is the space
    // it takes out of the column.
    const rect = item.getBoundingClientRect()
    step.value = rect.height + Number.parseFloat(getComputedStyle(item).marginBottom)
    origin = event.clientY + window.scrollY
    pointerY = event.clientY
    dragId = id
    pointerId = event.pointerId
    from.value = index
    to.value = index
    offset.value = 0

    // Keeps every later event for this pointer — including the click the
    // browser synthesizes after a mouse drag — aimed at the handle, which
    // swallows clicks. Without it a short drag inside one card ends as a click
    // on that card and opens it for editing.
    handle.setPointerCapture(event.pointerId)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
    window.addEventListener('keydown', onKeyDown)
  }

  function onPointerMove (event: PointerEvent) {
    if (event.pointerId !== pointerId) {
      return
    }
    pointerY = event.clientY
    update()
    if (scrollDirection() === 0) {
      stopScrolling()
    } else if (scrolling === undefined) {
      // Seeded here rather than in the frame itself, so the first one covers
      // the time since the finger reached the edge and not since whenever the
      // page happened to load.
      lastFrame = performance.now()
      scrolling = requestAnimationFrame(scrollStep)
    }
  }

  /** Re-derives the drag from the last pointer position and the page's scroll. */
  function update () {
    if (from.value === null) {
      return
    }
    offset.value = pointerY + window.scrollY - origin
    to.value = dropIndex(midpoints, from.value, midpoints[from.value]! + offset.value)
  }

  /** Which way the page should be scrolling under the finger, if at all. */
  function scrollDirection (): number {
    if (pointerY < SCROLL_MARGIN_TOP) {
      return -1
    }
    if (pointerY > window.innerHeight - SCROLL_MARGIN_BOTTOM) {
      return 1
    }
    return 0
  }

  /**
   * Scrolls the page while the finger sits at an edge, so a row can be dragged
   * past the end of the screen. The finger is not moving, so nothing else
   * would recompute the drag — `update` runs here as well, which is also what
   * keeps the picked-up row under the finger rather than scrolling away with
   * the page.
   */
  function scrollStep (now: number) {
    scrolling = undefined
    const direction = scrollDirection()
    if (direction === 0 || from.value === null) {
      return
    }
    window.scrollBy(0, direction * SCROLL_SPEED * (now - lastFrame) / 1000)
    lastFrame = now
    update()
    scrolling = requestAnimationFrame(scrollStep)
  }

  function stopScrolling () {
    if (scrolling !== undefined) {
      cancelAnimationFrame(scrolling)
      scrolling = undefined
    }
  }

  function onPointerUp (event: PointerEvent) {
    if (event.pointerId !== pointerId) {
      return
    }
    const source = from.value
    const target = to.value
    const id = dragId
    finish()
    if (source !== null && target !== source) {
      onDrop(id, target)
    }
  }

  /**
   * The browser taking the gesture away — a system gesture, or the touch
   * being interrupted. Only the pointer holding the row can end its drag.
   */
  function onPointerCancel (event: PointerEvent) {
    if (event.pointerId === pointerId) {
      cancel()
    }
  }

  /** Escape puts the row back where it came from, as a drag elsewhere would. */
  function onKeyDown (event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      cancel()
    }
  }

  function cancel () {
    finish()
  }

  function finish () {
    from.value = null
    offset.value = 0
    pointerId = -1
    stopScrolling()
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerCancel)
    window.removeEventListener('keydown', onKeyDown)
  }

  // Leaving the session mid-drag would otherwise leave the listeners behind.
  onScopeDispose(finish)

  /** How far row `index` is drawn from where it actually sits. */
  function shiftFor (index: number): number {
    if (from.value === null) {
      return 0
    }
    if (index === from.value) {
      return offset.value
    }
    if (index > from.value && index <= to.value) {
      return -step.value
    }
    if (index < from.value && index >= to.value) {
      return step.value
    }
    return 0
  }

  function styleFor (index: number): CSSProperties | undefined {
    const shift = shiftFor(index)
    return shift === 0 ? undefined : { transform: `translateY(${shift}px)` }
  }

  /**
   * Everything a row in the list needs: the marker `start` finds it by, the
   * id it is named by once it is in the air, the classes that lift it and let
   * the others slide, and its transform. Bound in one go with `v-bind`.
   *
   * The sliding transition is only on while a drag is in flight. At the drop
   * the transforms all fall away in the same tick as the reordered list is
   * rendered, and animating that would mean animating rows away from where
   * their new content already is.
   */
  function itemAttrs (index: number, id: string) {
    return {
      'data-drag-item': '',
      'data-drag-id': id,
      'class': {
        'drag-item--lifted': index === from.value,
        'drag-item--sliding': from.value !== null && index !== from.value,
      },
      'style': styleFor(index),
    }
  }

  return { itemAttrs, start }
}
