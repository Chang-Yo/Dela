// 水源功能关闭时 dela 命令桥拒绝水源命令，且 help 不再列出它们；其他领域不受影响。
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

const flags = vi.hoisted(() => ({ shuiyuan: true }));
vi.mock('electron', () => ({
  ipcMain: {},
  app: { getPath: () => tmpdir(), isPackaged: false, getAppPath: () => tmpdir() },
}));
vi.mock('node-pty', () => ({ spawn: vi.fn() }));
vi.mock('../../settings/prefs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../settings/prefs')>()),
  experimentEnabled: (key: string) => key !== 'shuiyuan' || flags.shuiyuan,
  assertShuiyuanEnabled: () => {
    if (!flags.shuiyuan) throw new Error('水源功能已关闭');
  },
}));
import { startDomainBridge } from '../commands';

let bridge: Awaited<ReturnType<typeof startDomainBridge>>;
beforeAll(async () => {
  bridge = await startDomainBridge();
});
afterAll(() => bridge.close());
beforeEach(() => {
  flags.shuiyuan = true;
});

async function run(command: string, input: unknown = {}) {
  const response = await fetch(bridge.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${bridge.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, input }),
  });
  return (await response.json()) as { ok: boolean; result?: unknown; error?: string };
}

it('hides and rejects shuiyuan commands while the feature is off', async () => {
  const names = async () =>
    ((await run('help')).result as { name: string }[]).map((item) => item.name);
  expect(await names()).toContain('search_shuiyuan_topics');
  flags.shuiyuan = false;
  expect(await names()).not.toContain('search_shuiyuan_topics');
  expect(await names()).toContain('query_todos');
  const result = await run('search_shuiyuan_topics', { query: '数据结构' });
  expect(result).toMatchObject({ ok: false, error: '水源功能已关闭' });
});
