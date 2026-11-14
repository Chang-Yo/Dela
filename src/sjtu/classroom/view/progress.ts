// 课堂视频的播放进度按录像 id 保存在本机 localStorage：与下载进度无关，
// 也不依赖校园会话或签名媒体地址，重新登录、重启应用后仍可恢复。
const KEY_PREFIX = 'dela.classroom.progress.';
const MIN_SAVE_SECONDS = 1;
// 距结尾不足 1 秒视为已看完；正常播放结束也会主动清除，这里兜底异常退出留下的尾部进度。
const COMPLETE_MARGIN_SECONDS = 1;

function progressKey(videoId: number): string {
  return `${KEY_PREFIX}${videoId}`;
}

/** 读取整秒进度；缺失、损坏或不足 1 秒返回 null。 */
export function readPlaybackProgress(videoId: number): number | null {
  try {
    const raw = localStorage.getItem(progressKey(videoId));
    if (raw === null) return null;
    const seconds = Number(raw);
    return Number.isFinite(seconds) && seconds >= MIN_SAVE_SECONDS ? Math.floor(seconds) : null;
  } catch {
    return null;
  }
}

/** 写入整秒进度；不足 1 秒不写入，存储不可用时静默忽略。 */
export function savePlaybackProgress(videoId: number, seconds: number): void {
  if (!Number.isFinite(seconds)) return;
  const whole = Math.floor(seconds);
  if (whole < MIN_SAVE_SECONDS) return;
  try {
    localStorage.setItem(progressKey(videoId), String(whole));
  } catch {
    /* localStorage 不可用不影响播放 */
  }
}

export function clearPlaybackProgress(videoId: number): void {
  try {
    localStorage.removeItem(progressKey(videoId));
  } catch {
    /* localStorage 不可用不影响播放 */
  }
}

/** 把保存值换算成可恢复的秒数；接近结尾视为已看完，返回 null。 */
export function resumePlaybackTime(saved: number | null, duration: number): number | null {
  if (saved === null || saved < MIN_SAVE_SECONDS) return null;
  if (!Number.isFinite(duration) || duration <= 0) return null;
  if (saved >= duration - COMPLETE_MARGIN_SECONDS) return null;
  return Math.min(saved, duration);
}
