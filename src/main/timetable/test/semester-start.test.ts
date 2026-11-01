import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../vsjtu/api', () => ({
  listCourses: vi.fn(),
  listVideos: vi.fn(),
}));

import { listCourses, listVideos } from '../../vsjtu/api';
import { inferSemesterStartFromVideos } from '../semester-start';

const courses = vi.mocked(listCourses);
const videos = vi.mocked(listVideos);

beforeEach(() => {
  vi.clearAllMocks();
});

const video = (id: number, start: string) => ({ id, start, end: start, room: '', period: '1' });

describe('inferSemesterStartFromVideos', () => {
  it('collects recordings from every course and keeps read failures as warnings', async () => {
    courses.mockResolvedValue([
      { id: 1, code: 'CHN2800J', name: '中国现代文学概述' },
      { id: 2, code: 'PHYS2500J', name: '普通物理（2）' },
      { id: 3, code: 'ECE2150J', name: '电路设计导论' },
    ]);
    videos.mockImplementation(async (courseId: number) => {
      if (courseId === 3) throw new Error('登录已失效，请重新登录');
      return [
        video(
          courseId === 1 ? 11 : 21,
          courseId === 1 ? '2026-09-14 11:50:20' : '2026-09-15 16:00:00',
        ),
      ];
    });

    const result = await inferSemesterStartFromVideos('2026-2027-1');

    expect(result.candidate).toBe('2026-09-14');
    expect(result.confidence).toBe('high');
    expect(result.checkedCourses).toBe(3);
    expect(result.failures).toEqual(['电路设计导论：登录已失效，请重新登录']);
  });

  it('fails loudly when no course recording can be read', async () => {
    courses.mockResolvedValue([{ id: 1, code: 'CHN2800J', name: '中国现代文学概述' }]);
    videos.mockRejectedValue(new Error('登录已失效，请重新登录'));
    await expect(inferSemesterStartFromVideos('2026-2027-1')).rejects.toThrow('无法推断开学日期');
  });

  it('returns no candidate when the semester has no recordings yet', async () => {
    courses.mockResolvedValue([{ id: 1, code: 'CHN2800J', name: '中国现代文学概述' }]);
    videos.mockResolvedValue([]);
    const result = await inferSemesterStartFromVideos('2026-2027-1');
    expect(result.candidate).toBeNull();
    expect(result.confidence).toBe('none');
    expect(result.failures).toEqual([]);
  });
});
