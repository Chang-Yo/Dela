// 水源 User API Key 每 60 秒限 20 次（实测）。前台请求只记账不排队；
// 后台请求只在窗口内不足 BACKGROUND_LIMIT 次时发出，给前台留出余量；任何 429 暂停后台。
const WINDOW_MS = 60_000;
const BACKGROUND_LIMIT = 10;
const DEFAULT_PAUSE_MS = 60_000;

let sentAt: number[] = [];
let pausedUntil = 0;

function prune(now: number): void {
  sentAt = sentAt.filter((at) => now - at < WINDOW_MS);
}

export function recordShuiyuanRequest(): void {
  const now = Date.now();
  prune(now);
  sentAt.push(now);
}

export async function waitForShuiyuanBackgroundSlot(signal?: AbortSignal): Promise<void> {
  for (;;) {
    signal?.throwIfAborted();
    const now = Date.now();
    prune(now);
    const wait = Math.max(
      pausedUntil - now,
      sentAt.length < BACKGROUND_LIMIT ? 0 : sentAt[0]! + WINDOW_MS - now,
    );
    if (wait <= 0) {
      sentAt.push(now);
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, wait);
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(signal.reason);
        },
        { once: true },
      );
    });
  }
}

export function noteShuiyuanResponse(response: Response): void {
  if (response.status !== 429) return;
  const seconds = Number(response.headers.get('retry-after'));
  pausedUntil = Math.max(
    pausedUntil,
    Date.now() + (seconds > 0 ? seconds * 1000 : DEFAULT_PAUSE_MS),
  );
}
