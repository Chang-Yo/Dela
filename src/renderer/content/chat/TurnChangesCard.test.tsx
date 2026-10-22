// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DelaApi, FileChangeDetail, TurnChanges } from '../../../shared/api';
import { TurnChangesCard } from './TurnChangesCard';
import { openTarget } from '../../workbench/open-target';

// 落位行为由 workbench 的测试覆盖，这里只验证卡片的动作映射。
vi.mock('../../workbench/open-target', () => ({ openTarget: vi.fn() }));

const sessionId = '0197d5a2-7b1e-7cc2-9f3a-5e6d1c2b3a4d';
let turnSeq = 0;

function turnFixture(overrides: Partial<TurnChanges> = {}): TurnChanges {
  turnSeq += 1;
  return {
    turnId: `0197d5a2-7b1e-7cc2-9f3a-5e6d1c2b3a4${turnSeq}`,
    cwd: 'E:\\workspace\\Test',
    startedAt: '2026-10-19T00:00:00Z',
    finishedAt: '2026-10-19T00:01:00Z',
    runStatus: 'completed',
    state: 'complete',
    warnings: [],
    files: [
      { path: 'src/app.ts', status: 'modified', beforeBytes: 10, afterBytes: 20, textDiff: true },
      { path: 'logo.png', status: 'added', beforeBytes: null, afterBytes: 5, textDiff: false },
    ],
    ...overrides,
  };
}

const dela = {
  chat: {
    readTurnChanges: vi.fn<(s: string, t: string) => Promise<TurnChanges | null>>(async () => null),
    readTurnFileChange: vi.fn<
      (s: string, t: string, p: string) => Promise<FileChangeDetail | null>
    >(async () => null),
    locateFile: vi.fn<(s: string, p: string) => Promise<string>>(
      async () => 'E:\\workspace\\Test\\src\\app.ts',
    ),
    openInVsCode: vi.fn<(s: string, p: string) => Promise<void>>(async () => {}),
    revealFile: vi.fn<(s: string, p: string) => Promise<void>>(async () => {}),
  },
};

let host: HTMLDivElement;
let root: Root;

async function renderCard(sessionId2: string, turnId: string, reviewEnabled = true) {
  await act(async () =>
    root.render(
      <TurnChangesCard sessionId={sessionId2} turnId={turnId} reviewEnabled={reviewEnabled} />,
    ),
  );
  // 冻结记录与行数统计的读取链路需要多轮微任务落定。
  await act(async () => {});
  await act(async () => {});
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  window.dela = dela as unknown as DelaApi;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  delete window.dela;
  vi.clearAllMocks();
});

it('没有冻结记录的轮次不渲染任何内容', async () => {
  await renderCard(sessionId, '00000000-0000-4000-8000-000000000001');
  expect(host.textContent).toBe('');
});

it('默认折叠，展开后列出文件并显示行数统计', async () => {
  const turn = turnFixture();
  turn.files[0]!.stat = { added: 2, deleted: 1 };
  dela.chat.readTurnChanges.mockImplementation(async () => turn);
  await renderCard(sessionId, turn.turnId);
  expect(host.querySelector('[aria-expanded="false"]')).not.toBeNull();
  expect(dela.chat.readTurnChanges).toHaveBeenCalledWith(sessionId, turn.turnId, true);
  expect(dela.chat.readTurnChanges).toHaveBeenCalledTimes(1);
  expect(dela.chat.readTurnFileChange).not.toHaveBeenCalled();
  expect(host.querySelectorAll('li')).toHaveLength(0);

  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click());
  expect(host.querySelectorAll('li')).toHaveLength(2);
  expect(host.textContent).toContain('app.ts');
  expect(host.textContent).toContain('src');
  expect(host.textContent).toContain('logo.png');
  // 二进制文件不计行数；文本文件显示 +2 -1，标题栏合计同源。
  expect(host.textContent).toContain('+2');
  expect(host.textContent).toContain('-1');
});

it('审阅与打开按解析出的标签键落位，已删除文件的打开被禁用', async () => {
  const turn = turnFixture({
    files: [
      { path: 'src/app.ts', status: 'modified', beforeBytes: 1, afterBytes: 2, textDiff: true },
      { path: 'gone.log', status: 'deleted', beforeBytes: 3, afterBytes: null, textDiff: true },
    ],
  });
  dela.chat.readTurnChanges.mockImplementation(async () => turn);
  await renderCard(sessionId, turn.turnId);
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click());

  const review = host.querySelectorAll<HTMLButtonElement>('li button[type="button"]')[0]!;
  await act(async () => review.click());
  expect(openTarget).toHaveBeenCalledWith(`review:${sessionId}:${turn.turnId}:src/app.ts`, {
    aside: true,
  });

  dela.chat.locateFile.mockResolvedValue('E:\\workspace\\Test\\src\\app.ts');
  const open = host.querySelector<HTMLButtonElement>('[title="在 Dela 中打开"]')!;
  await act(async () => open.click());
  expect(dela.chat.locateFile).toHaveBeenCalledWith(sessionId, 'src/app.ts');
  await act(async () => {});
  expect(openTarget).toHaveBeenCalledWith('preview:E:\\workspace\\Test\\src\\app.ts', {
    aside: true,
  });

  const deletedOpen = host.querySelector<HTMLButtonElement>('[title="文件已删除"]')!;
  expect(deletedOpen.disabled).toBe(true);
});

it('部分记录在展开后展示警告，不给「一切正常」的假象', async () => {
  const turn = turnFixture({
    state: 'partial',
    warnings: ['big.bin: 二进制或非 UTF-8 文件，不提供文本 diff', 'x: 不可读'],
  });
  dela.chat.readTurnChanges.mockImplementation(async () => turn);
  await renderCard(sessionId, turn.turnId);
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click());
  expect(host.textContent).toContain('big.bin: 二进制或非 UTF-8 文件，不提供文本 diff');
});

it('随聊只列文件并提供打开，不读取 diff 详情或显示审阅与行数', async () => {
  const turn = turnFixture();
  dela.chat.readTurnChanges.mockImplementation(async () => turn);
  await renderCard(sessionId, turn.turnId, false);
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click());

  expect(host.querySelectorAll('li')).toHaveLength(2);
  expect(host.textContent).not.toContain('+2');
  expect(dela.chat.readTurnFileChange).not.toHaveBeenCalled();
  expect(dela.chat.readTurnChanges).toHaveBeenCalledWith(sessionId, turn.turnId, false);
  expect(host.querySelectorAll('[aria-label="选择打开方式"]')).toHaveLength(2);

  await act(async () => host.querySelector<HTMLButtonElement>('[title="在 Dela 中打开"]')!.click());
  expect(dela.chat.locateFile).toHaveBeenCalledWith(sessionId, 'src/app.ts');
  expect(openTarget).toHaveBeenCalledWith('preview:E:\\workspace\\Test\\src\\app.ts', {
    aside: true,
  });
});
