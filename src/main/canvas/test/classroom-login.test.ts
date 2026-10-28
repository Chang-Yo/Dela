import { afterEach, expect, it, vi } from 'vitest';

vi.mock('../../credentials', () => ({ loadCanvasToken: () => 'test-token' }));
vi.mock('../../database', () => ({ getDatabase: vi.fn() }));
import { classroomLoginUrl } from '../api';

afterEach(() => vi.unstubAllGlobals());

it('launches the requested Canvas course instead of the first active course', async () => {
  const requests: URL[] = [];
  vi.stubGlobal('fetch', async (input: URL) => {
    const url = new URL(input);
    requests.push(url);
    if (url.pathname === '/login/session_token')
      return Response.json({ session_url: `https://oc.sjtu.edu.cn/login?${url.searchParams}` });
    const courseId = url.pathname.match(/courses\/(\d+)\/tabs/)?.[1];
    if (courseId)
      return Response.json([
        {
          label: '课堂视频新版',
          html_url: `https://oc.sjtu.edu.cn/courses/${courseId}/external_tools/2`,
        },
      ]);
    return Response.json([{ id: 1 }]);
  });
  const url = new URL(await classroomLoginUrl(42));
  expect(url.searchParams.get('return_to')).toBe(
    'https://oc.sjtu.edu.cn/courses/42/external_tools/2',
  );
  expect(requests.map((url) => url.pathname)).toEqual([
    '/api/v1/courses/42/tabs',
    '/login/session_token',
  ]);
});
