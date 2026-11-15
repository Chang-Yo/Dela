// @vitest-environment jsdom
// 登录流程：课程读取失败退回登录卡并提示；登录成功后停在「正在获取视频列表」，读到课程后进入页面。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// 契约客户端在模块加载时取 bridge，须先于导入视图装好。
const api = vi.hoisted(() => {
  const handlers: Record<string, (input: unknown) => Promise<unknown>> = {};
  window.dela = {
    bridge: {
      invoke: (channel: string, input: unknown) =>
        handlers[channel.slice('classroom:'.length)]!(input),
      subscribe: () => () => {},
    },
  } as unknown as NonNullable<typeof window.dela>;
  return handlers;
});
const toast = vi.hoisted(() => vi.fn());
vi.mock('../../../../ui/toast', () => ({ showToast: toast }));
import { ClassroomView } from '../ClassroomView';

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  toast.mockClear();
  api.videos = async () => [];
  api.downloads = async () => [];
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

// 查询结果经定时器批量通知，链式读取（课程 → 录像 → 文稿）要多轮才落定。
async function settle() {
  for (let round = 0; round < 5; round++)
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

async function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <ClassroomView />
      </QueryClientProvider>,
    ),
  );
  await settle();
}

const loginButton = () =>
  [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('登录'));

it('falls back to the login card when courses fail, and reports a failed login', async () => {
  api.courses = async () => {
    throw new Error('校园会话失效');
  };
  api.connect = async () => ({ ok: false, error: '官方窗口已关闭' });
  await render();
  expect(host.textContent).toContain('登录交大视频');
  expect(toast).toHaveBeenCalledWith(
    expect.objectContaining({ title: '课程加载失败', description: '校园会话失效' }),
  );
  await act(async () => loginButton()!.click());
  await settle();
  expect(toast).toHaveBeenLastCalledWith(
    expect.objectContaining({ title: '登录未完成', description: '官方窗口已关闭' }),
  );
});

it('shows the course fetch after login, then enters the page', async () => {
  api.courses = async () => {
    throw new Error('校园会话失效');
  };
  api.connect = async () => ({ ok: true });
  await render();
  let resolveCourses!: (value: unknown) => void;
  api.courses = () => new Promise((resolve) => (resolveCourses = resolve));
  await act(async () => loginButton()!.click());
  await settle();
  expect(host.textContent).toContain('正在获取视频列表');
  await act(async () => resolveCourses([{ id: 1, code: 'CS', name: '计算理论' }]));
  await settle();
  expect(host.textContent).toContain('从左侧选择一场录像开始观看');
});
