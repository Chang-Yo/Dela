import { z } from 'zod';
import type { TranscriptSegment, VideoTranscript } from '../../shared/vsjtu';

const segment = z
  .object({ bg: z.number().nonnegative(), ed: z.number().nonnegative(), res: z.string() })
  .refine((value) => value.ed >= value.bg);
const transcriptData = z.object({ afterAssemblyList: z.array(segment) });

export function parseTranscript(data: unknown, videoId: number): VideoTranscript | null {
  if (data === null) return null;
  const parsed = transcriptData.safeParse(data);
  if (!parsed.success) throw new Error('交大视频文稿数据格式已变化');
  const segments = parsed.data.afterAssemblyList
    .map(({ bg, ed, res }) => ({ startMs: bg, endMs: ed, text: res.trim() }))
    .filter(({ text }) => text.length > 0)
    .sort((a, b) => a.startMs - b.startMs);
  return segments.length ? { videoId, segments } : null;
}

function timestamp(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const time = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map((value) => String(value).padStart(2, '0'))
    .join(':');
  return `${time}.${String(Math.floor(ms % 1000)).padStart(3, '0')}`;
}

/** 跨平台保存文件名：非法字符与控制字符换成下划线，去掉结尾的点/空格，限长 100。 */
export function safeFileName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\p{Cc}]/gu, '_')
    .replace(/[. ]+$/g, '')
    .slice(0, 100);
}

/** 正文单独导出：分页读取不携带存文件用的标题头。 */
export function formatSegments(segments: TranscriptSegment[]): string {
  return `${segments
    .map(({ startMs, endMs, text }) => `[${timestamp(startMs)}–${timestamp(endMs)}] ${text}`)
    .join('\n\n')}\n`;
}

export function formatTranscript(transcript: VideoTranscript, title: string): string {
  return `${title}\n录像 ID：${transcript.videoId}\n\n${formatSegments(transcript.segments)}`;
}
