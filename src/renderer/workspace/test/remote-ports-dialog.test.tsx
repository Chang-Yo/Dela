// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DelaApi, RemotePortsState } from '../../../shared/api';
import { RemotePortsDialog } from '../remote-ports-dialog';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete window.dela;
  vi.unstubAllGlobals();
});

const snapshot: RemotePortsState = {
  ports: [{ port: 5173, pid: 42, process: 'node' }, { port: 8080 }],
  tunnels: [{ remotePort: 3000, localPort: 45677 }],
};

async function renderDialog() {
  await act(async () => root.render(<RemotePortsDialog onClose={() => {}} open projectId="p-1" />));
}

it('lists ports with process names and active tunnels, and wires open/stop to the workspace API', async () => {
  const remotePorts = vi.fn(async () => snapshot);
  const openRemotePort = vi.fn(async () => ({ localPort: 45678 }));
  const closeRemotePort = vi.fn(async () => undefined);
  window.dela = {
    workspace: { remotePorts, openRemotePort, closeRemotePort },
  } as unknown as DelaApi;

  await renderDialog();
  await act(async () => {});
  expect(remotePorts).toHaveBeenCalledWith('p-1');
  expect(document.body.textContent).toContain('node');
  expect(document.body.textContent).toContain(':5173');
  // 已开的隧道显示本地落点，动作是「停止」而不是「打开」。
  expect(document.body.textContent).toContain('127.0.0.1:45677');

  vi.mocked(remotePorts).mockResolvedValue({
    ports: [{ port: 5173, pid: 42, process: 'node' }],
    tunnels: [{ remotePort: 5173, localPort: 45678 }],
  });
  const openButton = [...document.querySelectorAll('button')].find((button) =>
    button.textContent?.includes('打开'),
  )!;
  await act(async () => openButton.click());
  expect(openRemotePort).toHaveBeenCalledWith('p-1', 5173);
  expect(remotePorts).toHaveBeenCalledTimes(2);

  const stopButton = [...document.querySelectorAll('button')].find((button) =>
    button.textContent?.includes('停止'),
  )!;
  await act(async () => stopButton.click());
  expect(closeRemotePort).toHaveBeenCalledWith('p-1', 5173);
});

it('shows the helper-missing reason as an error line instead of a port list', async () => {
  window.dela = {
    workspace: {
      remotePorts: vi.fn(async () => {
        throw new Error('端口预览需要 helper 通道：当前不可用，已退回一次性 ssh');
      }),
    },
  } as unknown as DelaApi;

  await renderDialog();
  await act(async () => {});
  expect(document.body.textContent).toContain('helper 通道');
  expect(document.querySelector('[role="alert"]')).toBeTruthy();
});
