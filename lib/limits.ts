/** Small async semaphore: at most `max` tasks run at once. */
export function createLimiter(max: number) {
  const limit = Math.max(1, Math.floor(max));
  let active = 0;
  const waiting: Array<() => void> = [];

  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= limit) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    active += 1;
    try {
      return await task();
    } finally {
      active -= 1;
      const next = waiting.shift();
      if (next) next();
    }
  };
}

const int = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const imageThumbLimit = createLimiter(
  int(process.env.THUMB_CONCURRENCY_IMAGES, 4),
);
export const videoThumbLimit = createLimiter(
  int(process.env.THUMB_CONCURRENCY_VIDEOS, 2),
);
export const transcodeConcurrency = int(process.env.TRANSCODE_CONCURRENCY, 2);
