/**
 * Async-iterable queue: producer calls `push()` to enqueue values, consumer
 * iterates via `for await`. When the producer calls `close()`, the iterator
 * completes after the queue drains.
 *
 * Used to feed user prompts into the Claude Agent SDK's streaming-input
 * `query({ prompt: AsyncIterable<SDKUserMessage> })`.
 */
export class PushableStream<T> implements AsyncIterable<T> {
  private queue: T[] = []
  private resolvers: Array<(result: IteratorResult<T>) => void> = []
  private closed = false

  push(value: T): void {
    if (this.closed) return
    const resolve = this.resolvers.shift()
    if (resolve) {
      resolve({ value, done: false })
    } else {
      this.queue.push(value)
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    for (const resolve of this.resolvers) {
      resolve({ value: undefined as T, done: true })
    }
    this.resolvers = []
  }

  get isClosed(): boolean {
    return this.closed
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.queue.length > 0) {
          return Promise.resolve({ value: this.queue.shift()!, done: false })
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined as T, done: true })
        }
        return new Promise(resolve => this.resolvers.push(resolve))
      },
      return: (): Promise<IteratorResult<T>> => {
        this.close()
        return Promise.resolve({ value: undefined as T, done: true })
      },
    }
  }
}
