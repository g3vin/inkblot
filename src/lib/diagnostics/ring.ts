/**
 * ring.ts — a fixed-size buffer that forgets its oldest entry, for the logs a report
 * carries: recording costs the same on the first keystroke and the millionth.
 */
export class Ring<T> {
  private items: T[] = []
  private start = 0

  constructor(readonly capacity: number) {}

  push(item: T): void {
    if (this.items.length < this.capacity) this.items.push(item)
    else {
      this.items[this.start] = item
      this.start = (this.start + 1) % this.capacity
    }
  }

  /** The newest entry, to update in place. */
  last(): T | undefined {
    if (!this.items.length) return undefined
    return this.items[(this.start + this.items.length - 1) % this.items.length]
  }

  /** Oldest first; at most the newest `limit`. */
  toArray(limit = this.capacity): T[] {
    const ordered = [...this.items.slice(this.start), ...this.items.slice(0, this.start)]
    return ordered.slice(Math.max(0, ordered.length - limit))
  }

  get size(): number {
    return this.items.length
  }
}
