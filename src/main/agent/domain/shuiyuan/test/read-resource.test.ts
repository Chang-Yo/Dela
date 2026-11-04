import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('../../../../mail/api', () => ({ readMailMessage: vi.fn() }));
vi.mock('../../../../settings/prefs', () => ({ assertShuiyuanEnabled: vi.fn() }));
vi.mock('../../../../resources', () => ({ readResourceContent: vi.fn() }));
vi.mock('../../../../shuiyuan/api', () => ({
  getShuiyuanTopic: vi.fn(),
  getShuiyuanState: () => ({ connected: true }),
}));
vi.mock('../../../../shuiyuan/snapshot-files', () => ({ readShuiyuanSnapshot: vi.fn() }));
vi.mock('../../../../shuiyuan/sources', () => ({
  getShuiyuanSourceRef: vi.fn(),
  shuiyuanTopicUrl: (id: number) => `https://shuiyuan.sjtu.edu.cn/t/topic/${id}`,
  shuiyuanPostsHtml: (posts: { cooked: string }[]) => posts.map((post) => post.cooked).join(''),
}));

import { readResourceTool } from '../../read-resource';
import { getShuiyuanTopic } from '../../../../shuiyuan/api';
import { readShuiyuanSnapshot } from '../../../../shuiyuan/snapshot-files';
import { getShuiyuanSourceRef } from '../../../../shuiyuan/sources';
import { readResourceContent } from '../../../../resources';

const ref = { type: 'shuiyuan-online', id: 42 };
beforeEach(() => vi.resetAllMocks());

it('always reads online even when a local snapshot exists', async () => {
  vi.mocked(readShuiyuanSnapshot).mockResolvedValue({ title: '本地' } as never);
  vi.mocked(getShuiyuanTopic).mockResolvedValue({
    title: '在线',
    posts: [{ id: 1, cooked: '<p>在线正文</p>' }],
    stream: [1, 2],
    lastPostedAt: null,
  } as never);
  const result = await readResourceTool.execute({ ref });
  expect(getShuiyuanTopic).toHaveBeenCalledExactlyOnceWith(42);
  expect(result).toMatchObject({
    title: '在线',
    freshness: { kind: 'realtime' },
    note: expect.stringContaining('1/2'),
  });
  expect(readShuiyuanSnapshot).not.toHaveBeenCalled();
});

it('reports online failure without silently substituting a snapshot or excerpt', async () => {
  vi.mocked(getShuiyuanTopic).mockRejectedValue(new Error('无法连接水源'));
  await expect(readResourceTool.execute({ ref })).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  expect(readShuiyuanSnapshot).not.toHaveBeenCalled();
  expect(getShuiyuanSourceRef).not.toHaveBeenCalled();
});

it('rejects the ambiguous old resource type', () => {
  expect(() => readResourceTool.execute({ ref: { type: 'shuiyuan-topic', id: 42 } })).toThrow();
});

it('keeps workspace references on the local document read path', async () => {
  const workspaceRef = { type: 'workspace', id: '00000000-0000-4000-8000-000000000042' };
  vi.mocked(readResourceContent).mockResolvedValue({
    title: '项目来源',
    format: 'html',
    text: '本地正文',
  });
  expect(await readResourceTool.execute({ ref: workspaceRef })).toMatchObject({ text: '本地正文' });
  expect(readResourceContent).toHaveBeenCalledExactlyOnceWith(workspaceRef);
  expect(getShuiyuanTopic).not.toHaveBeenCalled();
});
