// @vitest-environment jsdom
// 更新入口的位置约束：它属于「通用」，且排在「试验功能」上方；「关于」页只报版本，不做更新。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DelaApi } from '../../../../shared/api';
import type { UpdateSnapshot } from '../../../../shared/update';
import { useExperimental } from '../experimental';
import { useUpdateState } from '../update';
import { AboutSection } from './AboutSection';
import { GeneralSection } from './GeneralSection';

const idle: UpdateSnapshot = {
  phase: 'idle',
  currentVersion: '1.0.0',
  version: null,
  progress: 0,
  transferred: 0,
  total: null,
  checkedAt: null,
  reason: null,
  detail: null,
  failedAt: null,
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  useExperimental.setState({ state: null });
  // 更新行只在拿到快照后才占位（真实应用里由 App 挂载时接上广播）。
  useUpdateState.setState({ snapshot: idle });
  window.dela = {
    version: '1.0.0',
    settings: {
      getOpenAtLogin: async () => true,
      getExperiments: async () => ({ master: false, shuiyuan: false, videoDownload: false }),
      getCampusNotifications: async () => true,
      getTaskNotifications: async () => ({ failed: true, completed: false }),
    },
    notifications: {
      getState: async () => ({ snoozedUntil: null }),
      onUpdate: () => () => {},
    },
    update: {
      getState: async () => idle,
      check: async () => idle,
      download: async () => idle,
      install: async () => idle,
      openDownloadPage: async () => {},
      onState: () => () => {},
    },
  } as unknown as DelaApi;
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  useUpdateState.setState({ snapshot: null });
  delete window.dela;
  vi.unstubAllGlobals();
});

/** 设置行在页面里的出现次序；未出现返回 -1。 */
function rowIndex(settingId: string): number {
  const ids = [...container.querySelectorAll('[data-setting-id]')].map((item) =>
    item.getAttribute('data-setting-id'),
  );
  return ids.indexOf(settingId);
}

it('更新入口在「通用」里，且排在「试验功能」上方', async () => {
  await act(async () => root.render(<GeneralSection />));
  const update = rowIndex('check-update');
  expect(update).toBeGreaterThanOrEqual(0);
  expect(rowIndex('experimental-features')).toBeGreaterThan(update);
});

it('「关于」页不再有更新入口', async () => {
  await act(async () => root.render(<AboutSection />));
  expect(rowIndex('check-update')).toBe(-1);
});
