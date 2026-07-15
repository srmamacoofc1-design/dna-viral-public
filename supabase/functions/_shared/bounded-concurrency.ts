/**
 * Maps items in stable, bounded chunks. A rejected chunk stops the queue, so
 * callers never continue issuing provider requests after a fail-closed audit
 * has already become unavailable.
 */
export async function mapInOrderedChunks<T, R>(
  items: readonly T[],
  maxConcurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const concurrency = Math.trunc(maxConcurrency);
  if (!Number.isFinite(concurrency) || concurrency < 1) {
    throw new Error("bounded_concurrency_invalid");
  }

  const results: R[] = [];
  for (let offset = 0; offset < items.length; offset += concurrency) {
    const chunk = items.slice(offset, offset + concurrency);
    const chunkResults = await Promise.all(
      chunk.map((item, position) => worker(item, offset + position)),
    );
    results.push(...chunkResults);
  }
  return results;
}
