// @vitest-environment jsdom
// 连接悬浮提示的内容：目的地（带端口）、远端根、以及「在不在连 / 为什么读不到」。
// 触发与定位由 components/ui/tooltip 负责，这里只验内容。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { WorkspaceEntry } from '../../shared/api';
import type { RemoteConnection } from '../../shared/remotes';
import type { RemoteActivity } from './remote-activity';
import { RemoteConnectionTip } from './remote-connection-tip';

const project: WorkspaceEntry = {
  id: 'p-remote',
  parentId: null,
  name: '远端项目',
  kind: 'project',
  sourceId: null,
  path: '/home/u/proj',
  remoteId: 'r-1',
  updatedAt: '2026-10-10T00:00:00.000Z',
};

const connection: RemoteConnection = {
  id: 'r-1',
  label: '实验室',
  host: 'user@10.0.0.5',
  port: 2222,
  keyPath: null,
  createdAt: '2026-10-01T00:00:00.000Z',
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const render = (activity?: RemoteActivity, withConnection = true) =>
  act(async () =>
    root.render(
      <RemoteConnectionTip
        activity={activity}
        connection={withConnection ? connection : undefined}
        project={project}
      />,
    ),
  );

it('shows the destination with its port and the remote root', async () => {
  await render({ phase: 'connecting' });
  expect(container.textContent).toContain('远端项目');
  expect(container.textContent).toContain('user@10.0.0.5:2222 · /home/u/proj');
  expect(container.textContent).toContain('正在连接…');
});

it('drops the destination line when the connection list is unavailable', async () => {
  // 连接列表读不到不是错误路径：目的地少一行，项目名与远端根照常给。
  await render({ phase: 'ready' }, false);
  expect(container.textContent).toContain('远程项目 · /home/u/proj');
  expect(container.textContent).not.toContain('正在连接');
});

it('reports the read failure as-is', async () => {
  await render({ phase: 'failed', reason: '读取失败 /home/u/proj：连接超时' });
  expect(container.textContent).toContain('读取失败 /home/u/proj：连接超时');
});
