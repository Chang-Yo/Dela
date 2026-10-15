// 通道契约：preload 只是一层 invoke 透传，名字必须和主进程逐字一致。
// 不一致时 invoke 会被主进程拒绝，而条款记录那侧是 catch 掉的——名字写错不会有人发现，
// 只会安静地少一条留证。这里把两侧钉在一起。
import { expect, beforeEach, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  handles: new Map<string, unknown>(),
  invoke: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { getPath: () => '', getVersion: () => '1.1.0', isPackaged: false },
  ipcMain: {
    handle: (channel: string, handler: unknown) => state.handles.set(channel, handler),
  },
  ipcRenderer: { invoke: state.invoke },
  dialog: {},
  BrowserWindow: { fromWebContents: () => null },
  session: {
    defaultSession: { clearCache: vi.fn(), clearCodeCaches: vi.fn(), clearStorageData: vi.fn() },
    fromPartition: () => ({}),
  },
}));

import { registerBackupIpc } from '../backup';
import { registerCacheIpc } from '../cache';
import { registerConsentIpc } from '../consent';
import { backup } from '../../preload/backup';
import { cache } from '../../preload/cache';
import { consent } from '../../preload/consent';

beforeEach(() => {
  state.handles.clear();
  state.invoke.mockClear();
});

it('条款记录与导出：主进程注册的通道名与界面发出的完全一致', async () => {
  registerConsentIpc();
  registerBackupIpc();
  expect([...state.handles.keys()]).toEqual(['consent:record', 'backup:export']);

  await consent.record('terms', '2026-10-15');
  expect(state.invoke).toHaveBeenLastCalledWith('consent:record', 'terms', '2026-10-15');

  await backup.exportData();
  expect(state.invoke).toHaveBeenLastCalledWith('backup:export');
});

it('导出通道只认应用主框架，别的来源一律拒绝', () => {
  registerBackupIpc();
  const handler = state.handles.get('backup:export') as (event: unknown) => unknown;
  const frame = { url: 'https://evil.example/' };

  // 外部文档发来的调用不能替用户把本机数据导出去。
  expect(() => handler({ senderFrame: frame, sender: { mainFrame: frame } })).toThrow(
    '不允许的调用来源',
  );
});

it('缓存占用与清理：主进程注册的通道名与界面发出的完全一致', async () => {
  registerCacheIpc();
  expect([...state.handles.keys()]).toEqual(['cache:get-size', 'cache:clear']);

  await cache.getSize();
  expect(state.invoke).toHaveBeenLastCalledWith('cache:get-size');

  await cache.clear();
  expect(state.invoke).toHaveBeenLastCalledWith('cache:clear');
});
