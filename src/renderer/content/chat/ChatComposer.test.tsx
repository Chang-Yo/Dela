// @vitest-environment jsdom
import { act, useState, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ContextUsageView } from '../../../shared/api';
import { ChatComposer, cacheHitRateText } from './ChatComposer';
import type { ComposerEditor } from './ComposerEditor';
import type { ChatReference } from './use-chat';

// 编辑器（CodeMirror）不参与本次验证：换成 textarea，但文档变化与光标位置仍按真实编辑器的
// 方式回调（真实实现里 docChanged / selectionSet 走的是同一个 updateListener）。
vi.mock('./ComposerEditor', () => ({
  ComposerEditor: ({ value, onChange, onCaret }: ComponentProps<typeof ComposerEditor>) => (
    <textarea
      aria-label="发送给助手"
      onChange={(event) => {
        const next = event.target.value;
        onChange(next);
        onCaret(next, next.length);
      }}
      value={value}
    />
  ),
}));

const reference: ChatReference = { key: 'E:/repo/Test/authAPI.js', title: 'Test/authAPI.js' };

let host: HTMLDivElement;
let root: Root;

function Harness({
  contextUsage,
  referenceOptions = [],
}: {
  contextUsage: ContextUsageView;
  referenceOptions?: ChatReference[];
}) {
  const [value, setValue] = useState('');
  return (
    <ChatComposer
      attachments={[]}
      busy={false}
      configured
      contextUsage={contextUsage}
      effort={null}
      effortLevels={[]}
      model="test-model"
      onAddAttachmentFile={async () => {}}
      onAddAttachmentView={() => {}}
      onAddReference={() => {}}
      onChange={setValue}
      onEffortSelect={() => {}}
      onModelSelect={() => {}}
      onRemoveAttachment={() => {}}
      onRemoveReference={() => {}}
      onSend={() => {}}
      onStop={() => {}}
      referenceOptions={referenceOptions}
      references={[]}
      value={value}
    />
  );
}

const usage = (patch: Partial<ContextUsageView> = {}): ContextUsageView => ({
  tokens: 12000,
  contextWindow: 200000,
  percent: 6,
  ...patch,
});

/** 触发 @ 候选：受控输入必须绕过 React 改写的 value setter，否则事件会被当成未变化。 */
function typeMention() {
  const editor = host.querySelector<HTMLTextAreaElement>('textarea')!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  act(() => {
    setValue.call(editor, '@');
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function openUsage() {
  const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="上下文占用"]')!;
  act(() => trigger.click());
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
  // jsdom 不做滚动布局：候选高亮的测量走真实代码，只把滚动本身置空。
  Element.prototype.scrollIntoView = () => {};
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it('@ 候选菜单确定向上展开：绝对定位挂在 composer 外框上，不再掉回文档流', async () => {
  await act(async () =>
    root.render(<Harness contextUsage={usage()} referenceOptions={[reference]} />),
  );
  typeMention();
  const list = host.querySelector('[role="listbox"]')!;
  const classes = list.className.split(/\s+/);
  expect(classes).toContain('absolute');
  expect(classes).toContain('bottom-full');
  expect(classes).not.toContain('relative');
  // 向上展开的锚点是 composer 外框自身的 relative，不能跟着被删掉。
  expect(list.parentElement?.className).toContain('relative');
});

it('@ 候选的文件名用主题蓝加粗，目录保持灰阶', async () => {
  await act(async () =>
    root.render(<Harness contextUsage={usage()} referenceOptions={[reference]} />),
  );
  typeMention();
  const spans = [...host.querySelectorAll('span')];
  const name = spans.find((span) => span.textContent === 'authAPI.js')!;
  const dir = spans.find((span) => span.textContent === 'Test/')!;
  expect(name.className).toContain('font-semibold');
  expect(name.getAttribute('style')).toContain('--cal-blue-text');
  expect(dir.className).toContain('text-ink-3');
  expect(dir.getAttribute('style')).toBeNull();
});

it('有缓存数据时显示本会话累计命中率，保留一位小数', async () => {
  await act(async () =>
    root.render(<Harness contextUsage={usage({ inputTokens: 500, cachedTokens: 4500 })} />),
  );
  openUsage();
  expect(document.body.textContent).toContain('缓存命中率');
  expect(document.body.textContent).toContain('90.0%');
});

it('提供商没有缓存数据时命中率显示 —，不写成 0%', async () => {
  await act(async () => root.render(<Harness contextUsage={usage()} />));
  openUsage();
  expect(document.body.textContent).toContain('缓存命中率—');
  expect(document.body.textContent).not.toContain('0.0%');
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
