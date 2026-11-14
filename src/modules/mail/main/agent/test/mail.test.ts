// search_mail / list_mail_folders 的统一契约：未配置报 NOT_CONFIGURED、
// coverage 对象化（folders 附带）、freshness 取账号最近同步时间。
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../mail/api', async () => {
  const { z } = await import('zod');
  return {
    mailSearchSchema: z.object({ query: z.string().default('') }),
    searchMail: vi.fn(),
    listMailFolders: vi.fn(),
    getMailState: vi.fn(),
  };
});

import { getMailState, listMailFolders, searchMail } from '../../../../mail/api';
import { listMailFoldersTool } from '../list-folders';
import { searchMailTool } from '../search-mail';

const account = {
  account: { address: 'user@sjtu.edu.cn', lastSyncedAt: '2026-09-01T08:00:00Z' },
  sync: {
    phase: 'idle' as const,
    folderPath: null,
    processed: 0,
    total: null,
    error: null,
    startedAt: null,
    finishedAt: null,
  },
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getMailState).mockReturnValue(account);
});

describe('search_mail', () => {
  it('邮箱未配置时报 NOT_CONFIGURED，不执行搜索', async () => {
    vi.mocked(getMailState).mockReturnValue({
      account: null,
      sync: account.sync,
    });
    await expect(searchMailTool.execute({ query: '课' })).rejects.toMatchObject({
      code: 'NOT_CONFIGURED',
    });
    expect(searchMail).not.toHaveBeenCalled();
  });

  it('coverage 标注 uid 窗口缺口并附带 folders', async () => {
    vi.mocked(searchMail).mockReturnValue({
      items: [
        {
          id: 1,
          subject: '关于课程',
          senderName: '教务处',
          senderAddress: 'jwc@sjtu.edu.cn',
          date: '2026-09-01T00:00:00Z',
          snippet: null,
          folderId: 2,
          ref: { type: 'mail' as const, id: 1 },
        },
      ],
      nextOffset: null,
      coverage: {
        scope: 'cached_subjects_and_snippets',
        uidWindowPerFolder: 300,
        completeMailbox: false,
        folders: [{ id: 2, name: 'INBOX', syncedAt: '2026-09-01T08:00:00Z' }],
      },
    });
    await expect(searchMailTool.execute({ query: '课程' })).resolves.toMatchObject({
      items: [
        expect.objectContaining({ id: 1, subject: '关于课程', ref: { type: 'mail', id: 1 } }),
      ],
      nextOffset: null,
      coverage: {
        complete: false,
        warnings: [expect.stringContaining('300')],
        folders: [{ id: 2, name: 'INBOX', syncedAt: '2026-09-01T08:00:00Z' }],
      },
    });
  });
});

describe('list_mail_folders', () => {
  it('返回文件夹列表与缓存新鲜度，coverage 完整', async () => {
    vi.mocked(listMailFolders).mockReturnValue([
      {
        id: 2,
        path: 'INBOX',
        name: '收件箱',
        specialUse: '\\Inbox',
        total: 120,
        unread: 3,
        lastSyncedAt: '2026-09-01T08:00:00Z',
      },
    ]);
    await expect(listMailFoldersTool.execute({})).resolves.toEqual({
      items: [expect.objectContaining({ id: 2, name: '收件箱', unread: 3 })],
      freshness: { kind: 'cached', syncedAt: '2026-09-01T08:00:00Z' },
      coverage: { scope: 'cached_folders', complete: true },
    });
  });

  it('从未同步（空文件夹列表）时 coverage 标注缺口', async () => {
    vi.mocked(listMailFolders).mockReturnValue([]);
    await expect(listMailFoldersTool.execute({})).resolves.toMatchObject({
      items: [],
      coverage: { complete: false, warnings: [expect.stringContaining('尚未同步')] },
    });
  });
});
