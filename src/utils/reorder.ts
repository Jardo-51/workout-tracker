/**
 * Moves one item, counting `to` in the list the item has already been taken
 * out of — so moving item 0 to the end of a five-item list is `to === 4`, not
 * `5`. That is the same index an insertion point between two *other* items
 * has, which is what a drop is: the dragged row is out of the flow as far as
 * the user is concerned, and the gap it is dropped into is the one between the
 * rows that are left.
 */
export function moveItem<T> (items: T[], from: number, to: number): T[] {
  const result = [...items]
  const [item] = result.splice(from, 1)
  result.splice(to, 0, item!)
  return result
}

/**
 * Which gap a row picked up at `from` is currently over: the number of *other*
 * rows whose midpoint the dragged row's own midpoint has passed. Counting
 * midpoints rather than edges is what makes a row swap when it is halfway over
 * its neighbour, whatever the two heights are — an exercise card is several
 * times taller than a break.
 *
 * `midpoints` are where the rows sat when the drag started, measured once and
 * not again. Rows visibly slide out of the dragged row's way, and measuring
 * them where they have slid to would feed that back into the answer: a row
 * that moved because the drop index changed would change the drop index back,
 * and the two would flip against each other for as long as the finger sat near
 * the boundary. Held still, the geometry the decision is made on cannot move.
 */
export function dropIndex (midpoints: number[], from: number, center: number): number {
  let index = 0
  for (const [row, midpoint] of midpoints.entries()) {
    if (row !== from && midpoint < center) {
      index++
    }
  }
  return index
}
