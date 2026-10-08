import { describe, expect, it } from 'vitest';
import type { WorkspaceChat } from '../../../shared/api';
import { chatImageToken } from '../../../shared/chat-input';
import { canSendInput, isEmptySession, shouldRestoreDraft } from './use-chat';

function chatWith(userTexts: string[]): WorkspaceChat {
  return {
    sessionId: 's1',
    projectId: null,
    cwd: null,
    configured: true,
    providerName: null,
    model: 'm',
    models: [],
    effortLevels: [],
    effort: null,
    messages: userTexts.map((content) => ({ role: 'user' as const, content })),
  };
}

describe('canSendInput（可发送判定，对照旧 use-chat.send 的 canSend）', () => {
  it('直发文本要求非空（快捷入口不携带图片）', () => {
    expect(canSendInput('  ', true)).toBe(false);
    expect(canSendInput('帮我查日程', true)).toBe(true);
  });

  it('常规发送允许纯图片（内联图片 token）', () => {
    expect(canSendInput('', false)).toBe(false);
    expect(canSendInput('   ', false)).toBe(false);
    expect(
      canSendInput(chatImageToken('0b2b1e28-1111-4222-8333-444455556666', 'a.png'), false),
    ).toBe(true);
    expect(canSendInput('正文', false)).toBe(true);
  });
});

describe('shouldRestoreDraft（发送失败草稿恢复判定）', () => {
  it('快照读不到（IPC 失败）时恢复', () => {
    expect(shouldRestoreDraft(null, '帮我整理')).toBe(true);
  });

  it('消息未上屏（未配置模型等持久化前失败）时恢复', () => {
    expect(shouldRestoreDraft(chatWith(['上一条']), '帮我整理')).toBe(true);
  });

  it('消息已上屏（中断文案已落库）时不恢复，只报错', () => {
    expect(shouldRestoreDraft(chatWith(['上一条', '帮我整理']), '帮我整理')).toBe(false);
  });

  it('带内联图片的输入按剥离 token 后的正文比对（与持久化 content 一致）', () => {
    const token = chatImageToken('0b2b1e28-1111-4222-8333-444455556666', 'a.png');
    const sent = `看图${token}`;
    // 主进程持久化的 content 是剥离 token 后的正文。
    expect(shouldRestoreDraft(chatWith(['看图']), sent)).toBe(false);
    expect(shouldRestoreDraft(chatWith(['其他']), sent)).toBe(true);
  });
});

describe('isEmptySession（新对话前的空会话清理）', () => {
  it('没有消息的会话视为空，切走前删除（沿用旧 newChat 语义）', () => {
    expect(isEmptySession(chatWith([]))).toBe(true);
    expect(isEmptySession(chatWith(['hi']))).toBe(false);
    expect(isEmptySession(null)).toBe(false);
  });
});
