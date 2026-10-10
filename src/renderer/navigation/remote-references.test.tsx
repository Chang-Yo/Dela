// @vitest-environment jsdom
// 远程项目的 @ 引用候选：候选来自主进程的远端文件索引，同一个项目在一次运行里只拉一次，
// 索引失败时退化为空候选而不抛错。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useRemoteReferences } from './remote-references';

let container: HTMLDivElement;
let root: Root;

function Probe({ projectId }: { projectId: string | null }) {
  const entries = useRemoteReferences(projectId);
  return <span>{entries.map((entry) => entry.title).join(',')}</span>;
}

const references = { remoteReferences: vi.fn() };

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  references.remoteReferences.mockReset();
  references.remoteReferences.mockResolvedValue([
    { key: '/home/u/proj/src/a.ts', title: 'src/a.ts' },
    { key: '/home/u/proj/README.md', title: 'README.md' },
  ]);
  window.dela = { workspace: references } as never;
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete window.dela;
  vi.unstubAllGlobals();
});

async function render(projectId: string | null) {
  await act(async () => root.render(<Probe projectId={projectId} />));
  await act(async () => {});
}

it('拉一次远端索引并把相对路径作为候选标题', async () => {
  await render('p-one');
  expect(container.textContent).toBe('src/a.ts,README.md');
  expect(references.remoteReferences).toHaveBeenCalledWith('p-one');
});

it('同一项目再次挂载不再请求', async () => {
  await render('p-cached');
  await act(async () => root.render(<Probe projectId={null} />));
  await render('p-cached');
  expect(references.remoteReferences).toHaveBeenCalledTimes(1);
});

it('没有远程项目时不请求', async () => {
  await render(null);
  expect(container.textContent).toBe('');
  expect(references.remoteReferences).not.toHaveBeenCalled();
});

it('索引失败时给出空候选且不抛错', async () => {
  references.remoteReferences.mockRejectedValue(new Error('连接失败'));
  await render('p-failed');
  expect(container.textContent).toBe('');
});
