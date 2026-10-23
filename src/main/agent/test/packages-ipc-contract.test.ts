// packages:* 的通道名在 preload 与主进程各写一遍，改一处漏一处只会在真窗口里表现为一直转圈。
import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  handled: [] as string[],
  listenedMain: [] as string[],
  invoked: [] as string[],
  sent: [] as string[],
  listened: [] as string[],
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string) => state.handled.push(channel),
    on: (channel: string) => state.listenedMain.push(channel),
  },
  ipcRenderer: {
    invoke: (channel: string) => {
      state.invoked.push(channel);
      return Promise.resolve(null);
    },
    send: (channel: string) => state.sent.push(channel),
    on: (channel: string) => state.listened.push(channel),
    removeListener: () => {},
  },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: {},
  shell: {},
  app: { getPath: () => '' },
}));
vi.mock('../../ipc', () => ({ checkWorkspaceSender: () => {} }));
vi.mock('../session', () => ({ invalidateSessions: () => {} }));
vi.mock('../packages', () => ({
  restorePackages: async () => {},
  onPackageProgress: () => {},
  packageSettings: () => ({}),
}));

import { registerPackagesIpc } from '../packages-ipc';
import { packages } from '../../../preload/packages';

describe('Pi packages IPC 通道契约', () => {
  it('主进程注册的通道就是 preload 会调用的那些', async () => {
    registerPackagesIpc();
    const id = '00000000-0000-4000-8000-000000000000';
    await Promise.all([
      packages.settings(),
      packages.enable(),
      packages.disable(),
      packages.cancelRuntimeInstall(),
      packages.setRegistry('npmmirror'),
      packages.list(),
      packages.install('npm:x'),
      packages.pickLocal(),
      packages.setEnabled(id, true),
      packages.setResources(id, { extensions: true, skills: true, prompts: true }),
      packages.setPromptEnabled('review', false),
      packages.update(id),
      packages.remove(id),
      packages.reveal(id),
      packages.reply(id, null),
      packages.sessionState(id),
    ]);
    packages.reportEditorText(id, 'x');
    expect([...new Set(state.invoked)].sort()).toEqual([...state.handled].sort());
    expect(state.invoked).toHaveLength(16);
    expect(state.sent).toEqual(state.listenedMain);

    const stops = [
      packages.onSettingsChanged(() => {}),
      packages.onProgress(() => {}),
      packages.onUiRequest(() => {}),
      packages.onUiDismiss(() => {}),
      packages.onUiEvent(() => {}),
      packages.onSessionState(() => {}),
    ];
    // 主进程实际推送的通道（broadcast 调用处）与 preload 订阅的一一对应。
    expect(state.listened.sort()).toEqual(
      [
        'packages:progress',
        'packages:session-state',
        'packages:settings-changed',
        'packages:ui-dismiss',
        'packages:ui-event',
        'packages:ui-request',
      ].sort(),
    );
    stops.forEach((stop) => stop());
  });
});
