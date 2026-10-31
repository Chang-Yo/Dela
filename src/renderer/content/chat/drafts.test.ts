// @vitest-environment jsdom
// dela.session.drafts 持久化形状校验：损坏条目在 loadStored 丢弃，不进渲染期。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyDraft } from './drafts';

const STORAGE_KEY = 'dela.session.drafts';

function loadFresh(): Promise<typeof import('./drafts')> {
  vi.resetModules();
  return import('./drafts');
}

describe('useChatDrafts 启动加载', () => {
  afterEach(() => {
    localStorage.removeItem(STORAGE_KEY);
    vi.resetModules();
  });

  it('合法 prompt 保留，未知字段忽略，形状损坏的条目与旁问草稿丢弃', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        s1: { prompt: '你好', references: [{ key: 'k', title: '笔记' }] },
        s2: { prompt: 'x', references: 'oops' },
        s3: 'junk',
        s4: { prompt: 42, references: [] },
        s5: { prompt: 'y', references: [{ key: 1, title: 't' }] },
        s6: { prompt: 'z', references: [{ key: 'source:1', title: '资料' }] },
        s7: { prompt: 'w' },
        'sidechat:p1': { prompt: '旁问草稿' },
      }),
    );
    const { useChatDrafts } = await loadFresh();
    expect(useChatDrafts.getState().drafts).toEqual({
      s1: { prompt: '你好' },
      s2: { prompt: 'x' },
      s5: { prompt: 'y' },
      s6: { prompt: 'z' },
      s7: { prompt: 'w' },
    });
  });

  it('整体非对象或非法 JSON 时回退空表', async () => {
    localStorage.setItem(STORAGE_KEY, '[1,2]');
    const first = await loadFresh();
    expect(first.useChatDrafts.getState().drafts).toEqual({});

    localStorage.setItem(STORAGE_KEY, '{broken');
    const second = await loadFresh();
    expect(second.useChatDrafts.getState().drafts).toEqual({});
  });

  it('回复评论随草稿重启保留；评论形状损坏时只丢评论、保留正文', async () => {
    const comments = [{ quote: '原文片段', comment: '为什么？' }];
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        s1: { prompt: '', comments },
        s2: { prompt: '正文', comments: [{ quote: '片段' }] },
        s3: { prompt: '正文', comments: 'oops' },
      }),
    );
    const { useChatDrafts } = await loadFresh();
    expect(useChatDrafts.getState().drafts).toEqual({
      s1: { prompt: '', comments },
      s2: { prompt: '正文' },
      s3: { prompt: '正文' },
    });
  });

  it('update 以 emptyDraft 为基底合并并写回存储', async () => {
    const { useChatDrafts } = await loadFresh();
    useChatDrafts.getState().update('s1', { prompt: 'abc' });
    expect(useChatDrafts.getState().drafts.s1).toEqual({ ...emptyDraft, prompt: 'abc' });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).s1.prompt).toBe('abc');
  });
});
