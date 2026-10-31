// @vitest-environment jsdom
import { act, useState, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ContextUsageView } from '../../../shared/api';
import { useNavigationStore } from '../../navigation/view';
import { ChatComposer, cacheHitRateText } from './ChatComposer';
import type { ComposerContext } from './composer-context';
import type { ComposerEditor } from './ComposerEditor';
import type { ChatReference } from './use-chat';

// 编辑器（CodeMirror）不参与本次验证：换成 textarea，但文档变化、光标与 handleRef
// 的编辑操作仍按真实编辑器的回调方式模拟。
vi.mock('./ComposerEditor', () => ({
  ComposerEditor: ({
    value,
    onChange,
    onCaret,
    handleRef,
  }: ComponentProps<typeof ComposerEditor>) => {
    handleRef.current = {
      focus: () => {},
      insertAt: (pos, text) => {
        const next = value.slice(0, pos) + text + value.slice(pos);
        onChange(next);
        onCaret(next, pos + text.length);
      },
      replaceRange: (from, to, text) => {
        const next = value.slice(0, from) + text + value.slice(to);
        onChange(next);
        onCaret(next, from + text.length);
      },
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

const reference: ChatReference = { key: 'E:/repo/Test/authAPI.js', title: 'Test/authAPI.js' };

let host: HTMLDivElement;
let root: Root;

function Harness({
  context = null,
  contextUsage,
  referenceOptions = [],
  onAddAttachmentFile = async () => {},
  attachments = [],
  effort = null,
  effortLevels = [],
  onEffortSelect = () => {},
  sessionId = null,
}: {
  sessionId?: string | null;
  context?: ComposerContext | null;
  contextUsage: ContextUsageView;
  referenceOptions?: ChatReference[];
  onAddAttachmentFile?: ComponentProps<typeof ChatComposer>['onAddAttachmentFile'];
  attachments?: ComponentProps<typeof ChatComposer>['attachments'];
  effort?: ComponentProps<typeof ChatComposer>['effort'];
  effortLevels?: ComponentProps<typeof ChatComposer>['effortLevels'];
  onEffortSelect?: ComponentProps<typeof ChatComposer>['onEffortSelect'];
}) {
  const [value, setValue] = useState('');
  return (
    <ChatComposer
      attachments={attachments}
      comments={[]}
      onCommentsChange={() => {}}
      busy={false}
      configured
      context={context}
      contextUsage={contextUsage}
      effort={effort}
      effortLevels={effortLevels}
      model="test-model"
      onAddAttachmentFile={onAddAttachmentFile}
      onAddAttachmentView={() => {}}
      onChange={setValue}
      onEffortSelect={onEffortSelect}
      onModelSelect={() => {}}
      onRemoveAttachment={() => {}}
      onSend={() => {}}
      onStop={() => {}}
      referenceOptions={referenceOptions}
      sessionId={sessionId}
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
function typeMention(text = '@') {
  const editor = host.querySelector<HTMLTextAreaElement>('textarea')!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  act(() => {
    setValue.call(editor, text);
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete window.dela;
});

it('未配置思考强度时提供模型设置入口', async () => {
  const select = vi.fn();
  const openSettings = vi
    .spyOn(useNavigationStore.getState(), 'openSettings')
    .mockReturnValue(true);
  await act(async () => root.render(<Harness contextUsage={usage()} onEffortSelect={select} />));
  const trigger = host.querySelector<HTMLButtonElement>('[aria-label="思考强度"]')!;
  await act(async () => trigger.click());
  const settingsButton = Array.from(document.body.querySelectorAll('button')).find(
    (button) => button.textContent === '打开设置 › 模型供应商',
  )!;
  await act(async () => settingsButton.click());
  expect(openSettings).toHaveBeenCalledExactlyOnceWith('providers');
  expect(select).not.toHaveBeenCalled();
  expect(document.body.querySelector('[role="dialog"]')).toBeNull();
});

it('分屏中选择搜索服务后，另一个已挂载输入框应同步显示开启', async () => {
  const entry = { id: 'search-a', name: '学校搜索', provider: 'brave' as const };
  let selectedId: string | null = null;
  const listeners = new Set<() => void>();
  const selectWebSearchEntry = vi.fn(async (id: string | null) => {
    selectedId = id;
    for (const listener of listeners) listener();
  });
  window.dela = {
    chat: { listCommands: async () => [] },
    capability: {
      listWebSearchOptions: async () => ({ entries: [entry], selectedId }),
      selectWebSearchEntry,
      onWebSearchChanged: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  } as unknown as NonNullable<typeof window.dela>;
  await act(async () =>
    root.render(
      <>
        <div data-chat="a">
          <Harness contextUsage={usage()} />
        </div>
        <div data-chat="b">
          <Harness contextUsage={usage()} />
        </div>
      </>,
    ),
  );
  const first = host.querySelector('[data-chat="a"]')!;
  const second = host.querySelector('[data-chat="b"]')!;
  expect(second.querySelector('[aria-label="联网搜索：未开启"]')).not.toBeNull();
  await act(async () =>
    first.querySelector<HTMLButtonElement>('[aria-label="联网搜索：未开启"]')!.click(),
  );
  const option = Array.from(
    document.body.querySelectorAll<HTMLButtonElement>('button[role="radio"]'),
  ).find((button) => button.textContent === entry.name)!;
  expect(option).toBeTruthy();
  await act(async () => option.click());

  expect(selectWebSearchEntry).toHaveBeenCalledExactlyOnceWith(entry.id);
  expect(selectedId).toBe(entry.id);
  expect(first.querySelector('[aria-label="联网搜索：学校搜索"]')).not.toBeNull();
  expect(second.querySelector('[aria-label="联网搜索：学校搜索"]')).not.toBeNull();
  await act(async () => selectWebSearchEntry(null));
  expect(first.querySelector('[aria-label="联网搜索：未开启"]')).not.toBeNull();
  expect(second.querySelector('[aria-label="联网搜索：未开启"]')).not.toBeNull();
  await act(async () => root.unmount());
  expect(listeners.size).toBe(0);
  root = createRoot(host);
});

it('搜索配置变化后，迟到的首次读取不能覆盖新状态', async () => {
  const entry = { id: 'search-a', name: '学校搜索', provider: 'brave' as const };
  type Options = { entries: (typeof entry)[]; selectedId: string | null };
  let resolveInitial!: (value: Options) => void;
  const initial = new Promise<Options>((resolve) => {
    resolveInitial = resolve;
  });
  const listeners = new Set<() => void>();
  const listWebSearchOptions = vi
    .fn()
    .mockReturnValueOnce(initial)
    .mockResolvedValue({ entries: [entry], selectedId: entry.id });
  window.dela = {
    chat: { listCommands: async () => [] },
    capability: {
      listWebSearchOptions,
      onWebSearchChanged: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  } as unknown as NonNullable<typeof window.dela>;
  await act(async () => root.render(<Harness contextUsage={usage()} />));
  await act(async () => {
    for (const listener of listeners) listener();
  });
  expect(host.querySelector('[aria-label="联网搜索：学校搜索"]')).not.toBeNull();
  await act(async () => resolveInitial({ entries: [entry], selectedId: null }));
  expect(host.querySelector('[aria-label="联网搜索：学校搜索"]')).not.toBeNull();
});

it('已配置思考强度时仅列出允许的档位，选择后关闭菜单', async () => {
  const select = vi.fn();
  await act(async () =>
    root.render(
      <Harness
        contextUsage={usage()}
        effort="low"
        effortLevels={['low', 'high']}
        onEffortSelect={select}
      />,
    ),
  );
  const trigger = host.querySelector<HTMLButtonElement>('[aria-label="思考强度"]')!;
  expect(trigger.textContent).toBe('low');
  await act(async () => trigger.click());
  const options = Array.from(
    document.body.querySelectorAll<HTMLButtonElement>('ul[aria-label="思考强度"] button'),
  );
  expect(options.map((button) => button.textContent)).toEqual(['low', 'high']);
  await act(async () => options[1]!.click());
  expect(select).toHaveBeenCalledExactlyOnceWith('high');
  expect(document.body.querySelector('[role="dialog"]')).toBeNull();
});

it('拖入 PPTX 交给附件入口，不再被文本白名单拒绝', async () => {
  const add = vi.fn(async () => {});
  window.dela = { chat: { listCommands: async () => [] } } as unknown as NonNullable<
    typeof window.dela
  >;
  await act(async () => root.render(<Harness contextUsage={usage()} onAddAttachmentFile={add} />));
  const file = new File(['binary document'], 'PRP结项汇报_v3(1).pptx.pptx');
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { files: [file], types: ['Files'] } });
  await act(async () => host.querySelector('textarea')!.dispatchEvent(event));
  expect(add).toHaveBeenCalledWith(file);
});

it('只有文档附件时也允许发送', async () => {
  await act(async () =>
    root.render(
      <Harness
        contextUsage={usage()}
        attachments={[
          { id: 'doc', name: '课件.pdf', kind: 'attachment', size: 100, previewUrl: null },
        ]}
      />,
    ),
  );
  expect(host.querySelector<HTMLButtonElement>('[aria-label="发送"]')?.disabled).toBe(false);
});

it('选中 @ 候选后原位插入 @路径 token（尾随空格），菜单收起', async () => {
  await act(async () =>
    root.render(<Harness contextUsage={usage()} referenceOptions={[reference]} />),
  );
  typeMention();
  const option = host.querySelector('[role="option"]')!;
  await act(async () => option.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  const editor = host.querySelector<HTMLTextAreaElement>('textarea')!;
  expect(editor.value).toBe('@Test/authAPI.js ');
  expect(host.querySelector('[role="listbox"]')).toBeNull();
});

it('有缓存数据时显示本会话累计命中率，保留一位小数', async () => {
  await act(async () =>
    root.render(<Harness contextUsage={usage({ inputTokens: 500, cachedTokens: 4500 })} />),
  );
  openUsage();
  expect(document.body.textContent).toContain('90.0%');
});

it('提供商没有缓存数据时命中率显示 —，不写成 0%', async () => {
  await act(async () => root.render(<Harness contextUsage={usage()} />));
  openUsage();
  expect(document.body.textContent).toContain('—');
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

it('`/` 候选列出会话里的 Pi 扩展命令与模板，选中后原样插入 `/name `', async () => {
  const listSessionCommands = vi.fn(async () => [
    { name: 'deploy', description: 'Deploy the app', kind: 'extension' as const, source: 'pi-ops' },
    {
      name: 'review',
      description: 'Review a file',
      kind: 'prompt' as const,
      source: 'pi-ops',
      argumentHint: '<file>',
    },
  ]);
  const reportEditorText = vi.fn();
  window.dela = {
    chat: { listCommands: async () => [], listSessionCommands },
    packages: {
      reportEditorText,
      onSessionState: () => () => {},
      sessionState: async (sessionId: string) => ({
        sessionId,
        statuses: [{ key: 'ops', text: 'env: staging' }],
        widgets: [],
        workingMessage: null,
      }),
    },
  } as unknown as NonNullable<typeof window.dela>;
  await act(async () => root.render(<Harness contextUsage={usage()} sessionId="s-1" />));
  expect(host.textContent).toContain('env: staging');

  typeMention('/de');
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  expect(listSessionCommands).toHaveBeenCalledWith('s-1');
  const option = [...host.querySelectorAll('[role="option"]')].find((item) =>
    item.textContent?.includes('/deploy'),
  )!;
  expect(option.textContent).toContain('Deploy the app');
  await act(async () => option.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(host.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('/deploy ');
  expect(reportEditorText).toHaveBeenLastCalledWith('s-1', '/deploy ');
});

it('`/` 候选列出 Dela 的会话命令，与之同名的扩展命令被遮住不列', async () => {
  window.dela = {
    chat: {
      listCommands: async () => [],
      listSessionCommands: async () => [
        {
          name: 'compact',
          description: 'Extension compact',
          kind: 'extension' as const,
          source: 'pkg',
        },
      ],
    },
    packages: {
      reportEditorText: () => {},
      onSessionState: () => () => {},
      sessionState: async (sessionId: string) => ({
        sessionId,
        statuses: [],
        widgets: [],
        workingMessage: null,
      }),
    },
  } as unknown as NonNullable<typeof window.dela>;
  await act(async () => root.render(<Harness contextUsage={usage()} sessionId="s-1" />));
  typeMention('/');
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  const options = [...host.querySelectorAll('[role="option"]')].map(
    (item) => item.textContent ?? '',
  );
  for (const name of ['compact', 'reload', 'name', 'new', 'btw'])
    expect(options.filter((text) => text.startsWith(`//${name}`))).toHaveLength(1);
  expect(options.join('\n')).not.toContain('Extension compact');
  expect(options.find((text) => text.startsWith('//compact'))).toContain('压缩上下文');

  const compact = [...host.querySelectorAll('[role="option"]')].find((item) =>
    item.textContent?.startsWith('//compact'),
  )!;
  await act(async () => compact.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(host.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('/compact ');
});

it('压缩后的估计用量标「约」', async () => {
  await act(async () =>
    root.render(<Harness contextUsage={usage({ tokens: 30_000, percent: 15, estimated: true })} />),
  );
  openUsage();
  expect(document.body.textContent).toContain('约 30K / 200K');
});
