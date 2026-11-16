// 课堂视频的播放进度按录像 id 保存在本机 localStorage：与下载进度无关，
// 也不依赖校园会话或签名媒体地址，重新登录、重启应用后仍可恢复。
const KEY_PREFIX = 'dela.classroom.progress.';
const MIN_SAVE_SECONDS = 1;
const SAVE_INTERVAL_SECONDS = 5;
// 距结尾不足 1 秒视为已看完；正常播放结束也会主动清除，这里兜底异常退出留下的尾部进度。
const COMPLETE_MARGIN_SECONDS = 1;

function progressKey(videoId: number): string {
  return `${KEY_PREFIX}${videoId}`;
}

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

export function resumePlaybackTime(saved: number | null, duration: number): number | null {
  if (saved === null || saved < MIN_SAVE_SECONDS) return null;
  if (!Number.isFinite(duration) || duration <= 0) return null;
  if (saved >= duration - COMPLETE_MARGIN_SECONDS) return null;
  return Math.min(saved, duration);
}

/** 一场录像的进度记录：播放中按 5 秒节流落盘，暂停、切画面与离开页面时强制落盘。 */
export function createProgressTracker(videoId: number) {
  let position = 0;
  let saved = 0;
  return {
    position: () => position,
    record(time: number, force = false) {
      if (!Number.isFinite(time) || time < 0) return;
      position = time;
      if (!force && Math.abs(time - saved) < SAVE_INTERVAL_SECONDS) return;
      savePlaybackProgress(videoId, time);
      saved = time;
    },
    flush() {
      savePlaybackProgress(videoId, position);
      saved = position;
    },
    reset(time: number) {
      position = time;
      saved = time;
    },
  };
}
