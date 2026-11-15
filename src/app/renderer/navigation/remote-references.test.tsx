// @vitest-environment jsdom
// 远程项目的 @ 引用候选：候选来自主进程的远端文件索引，同一个项目在一次运行里只拉一次，
// 索引失败时退化为空候选而不抛错。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// 契约客户端在模块加载时取 bridge，须先于导入视图装好。
const remoteReferences = vi.hoisted(() => {
  const remoteReferences = vi.fn();
  window.dela = {
    bridge: {
      invoke: (_channel: string, input: string) => remoteReferences(input),
      subscribe: () => () => {},
    },
  } as never;
  return remoteReferences;
});
import { useRemoteReferences } from './remote-references';

let container: HTMLDivElement;
let root: Root;
let client: QueryClient;

const renderProbe = (projectId: string | null) =>
  root.render(
    <QueryClientProvider client={client}>
      <Probe projectId={projectId} />
    </QueryClientProvider>,
  );

function Probe({ projectId }: { projectId: string | null }) {
  const entries = useRemoteReferences(projectId);
  return <span>{entries.map((entry) => entry.title).join(',')}</span>;
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  remoteReferences.mockReset();
  remoteReferences.mockResolvedValue([
    { key: '/home/u/proj/src/a.ts', title: 'src/a.ts' },
    { key: '/home/u/proj/README.md', title: 'README.md' },
  ]);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(projectId: string | null) {
  await act(async () => renderProbe(projectId));
  for (let tick = 0; tick < 3; tick += 1)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

it('拉一次远端索引并把相对路径作为候选标题', async () => {
  await render('p-one');
  expect(container.textContent).toBe('src/a.ts,README.md');
  expect(remoteReferences).toHaveBeenCalledWith('p-one');
});

it('同一项目再次挂载不再请求', async () => {
  await render('p-cached');
  await act(async () => renderProbe(null));
  await render('p-cached');
  expect(remoteReferences).toHaveBeenCalledTimes(1);
});

it('没有远程项目时不请求', async () => {
  await render(null);
  expect(container.textContent).toBe('');
  expect(remoteReferences).not.toHaveBeenCalled();
});

it('索引失败时给出空候选且不抛错', async () => {
  remoteReferences.mockRejectedValue(new Error('连接失败'));
  await render('p-failed');
  expect(container.textContent).toBe('');
});
