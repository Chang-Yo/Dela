import { useEffect, useRef, useState, type RefObject } from 'react';
import { Popover } from 'radix-ui';
import { ArrowUp, AtSign, Check, ChevronDown, Plus, Square } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import type { LlmProviderView } from '../../../shared/api';
import type { ChatReference } from './use-chat';

const slashCommands = [
  { name: '日程', prompt: '帮我查看本周的日程安排', hint: '课程与个人事件' },
  { name: '作业', prompt: '帮我查询即将截止的作业，按课程整理', hint: 'Canvas 截止时间' },
  { name: '邮件', prompt: '帮我查找最近的未读邮件', hint: '已缓存的邮件' },
  { name: '资料', prompt: '帮我在课程资料中查找相关文件', hint: '搜索并读取资料' },
  { name: '整理', prompt: '帮我把引用资料里的要点整理成一份笔记', hint: '生成并保存笔记' },
];

type MenuState = { kind: 'slash' | 'mention'; query: string; start: number } | null;

/** 检测光标前的 / 或 @ 触发词，返回菜单状态与触发词起始位置。 */
function detectMenu(text: string, caret: number): MenuState {
  const before = text.slice(0, caret);
  const slash = /(?:^|\s)\/([^\s]{0,30})$/.exec(before);
  if (slash?.[1]) {
    return {
      kind: 'slash',
      query: slash[1],
      start: slash.index + slash[0].length - slash[1].length - 1,
    };
  }
  const mention = /(?:^|\s)@([^\s@]{0,50})$/.exec(before);
  if (mention?.[1]) {
    return {
      kind: 'mention',
      query: mention[1],
      start: mention.index + mention[0].length - mention[1].length - 1,
    };
  }
  return null;
}

/** 把输入框中的触发词替换为指定文本，返回新文本与新光标位置。 */
function replaceToken(text: string, start: number, caret: number, replacement: string) {
  const next = text.slice(0, start) + replacement + text.slice(caret);
  return { text: next, caret: start + replacement.length };
}

