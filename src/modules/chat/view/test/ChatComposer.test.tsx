// @vitest-environment jsdom
import { act, useState, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { notifyManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ContextUsageView } from '../../../../core/protocol/agent';

// 契约客户端在模块加载时取 bridge，须先于导入装好。
vi.hoisted(() => {
  window.dela = {
    bridge: { invoke: async () => undefined, subscribe: () => () => {} },
  } as unknown as NonNullable<typeof window.dela>;
});
import { ChatComposer, cacheHitRateText } from '../ChatComposer';
import type { ComposerEditor } from '../ComposerEditor';

// 编辑器（CodeMirror）不参与本次验证：换成只回传文本变化的 textarea。
vi.mock('../ComposerEditor', () => ({
  ComposerEditor: ({
    value,
    onChange,
    onCaret,
    handleRef,
  }: ComponentProps<typeof ComposerEditor>) => {
    handleRef.current = {
      focus: () => {},
      insertAt: () => {},
      replaceRange: () => {},
      selectionStart: () => value.length,
    };
    return (
      <textarea
        aria-label="发送给助手"
        onChange={(event) => {
          const next = event.target.value;
          onChange(next);
          onCaret(next, next.length);
        }}
        value={value}
      />
    );
  },
}));

let host: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;

function Harness({
  contextUsage,
  busy = false,
  sidechat = false,
}: {
  busy?: boolean;
  sidechat?: boolean;
  contextUsage: ContextUsageView;
}) {
  const [value, setValue] = useState('');
  return (
    <QueryClientProvider client={queryClient}>
      <ChatComposer
        attachments={[]}
        comments={[]}
        onCommentsChange={() => {}}
        busy={busy}
        sidechat={sidechat}
        configured
        context={null}
        contextUsage={contextUsage}
        effort={null}
        effortLevels={[]}
        model="test-model"
        onAddAttachmentFile={async () => {}}
        onAddAttachmentView={() => {}}
        onChange={setValue}
        onEffortSelect={() => {}}
        onModelSelect={() => {}}
        onRemoveAttachment={() => {}}
        onSend={() => {}}
        onStop={() => {}}
        referenceOptions={[]}
        value={value}
      />
    </QueryClientProvider>
  );
}

const usage = (patch: Partial<ContextUsageView> = {}): ContextUsageView => ({
  tokens: 12000,
  contextWindow: 200000,
  percent: 6,
  ...patch,
});

/** 受控输入必须绕过 React 改写的 value setter，否则事件会被当成未变化。 */
function typeText(text: string) {
  const editor = host.querySelector<HTMLTextAreaElement>('textarea')!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  act(() => {
    setValue.call(editor, text);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

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
  // 查询通知默认走 setTimeout，act 等不到；改为微任务让一次 await 就能收敛。
  notifyManager.setScheduler(queueMicrotask);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete window.dela;
});

it('命中率文本只在拿到两个累计字段且分母大于 0 时才算数，其余留空', () => {
  // main 未给出字段 = 提供商不上报缓存：不能显示成 0%。
  expect(cacheHitRateText(usage())).toBe('—');
  expect(cacheHitRateText(usage({ inputTokens: 100 }))).toBe('—');
  expect(cacheHitRateText(usage({ cachedTokens: 100 }))).toBe('—');
  expect(cacheHitRateText(usage({ inputTokens: 0, cachedTokens: 0 }))).toBe('—');
  // 上报过缓存写、但当次没命中：这是真实的 0%，要和「没有数据」区分开。
  expect(cacheHitRateText(usage({ inputTokens: 1000, cachedTokens: 0 }))).toBe('0.0%');
  expect(cacheHitRateText(usage({ inputTokens: 1, cachedTokens: 2 }))).toBe('66.7%');
});

it('运行中输入框有内容时按钮是发送（插队），清空后变回停止；旁问运行中始终是停止', async () => {
  const button = () =>
    host.querySelector<HTMLButtonElement>(
      'button[aria-label="发送"], button[aria-label="停止执行"]',
    )!;
  await act(async () => root.render(<Harness busy contextUsage={usage()} />));
  expect(button().getAttribute('aria-label')).toBe('停止执行');
  typeText('顺便看一下 B');
  expect(button().getAttribute('aria-label')).toBe('发送');
  typeText('');
  expect(button().getAttribute('aria-label')).toBe('停止执行');

  await act(async () => root.render(<Harness busy contextUsage={usage()} sidechat />));
  typeText('顺便问一句');
  expect(button().getAttribute('aria-label')).toBe('停止执行');
});
