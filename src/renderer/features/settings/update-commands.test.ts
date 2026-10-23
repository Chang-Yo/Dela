// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DelaApi } from '../../../shared/api';
import { useNoteDrafts } from '../../content/note/drafts';
import { useChatDrafts, registerChatAttachmentCheck } from '../../content/chat/drafts';
import { registerComposeSave } from '../mail/compose-close';
import { useWorkbenchLayout } from '../../workbench/layout-store';
import { useRuns } from '../../sessions/runs';
import { useToastStore } from '../../app/toasts';
import { useUpdateState, runUpdateAction, deferInstall } from './update';
import { chatImageToken } from '../../../shared/chat-input';

const originalSave = useNoteDrafts.getState().save;
let install: ReturnType<typeof vi.fn>;
let releases: (() => void)[];

beforeEach(() => {
  vi.resetAllMocks();
  releases = [];
  install = vi.fn(async () => ({}));
  window.dela = { update: { install } } as unknown as DelaApi;
  useNoteDrafts.setState({ drafts: {} });
  useChatDrafts.setState({ drafts: { session: { prompt: '未发送文字' } } });
  useWorkbenchLayout.setState({ ready: false });
  useUpdateState.setState({ preparingInstall: false });
  useRuns.setState({ bySession: {} });
});

afterEach(() => {
  for (const release of releases) release();
  useNoteDrafts.setState({ drafts: {}, save: originalSave });
  useChatDrafts.setState({ drafts: {} });
  useRuns.setState({ bySession: {} });
  useToastStore.setState({ toasts: [] });
  useUpdateState.setState({ preparingInstall: false });
  delete window.dela;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('保存所有文件草稿和邮件、写入聊天与布局后才安装', async () => {
  const order: string[] = [];
  useNoteDrafts.setState({
    drafts: {
      a: { content: {} as never, text: 'a', saved: '', saving: false, error: null },
      b: { content: {} as never, text: 'b', saved: '', saving: false, error: null },
    },
    save: async (key) => {
      order.push(key);
      const drafts = useNoteDrafts.getState().drafts;
      useNoteDrafts.setState({
        drafts: { ...drafts, [key]: { ...drafts[key]!, saved: drafts[key]!.text } },
      });
      return true;
    },
  });
  releases.push(
    registerComposeSave(async () => {
      order.push('mail1');
      return true;
    }),
  );
  releases.push(
    registerComposeSave(async () => {
      order.push('mail2');
      return true;
    }),
  );
  useWorkbenchLayout.setState({ ready: true });
  window.dela = {
    update: {
      install: async () => {
        expect(useUpdateState.getState().preparingInstall).toBe(true);
        expect(JSON.parse(localStorage.getItem('dela.session.drafts')!)).toEqual({
          session: { prompt: '未发送文字' },
        });
        order.push('install');
        return {};
      },
    },
    layout: {
      save: async () => {
        order.push('layout');
      },
    },
  } as unknown as DelaApi;
  expect(await runUpdateAction('install')).toBe(true);
  expect(order).toEqual(['a', 'b', 'mail1', 'mail2', 'layout', 'install']);
  expect(useUpdateState.getState().preparingInstall).toBe(false);
});

it.each(['mail', 'layout', 'storage', 'attachment', 'image', 'run'])(
  '%s 未能安全保存时不安装，并解除编辑锁',
  async (failure) => {
    if (failure === 'mail') releases.push(registerComposeSave(async () => false));
    if (failure === 'layout') {
      useWorkbenchLayout.setState({ ready: true });
      window.dela = {
        ...window.dela,
        layout: {
          save: async () => {
            throw new Error('disk');
          },
        },
      } as unknown as DelaApi;
    }
    if (failure === 'storage')
      vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
        throw new Error('quota');
      });
    if (failure === 'attachment') releases.push(registerChatAttachmentCheck(() => true));
    if (failure === 'image')
      useChatDrafts.setState({
        drafts: {
          session: {
            prompt: chatImageToken('11111111-1111-4111-8111-111111111111', 'image'),
          },
        },
      });
    if (failure === 'run')
      useRuns.setState({ bySession: { session: { runId: 'run', status: 'running' } } });
    expect(await runUpdateAction('install')).toBe(false);
    expect(install).not.toHaveBeenCalled();
    expect(useUpdateState.getState().preparingInstall).toBe(false);
    expect(useToastStore.getState().toasts[0]?.variant).toBe('error');
    if (failure === 'image') {
      expect(await runUpdateAction('install')).toBe(false);
      expect(install).not.toHaveBeenCalled();
    }
  },
);

it('保存未完成时重复点击只保存和安装一次', async () => {
  let complete!: (saved: boolean) => void;
  releases.push(
    registerComposeSave(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    ),
  );
  const first = runUpdateAction('install');
  await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
  expect(await runUpdateAction('install')).toBe(false);
  expect(install).not.toHaveBeenCalled();
  complete(true);
  expect(await first).toBe(true);
  expect(install).toHaveBeenCalledTimes(1);
});

it('更新动作 IPC 失败时提示且保留日志，不静默', async () => {
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  install = vi.fn(async () => {
    throw new Error('ipc down');
  });
  window.dela = { update: { install } } as unknown as DelaApi;
  expect(await runUpdateAction('install')).toBe(false);
  expect(errorSpy).toHaveBeenCalled();
  expect(useToastStore.getState().toasts[0]).toMatchObject({
    variant: 'error',
    title: '更新操作失败',
    description: 'ipc down',
  });
});

it('推迟提醒失败时提示，不静默', async () => {
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  window.dela = {
    update: {
      deferInstall: async () => {
        throw new Error('ipc down');
      },
    },
  } as unknown as DelaApi;
  await deferInstall();
  expect(errorSpy).toHaveBeenCalled();
  expect(useToastStore.getState().toasts[0]).toMatchObject({
    variant: 'error',
    title: '设置提醒失败',
    description: 'ipc down',
  });
});

it('安装器启动失败的返回快照不当作成功', async () => {
  window.dela = {
    update: {
      install: async () => ({ phase: 'error', failedAt: 'install', reason: 'failed' }),
    },
  } as unknown as DelaApi;
  expect(await runUpdateAction('install')).toBe(false);
});
