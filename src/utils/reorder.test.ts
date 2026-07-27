import { describe, expect, it } from 'vitest'
import { dropIndex, moveItem } from '@/utils/reorder'

describe('moveItem', () => {
  const list = ['a', 'b', 'c', 'd']

  it('moves an item down the list', () => {
    expect(moveItem(list, 0, 2)).toEqual(['b', 'c', 'a', 'd'])
  })

  it('moves an item up the list', () => {
    expect(moveItem(list, 3, 1)).toEqual(['a', 'd', 'b', 'c'])
  })

  it('counts the target in the list without the moved item', () => {
    // The last index of a four-item list is 3, not 4: 'a' is out of it by the
    // time the gap it drops into is counted.
    expect(moveItem(list, 0, 3)).toEqual(['b', 'c', 'd', 'a'])
  })

  it('leaves the list it was given alone', () => {
    const original = [...list]
    moveItem(list, 0, 2)
    expect(list).toEqual(original)
  })
})

describe('dropIndex', () => {
  // Four rows of unequal height, as an exercise card and a break are: their
  // midpoints are what the drag is decided on, not the gaps between them.
  const midpoints = [50, 140, 180, 260]

  it('keeps the row where it is while it has passed nobody', () => {
    expect(dropIndex(midpoints, 0, 50)).toBe(0)
    expect(dropIndex(midpoints, 2, 180)).toBe(2)
  })

  it('swaps as soon as the row is over its neighbour’s midpoint', () => {
    expect(dropIndex(midpoints, 0, 139)).toBe(0)
    expect(dropIndex(midpoints, 0, 141)).toBe(1)
  })

  it('counts the same way dragging up', () => {
    expect(dropIndex(midpoints, 3, 141)).toBe(2)
    expect(dropIndex(midpoints, 3, 139)).toBe(1)
    expect(dropIndex(midpoints, 3, 49)).toBe(0)
  })

  it('does not count the row being dragged as one it has passed', () => {
    // Held above every midpoint, the last row belongs at the end — where it
    // already is. Counting its own midpoint would put it past the end.
    expect(dropIndex(midpoints, 3, 1000)).toBe(3)
  })

  it('clamps to the list at either end without being told to', () => {
    expect(dropIndex(midpoints, 1, -9999)).toBe(0)
    expect(dropIndex(midpoints, 1, 9999)).toBe(3)
  })
})
