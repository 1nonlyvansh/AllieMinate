/** Runs `worker` over every item with a capped concurrency (instead of the old one-at-a-time sequential
 * await-in-a-loop pattern, which made pasting/deleting more than a couple of files feel sluggish) and
 * reports live progress so the UI can show a real bar instead of a static "Sending…" label. */
export async function runWithProgress<T>(
  items: T[],
  worker: (item: T) => Promise<void>,
  onProgress: (done: number, total: number) => void,
  concurrency = 4,
): Promise<void> {
  if (items.length === 0) return;
  let index = 0;
  let done = 0;
  onProgress(0, items.length);

  async function runNext(): Promise<void> {
    const i = index++;
    if (i >= items.length) return;
    await worker(items[i]);
    done += 1;
    onProgress(done, items.length);
    await runNext();
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runNext));
}
