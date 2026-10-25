import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { classroomTools } from '../index';
import { getTranscript, listCourses, listVideos } from '../../../../vsjtu/api';

vi.mock('../../../../vsjtu/api', async () => ({
  ...(await import('../../../../vsjtu/transcript')),
  getTranscript: vi.fn(),
  listCourses: vi.fn(),
  listVideos: vi.fn(),
}));
let directory: string;
beforeEach(async () => {
  vi.clearAllMocks();
  directory = await mkdtemp(join(tmpdir(), 'dela-transcript-'));
  vi.mocked(getTranscript).mockResolvedValue({
    videoId: 11,
    segments: [
      { startMs: 0, endMs: 60000, text: '前段' },
      { startMs: 60000, endMs: 120000, text: '中段'.repeat(400) },
      { startMs: 300000, endMs: 360000, text: '后段' },
    ],
  });
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

it('bounds output, paginates within the same time range and does not write files', async () => {
  const input = { videoId: 11, startSeconds: 60, endSeconds: 120, limit: 100 };
  const first = (await classroomTools.read_classroom_transcript.execute(input)) as {
    text: string;
    nextOffset: number;
  };
  expect(first).toMatchObject({ available: true, nextOffset: 100, nextStartSeconds: 120 });
  expect(first.text).toHaveLength(100);
  expect(first.text).not.toContain('前段');
  const second = (await classroomTools.read_classroom_transcript.execute({
    ...input,
    offset: first.nextOffset,
  })) as { text: string };
  const combined = (await classroomTools.read_classroom_transcript.execute({
    ...input,
    limit: 200,
  })) as { text: string };
  expect(first.text + second.text).toBe(combined.text);
  expect(await readdir(directory)).toEqual([]);
  await expect(
    classroomTools.read_classroom_transcript.execute({
      videoId: 11,
      startSeconds: 100,
      endSeconds: 50,
    }),
  ).rejects.toThrow();
});

it('defaults to five minutes and distinguishes unavailable text from an empty interval', async () => {
  const result = (await classroomTools.read_classroom_transcript.execute({ videoId: 11 })) as {
    text: string;
  };
  expect(result).toMatchObject({ startSeconds: 0, endSeconds: 300, nextStartSeconds: 300 });
  expect(result.text).not.toContain('后段');
  expect(
    await classroomTools.read_classroom_transcript.execute({ videoId: 11, startSeconds: 400 }),
  ).toMatchObject({ available: true, text: '' });
  vi.mocked(getTranscript).mockResolvedValue(null);
  expect(await classroomTools.read_classroom_transcript.execute({ videoId: 11 })).toMatchObject({
    available: false,
    text: '',
  });
});

it('downloads selected complete lectures, reports partial failure and protects existing files', async () => {
  vi.mocked(listCourses).mockResolvedValue([{ id: 1, code: 'CS', name: '测试/课程' }]);
  vi.mocked(listVideos).mockResolvedValue(
    [11, 12, 13].map((id) => ({
      id,
      start: '2026-10-24 08:00',
      end: '09:00',
      room: '',
      period: '1',
    })),
  );
  const transcript = await getTranscript(11);
  vi.mocked(getTranscript).mockImplementation(async (id) => {
    if (id === 12) return null;
    if (id === 13) throw new Error('网络错误');
    return transcript;
  });
  const input = { courseId: 1, videoIds: [11, 12, 13, 11], directory };
  const result = (await classroomTools.download_classroom_transcripts.execute(input)) as {
    results: Array<{ status: string; path?: string }>;
  };
  expect(result.results.map((item) => item.status)).toEqual(['saved', 'unavailable', 'failed']);
  const path = result.results[0]!.path!;
  const text = await readFile(path, 'utf8');
  expect(text).toContain('后段');
  expect(
    await classroomTools.download_classroom_transcripts.execute({ ...input, videoIds: [11] }),
  ).toMatchObject({ results: [{ status: 'failed' }] });
  expect(await readFile(path, 'utf8')).toBe(text);
  await expect(
    classroomTools.download_classroom_transcripts.execute({ ...input, videoIds: [99] }),
  ).rejects.toThrow('不在指定课程');
});
