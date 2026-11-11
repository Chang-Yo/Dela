import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi } from 'vitest';
import { provideHostPorts, type HostPorts } from '../host';

// 默认把用户数据目录指到临时目录，避免相对路径把测试产物写进仓库。
const scratch = mkdtempSync(join(tmpdir(), 'dela-test-'));
const secrets = new Map<string, string>();

const testPorts: HostPorts = {
  paths: {
    userData: () => scratch,
    home: () => scratch,
    documents: () => scratch,
    temp: () => scratch,
  },
  secrets: {
    write: (namespace, plaintext) => void secrets.set(namespace, plaintext),
    read: (namespace) => secrets.get(namespace) ?? null,
    remove: (namespace) => void secrets.delete(namespace),
  },
  notifier: {
    notifyRunFinished: vi.fn(),
  },
  broadcaster: {
    subscribe: vi.fn(),
    send: vi.fn(),
  },
  imageCodec: {
    previewDataUrl: vi.fn(() => null),
  },
  desktop: {
    pickFiles: vi.fn(async () => []),
    pickSavePath: vi.fn(async () => null),
    reveal: vi.fn(),
    open: vi.fn(async () => {}),
    trash: vi.fn(async () => {}),
    sendToWindows: vi.fn(),
  },
  network: {
    fetch: vi.fn(() => Promise.reject(new Error('单元测试不访问网络'))),
  },
};

provideHostPorts(testPorts);

export function provideTestHostPorts({
  paths,
  ...overrides
}: Partial<Omit<HostPorts, 'paths'>> & { paths?: Partial<HostPorts['paths']> }): void {
  provideHostPorts({ ...testPorts, ...overrides, paths: { ...testPorts.paths, ...paths } });
}