export function ChatComposer({
  value,
  onChange,
  onSend,
  onStop,
  busy,
  configured,
  model,
  onModelSelect,
  effort,
  effortLevels,
  onEffortSelect,
  references,
  onRemoveReference,
  onAddReference,
  referenceOptions,
  hero = false,
  inputRef,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  busy: boolean;
  configured: boolean;
  model: string;
  onModelSelect: (provider: LlmProviderView, model: string) => void;
  /** 当前推理强度档位；提供商未开启时为 null，控件显示 default 且不可改。 */
  effort: string | null;
  effortLevels: string[];
  onEffortSelect: (level: string) => void;
  references: ChatReference[];
  onRemoveReference: (key: string) => void;
  onAddReference: (ref: ChatReference) => void;
  referenceOptions: ChatReference[];
  hero?: boolean;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  className?: string;
}) {
  const innerRef = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const [menu, setMenu] = useState<MenuState>(null);
  const [index, setIndex] = useState(0);
  const itemRef = useRef<HTMLLIElement>(null);
  // 两列模型面板：打开时读取设置配置保证新鲜；focusedId 是左列当前查看的提供商。
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [providers, setProviders] = useState<LlmProviderView[] | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const focused = providers?.find((provider) => provider.id === focusedId) ?? null;
  const [effortPickerOpen, setEffortPickerOpen] = useState(false);

  const openModelPicker = (open: boolean) => {
    setModelPickerOpen(open);
    if (!open || !window.dela) return;
    window.dela.llm
      .list()
      .then((views) => {
        setProviders(views);
        setFocusedId(views.find((view) => view.active)?.id ?? views[0]?.id ?? null);
      })
      .catch(() => setProviders([]));
  };

  const slashItems =
    menu?.kind === 'slash'
      ? slashCommands.filter((command) => command.name.includes(menu.query))
      : [];
  const mentionItems =
    menu?.kind === 'mention'
      ? referenceOptions
          .filter(
            (option) =>
              !references.some((ref) => ref.key === option.key) &&
              option.title.toLowerCase().includes(menu.query.toLowerCase()),
          )
          .slice(0, 8)
      : [];
  const items = menu?.kind === 'slash' ? slashItems : mentionItems;
  const menuOpen = menu !== null && items.length > 0;

  useEffect(() => setIndex(0), [menu?.kind, menu?.query]);
  useEffect(() => {
    itemRef.current?.scrollIntoView({ block: 'nearest' });
  }, [index, menuOpen]);

  const restoreCaret = (caret: number) => {
    requestAnimationFrame(() => {
      innerRef.current?.focus();
      innerRef.current?.setSelectionRange(caret, caret);
    });
  };

  const handleSelect = (position: number) => {
    if (!menu) return;
    const caret = innerRef.current?.selectionStart ?? value.length;
    if (menu.kind === 'slash') {
      const command = slashCommands.filter((entry) => entry.name.includes(menu.query))[position];
      if (!command) return;
      const { text, caret: nextCaret } = replaceToken(value, menu.start, caret, command.prompt);
      onChange(text);
      restoreCaret(nextCaret);
    } else {
      const option = referenceOptions.filter(
        (entry) =>
          !references.some((ref) => ref.key === entry.key) &&
          entry.title.toLowerCase().includes(menu.query.toLowerCase()),
      )[position];
      if (!option) return;
      onAddReference(option);
      const { text, caret: nextCaret } = replaceToken(value, menu.start, caret, '');
      onChange(text);
      restoreCaret(nextCaret);
    }
    setMenu(null);
  };

  const handleChange = (next: string) => {
    onChange(next);
    setMenu(detectMenu(next, innerRef.current?.selectionStart ?? next.length));
  };

  const insertMention = () => {
    const el = innerRef.current;
    const caret = el?.selectionStart ?? value.length;
    const { text, caret: nextCaret } = replaceToken(value, caret, caret, '@');
    handleChange(text);
    restoreCaret(nextCaret);
  };

  // IME 组合期间的 Enter 是候选词操作：isComposing 与 keyCode 229 双保险。
  const isComposing = (event: React.KeyboardEvent) =>
    composingRef.current || event.nativeEvent.isComposing || event.keyCode === 229;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (menuOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setIndex((current) => (current + 1) % items.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setIndex((current) => (current - 1 + items.length) % items.length);
        return;
      }
      if (event.key === 'Tab' || event.key === 'Enter') {
        if (isComposing(event)) return;
        event.preventDefault();
        handleSelect(index);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setMenu(null);
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      if (isComposing(event)) return;
      event.preventDefault();
      if (value.trim()) onSend();
    }
  };

  return (
    <div
      className={cn(
        'relative rounded-3xl border bg-card shadow-xs transition-colors focus-within:border-ring/60',
        className,
      )}
    >
      {references.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
          {references.map((ref) => (
            <span
              className="flex min-w-0 max-w-full items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs"
              key={ref.key}
            >
              <AtSign className="size-3 shrink-0 text-muted-foreground" />
              <span className="truncate">{ref.title}</span>
              <button
                aria-label={`移除引用 ${ref.title}`}
                className="grid size-4 shrink-0 place-items-center rounded text-muted-foreground hover:text-foreground"
                onClick={() => onRemoveReference(ref.key)}
                type="button"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <textarea
        aria-label="发送给助手"
        className={cn(
          'field-sizing-content w-full resize-none overflow-y-auto bg-transparent px-4 pt-3.5 pb-1.5 text-sm leading-relaxed outline-none placeholder:text-muted-foreground',
          hero ? 'min-h-16' : 'min-h-10',
        )}
        onChange={(event) => handleChange(event.target.value)}
        onCompositionEnd={() => {
          composingRef.current = false;
        }}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onKeyDown={handleKeyDown}
        placeholder={
          hero ? '查找资料、安排日程，或继续一个项目…' : '继续对话，@ 引用资料，/ 使用指令…'
        }
        ref={(element) => {
          innerRef.current = element;
          if (inputRef) inputRef.current = element;
        }}
        rows={1}
        value={value}
      />
      <div className="flex items-center gap-1 px-2.5 pb-2.5">
        <Button
          aria-label="引用资料"
          className="text-muted-foreground"
          onClick={insertMention}
          size="icon-sm"
          title="引用资料（@）"
          type="button"
          variant="ghost"
        >
          <Plus />
        </Button>
        <div className="flex-1" />
        {configured && (
          <Popover.Root onOpenChange={openModelPicker} open={modelPickerOpen}>
            <Popover.Trigger asChild>
              <Button
                className="gap-1 text-xs text-muted-foreground"
                size="sm"
                type="button"
                variant="ghost"
              >
                {model}
                <ChevronDown className="size-3" />
              </Button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                align="end"
                className="z-50 w-80 rounded-xl border bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
                side="bottom"
                sideOffset={6}
              >
                {providers === null ? (
                  <p className="px-2 py-3 text-xs text-muted-foreground">正在加载模型列表…</p>
                ) : providers.length === 0 ? (
                  <p className="px-2 py-3 text-xs text-muted-foreground">
                    还没有配置模型服务，可在设置 › 模型服务 中添加。
                  </p>
                ) : (
                  <div className="flex gap-0.5">
                    <ul aria-label="模型服务" className="w-28 shrink-0 overflow-y-auto">
                      {providers.map((provider) => (
                        <li key={provider.id}>
                          <button
                            className={cn(
                              'flex w-full items-center gap-1 rounded-lg px-2 py-1.5 text-left text-xs transition-colors',
                              provider.id === focusedId
                                ? 'bg-accent text-accent-foreground'
                                : 'hover:bg-accent/50',
                            )}
                            onClick={() => setFocusedId(provider.id)}
                            type="button"
                          >
                            <span className="truncate">{provider.name}</span>
                            {provider.active && (
                              <span
                                aria-label="使用中"
                                className="ms-auto size-1.5 shrink-0 rounded-full bg-emerald-500"
                                title="使用中"
                              />
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                    <ul
                      aria-label="模型"
                      className="max-h-64 min-w-0 flex-1 overflow-y-auto border-l pl-1.5"
                    >
                      {focused?.models.map((item) => (
                        <li key={item}>
                          <button
                            className={cn(
                              'flex w-full items-center gap-1 rounded-lg px-2 py-1.5 text-left text-xs transition-colors',
                              focused.active && model === item
                                ? 'bg-accent font-medium text-accent-foreground'
                                : 'hover:bg-accent/50',
                            )}
                            onClick={() => {
                              setModelPickerOpen(false);
                              onModelSelect(focused, item);
                            }}
                            type="button"
                          >
                            <span className="truncate">{item}</span>
                            {focused.active && model === item && (
                              <Check className="ms-auto size-3.5 shrink-0" />
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        )}
        {configured && (
          <Popover.Root onOpenChange={setEffortPickerOpen} open={effortPickerOpen}>
            <Popover.Trigger asChild>
              <Button
                aria-label="思考强度"
                className="gap-1 text-xs text-muted-foreground"
                disabled={effortLevels.length === 0}
                size="sm"
                title={effortLevels.length ? '思考强度' : '在设置 › 模型服务 中开启推理强度后可选'}
                type="button"
                variant="ghost"
              >
                {effort ?? 'default'}
                <ChevronDown className="size-3" />
              </Button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                align="end"
                className="z-50 w-32 rounded-xl border bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
                side="bottom"
                sideOffset={6}
              >
                <ul aria-label="思考强度">
                  {effortLevels.map((level) => (
                    <li key={level}>
                      <button
                        className={cn(
                          'flex w-full items-center gap-1 rounded-lg px-2 py-1.5 text-left text-xs transition-colors',
                          level === effort
                            ? 'bg-accent font-medium text-accent-foreground'
                            : 'hover:bg-accent/50',
                        )}
                        onClick={() => {
                          setEffortPickerOpen(false);
                          onEffortSelect(level);
                        }}
                        type="button"
                      >
                        <span className="truncate">{level}</span>
                        {level === effort && <Check className="ms-auto size-3.5 shrink-0" />}
                      </button>
                    </li>
                  ))}
                </ul>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        )}
        {busy ? (
          <Button
            aria-label="停止执行"
            className="rounded-full"
            onClick={onStop}
            size="icon-sm"
            type="button"
          >
            <Square className="size-3.5" />
          </Button>
        ) : (
          <Button
            aria-label="发送"
            className="rounded-full"
            disabled={!configured || !value.trim()}
            onClick={onSend}
            size="icon-sm"
            type="button"
          >
            <ArrowUp />
          </Button>
        )}
      </div>
      {menuOpen && (
        <ul className="absolute bottom-full left-0 z-20 mb-2 max-h-64 w-full min-w-56 overflow-auto rounded-xl border bg-popover p-1 shadow-lg">
          {items.map((item, position) => (
            <li
              key={'name' in item ? item.name : item.key}
              ref={position === index ? itemRef : undefined}
            >
              <button
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm',
                  position === index ? 'bg-accent text-accent-foreground' : '',
                )}
                // 阻止点击选项时 textarea 失焦。
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => handleSelect(position)}
                type="button"
              >
                <AtSign className="size-3.5 shrink-0 text-muted-foreground" />
                {'name' in item ? (
                  <>
                    <span className="shrink-0 font-medium">/{item.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{item.hint}</span>
                  </>
                ) : (
                  <span className="truncate">{item.title}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
