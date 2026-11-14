import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('../../../../../main/mail/api', () => ({ readMailMessage: vi.fn() }));
vi.mock('../../../../../main/settings/prefs', () => ({ assertShuiyuanEnabled: vi.fn() }));
vi.mock('../../../../../main/resources', () => ({ readWorkspaceResource: vi.fn() }));
vi.mock('../../../../../modules/workspace', () => ({ workspaceFilePath: vi.fn() }));
vi.mock('../../api', () => ({
  getShuiyuanTopic: vi.fn(),
  getShuiyuanState: () => ({ connected: true }),
}));
vi.mock('../../snapshot-files', () => ({ readShuiyuanSnapshot: vi.fn() }));
vi.mock('../../sources', () => ({
  getShuiyuanSourceRef: vi.fn(),
  shuiyuanTopicUrl: (id: number) => `https://shuiyuan.sjtu.edu.cn/t/topic/${id}`,
  shuiyuanPostsHtml: (posts: { cooked: string }[]) => posts.map((post) => post.cooked).join(''),
}));

import {
  builtinResourceResolvers,
  readResourceTool,
} from '../../../../../main/agent/domain/read-resource';
import { shuiyuanOnlineResourceResolver } from '../../resources';
import {
  registerResourceResolver,
  type ResourceResolver,
} from '../../../../../core/capabilities/resources';
import { getShuiyuanTopic } from '../../api';
import { readShuiyuanSnapshot } from '../../snapshot-files';
import { getShuiyuanSourceRef } from '../../sources';
import { readWorkspaceResource } from '../../../../../main/resources';

for (const [type, resolver] of Object.entries(builtinResourceResolvers))
  registerResourceResolver(type, resolver as ResourceResolver);
registerResourceResolver('shuiyuan-online', shuiyuanOnlineResourceResolver);

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
  vi.mocked(readWorkspaceResource).mockResolvedValue({
    title: '项目来源',
    format: 'html',
    text: '本地正文',
  });
  expect(await readResourceTool.execute({ ref: workspaceRef })).toMatchObject({ text: '本地正文' });
  expect(readWorkspaceResource).toHaveBeenCalledExactlyOnceWith(workspaceRef.id);
  expect(getShuiyuanTopic).not.toHaveBeenCalled();
});
