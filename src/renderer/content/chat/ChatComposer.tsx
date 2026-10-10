import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Popover } from 'radix-ui';
import {
  ArrowUp,
  AtSign,
  Bot,
  Check,
  ChevronDown,
  CircleAlert,
  FileText,
  Paperclip,
  Settings,
  Sparkles,
  Square,
  X,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from '@/components/ui/beautifului/atoms/Button';
import { IconButton } from '@/components/ui/beautifului/atoms/IconButton';
import { ProgressRing } from '@/components/ui/beautifului/atoms/ProgressRing';
import { useNavigationStore } from '../../app/navigation';
import type {
  ChatCommandView,
  ChatMediaView,
  ContextUsageView,
  LlmProviderView,
} from '../../../shared/api';
import {
  chatFileKind,
  chatImageToken,
  hasChatImages,
  INLINE_IMAGE_MAX,
  matchChatImageTokens,
} from '../../../shared/chat-input';
import type { ChatReference } from './use-chat';
import { ComposerEditor, type ComposerEditorHandle } from './ComposerEditor';
import { setChatMediaPreview } from './media';

const builtinCommands = [
  { name: '日程', prompt: '帮我查看本周的日程安排', hint: '课程与个人事件' },
  { name: '作业', prompt: '帮我查询即将截止的作业，按课程整理', hint: 'Canvas 截止时间' },
  { name: '邮件', prompt: '帮我查找最近的未读邮件', hint: '已缓存的邮件' },
  { name: '资料', prompt: '帮我在课程资料中查找相关文件', hint: '搜索并读取资料' },
  { name: '整理', prompt: '帮我把引用资料里的要点整理成一份笔记', hint: '生成并保存笔记' },
];

type MenuState = { kind: 'slash' | 'mention'; query: string; start: number } | null;

/** 检测光标前的 / 或 @ 触发词；单独输入 / 或 @ 也打开候选（空查询）。 */
function detectMenu(text: string, caret: number): MenuState {
  const before = text.slice(0, caret);
  const slash = /(?:^|\s)\/([^\s]{0,30})$/.exec(before);
  if (slash) return { kind: 'slash', query: slash[1]!, start: caret - slash[1]!.length - 1 };
  const mention = /(?:^|\s)@([^\s@]{0,50})$/.exec(before);
  if (mention)
    return { kind: 'mention', query: mention[1]!, start: caret - mention[1]!.length - 1 };
  return null;
}

function formatSize(size: number): string {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

function formatTokens(tokens: number): string {
  return tokens < 1000 ? '0K' : `${(tokens / 1000).toFixed(1).replace(/\.0$/, '')}K`;
}

function usageTone(percent: number | null): 'ink' | 'orange' | 'red' {
  if (percent === null) return 'ink';
  if (percent >= 90) return 'red';
  if (percent >= 70) return 'orange';
  return 'ink';
}

/** 本会话累计缓存命中率 = cacheRead / (输入 + cacheRead)。main 没给出缓存字段（提供商不上报
 *  缓存）或分母为 0 时显示 —：写成 0% 会把「没有数据」说成「一次都没命中」。 */
export function cacheHitRateText(usage: ContextUsageView): string {
  const { inputTokens, cachedTokens } = usage;
  if (inputTokens === undefined || cachedTokens === undefined) return '—';
  const total = inputTokens + cachedTokens;
  return total > 0 ? `${((cachedTokens / total) * 100).toFixed(1)}%` : '—';
}

// beautiful-ui PromptBar 的控件样式：选择器触发钮与弹层容器（图标钮用 IconButton atom）。
const triggerButton =
  'flex h-7 min-w-0 shrink items-center gap-1 rounded-[8px] px-1.5 text-[12px] font-medium text-ink-2 transition-colors duration-150 hover:bg-hover hover:text-ink';
const menuPanel = 'rounded-[10px] bg-surface p-1 shadow-raised';

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
  attachments,
  onAddAttachmentFile,
  onAddAttachmentView,
  onRemoveAttachment,
  contextUsage = null,
  notice = null,
  onDismissNotice,
  hero = false,
}: {
  /** 发送前错误（会话层），显示在输入框上方；null = 无。 */
  notice?: string | null;
  onDismissNotice?: () => void;
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
  attachments: ChatMediaView[];
  onAddAttachmentFile: (file: File) => Promise<void>;
  onAddAttachmentView: (view: ChatMediaView) => void;
  onRemoveAttachment: (id: string) => void;
  contextUsage?: ContextUsageView | null;
  hero?: boolean;
}) {
  const editorRef = useRef<ComposerEditorHandle | null>(null);
  const [menu, setMenu] = useState<MenuState>(null);
  const [index, setIndex] = useState(0);
  const itemRef = useRef<HTMLLIElement>(null);
  // 候选菜单 id 逐实例唯一（同页可同时挂多个会话的 composer），选项 id 按序号派生，
  // 供编辑器的 aria-controls / aria-activedescendant 引用。
  const menuListId = `${useId()}-list`;
  const menuOptionId = (position: number) => `${menuListId}-option-${position}`;
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [customCommands, setCustomCommands] = useState<ChatCommandView[]>([]);
  // 两列模型面板：打开时读取设置配置保证新鲜；focusedId 是左列当前查看的提供商。
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [providers, setProviders] = useState<LlmProviderView[] | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const focused = providers?.find((provider) => provider.id === focusedId) ?? null;
  const [effortPickerOpen, setEffortPickerOpen] = useState(false);
  // PromptBar 式单一滑动高亮：跟随键盘/鼠标共用的 index，测量当前行位置。
  const [rowBox, setRowBox] = useState<{ top: number; height: number } | null>(null);

  useEffect(() => {
    let active = true;
    void window.dela?.chat
      .listCommands()
      .then((commands) => {
        if (active) setCustomCommands(commands);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const slashItems =
    menu?.kind === 'slash'
      ? [
          ...builtinCommands,
          ...customCommands.map((command) => ({ ...command, hint: '自定义' })),
        ].filter((command) => command.name.includes(menu.query))
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
  const items: (typeof slashItems)[number][] | ChatReference[] =
    menu?.kind === 'slash' ? slashItems : mentionItems;
  const menuOpen = menu !== null && items.length > 0;

  useEffect(() => {
    itemRef.current?.scrollIntoView({ block: 'nearest' });
  }, [index, menuOpen]);

  useLayoutEffect(() => {
    setRowBox(
      itemRef.current
        ? { top: itemRef.current.offsetTop, height: itemRef.current.offsetHeight }
        : null,
    );
  }, [index, menuOpen, items.length]);

  const handleCaret = (text: string, caret: number) => {
    if (fileError) setFileError(null);
    const next = detectMenu(text, caret);
    // 候选词变化时高亮从头开始；同词内移动光标保留当前高亮。
    if (next?.kind !== menu?.kind || next?.query !== menu?.query) setIndex(0);
    setMenu(next);
  };

  const handleSelect = (position: number) => {
    if (!menu) return;
    const caret = editorRef.current?.selectionStart() ?? value.length;
    if (menu.kind === 'slash') {
      const command = slashItems[position];
      if (!command) return;
      editorRef.current?.replaceRange(menu.start, caret, command.prompt);
    } else {
      const option = mentionItems[position];
      if (!option) return;
      onAddReference(option);
      editorRef.current?.replaceRange(menu.start, caret, '');
    }
    setMenu(null);
    setIndex(0);
  };

  const insertMention = () => {
    const caret = editorRef.current?.selectionStart() ?? value.length;
    editorRef.current?.insertAt(caret, '@');
  };

  /** 插入一张已暂存的内联图片 token，返回新的插入位置（批量拖入时逐张顺延）。 */
  const insertImageView = (view: ChatMediaView, pos: number) => {
    setChatMediaPreview(view.id, view.previewUrl);
    const token = `${chatImageToken(view.id, view.name)} `;
    editorRef.current?.insertAt(pos, token);
    return pos + token.length;
  };

  const addFiles = async (files: File[], pos: number) => {
    if (!window.dela) return;
    let insertPos = pos;
    // 闭包里的 value 不含本轮已插入的 token，循环内自计数防止批量拖入绕过上限。
    let imageCount = matchChatImageTokens(value).length;
    for (const file of files) {
      const kind = chatFileKind(file.name);
      if (!kind) {
        setFileError(`“${file.name}”暂不支持：仅接受图片与常见文本文件`);
        continue;
      }
      try {
        if (kind === 'image') {
          if (imageCount >= INLINE_IMAGE_MAX)
            throw new Error(`最多插入 ${INLINE_IMAGE_MAX} 张图片`);
          const bytes = new Uint8Array(await file.arrayBuffer());
          const view = await window.dela.chat.stageMedia({ name: file.name, bytes });
          insertPos = insertImageView(view, insertPos);
          imageCount += 1;
        } else {
          await onAddAttachmentFile(file);
        }
        setFileError(null);
      } catch (e) {
        setFileError(e instanceof Error ? e.message : String(e));
      }
    }
  };

  const pickFiles = () => {
    if (!window.dela) return;
    void window.dela.chat
      .pickMedia()
      .then((views) => {
        let insertPos = editorRef.current?.selectionStart() ?? value.length;
        let imageCount = matchChatImageTokens(value).length;
        for (const view of views) {
          if (view.kind === 'image') {
            if (imageCount >= INLINE_IMAGE_MAX) {
              setFileError(`最多插入 ${INLINE_IMAGE_MAX} 张图片`);
              continue;
            }
            insertPos = insertImageView(view, insertPos);
            imageCount += 1;
          } else {
            onAddAttachmentView(view);
          }
        }
      })
      .catch((e) => setFileError(e instanceof Error ? e.message : String(e)));
  };

  // 候选菜单的键盘协议：菜单打开时消费按键并移动高亮，否则交回编辑器默认行为。
  const menuApi = {
    onKey: (key: 'down' | 'up' | 'select' | 'close'): boolean => {
      if (!menuOpen) return false;
      if (key === 'close') {
        setMenu(null);
        setIndex(0);
        return true;
      }
      if (key === 'down') {
        setIndex((current) => (current + 1) % items.length);
        return true;
      }
      if (key === 'up') {
        setIndex((current) => (current - 1 + items.length) % items.length);
        return true;
      }
      handleSelect(index);
      return true;
    },
  };

  const canSend = value.trim().length > 0 || hasChatImages(value);

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

  return (
    <div className="relative">
      {/* 提示条浮在输入框上方，不推移输入框与消息列表。 */}
      {(fileError ?? notice) && (
        <ComposerNotice
          message={(fileError ?? notice)!}
          onDismiss={fileError ? () => setFileError(null) : onDismissNotice}
        />
      )}
      <div
        className={cn(
          '@container relative rounded-[14px] border border-line bg-surface shadow-card transition-colors duration-150 focus-within:border-line-strong',
          dragging && 'border-transparent',
        )}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('Files')) {
            event.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(event) => {
          setDragging(false);
          const files = [...(event.dataTransfer?.files ?? [])];
          if (!files.length) return;
          event.preventDefault();
          void addFiles(files, editorRef.current?.selectionStart() ?? value.length);
        }}
      >
        {dragging && (
          <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-[14px] border-2 border-dashed border-line-strong bg-page/80 text-[13px] text-ink-3">
            松开以添加图片或附件
          </div>
        )}
        {(attachments.length > 0 || references.length > 0) && (
          <div className="flex flex-wrap gap-1.5 px-3 pt-3">
            {references.map((ref) => (
              <ComposerChip
                icon={<AtSign />}
                key={ref.key}
                label={ref.title}
                onRemove={() => onRemoveReference(ref.key)}
                removeLabel={`移除引用 ${ref.title}`}
              />
            ))}
            {attachments.map((item) => (
              <ComposerChip
                detail={formatSize(item.size)}
                icon={<FileText />}
                key={item.id}
                label={item.name}
                onRemove={() => onRemoveAttachment(item.id)}
                removeLabel={`移除附件 ${item.name}`}
              />
            ))}
          </div>
        )}
        <ComposerEditor
          className="@max-[220px]:[&_[aria-hidden='true']]:truncate"
          handleRef={editorRef}
          hero={hero}
          menu={menuApi}
          menuAria={{
            activeId: menuOpen && index < items.length ? menuOptionId(index) : null,
            listId: menuListId,
            open: menuOpen,
          }}
          onChange={onChange}
          onCaret={handleCaret}
          onDropHandled={() => setDragging(false)}
          onFiles={(files, pos) => void addFiles(files, pos)}
          onSend={() => {
            if (canSend) onSend();
          }}
          placeholderText={hero ? '有什么可以帮你？' : '回复…  @ 引用文件，/ 指令'}
          value={value}
        />
        <div className="flex items-center gap-1 px-2.5 pb-2.5 pt-1 @max-[160px]:gap-0.5 @max-[160px]:px-1.5">
          <IconButton aria-label="添加图片或附件" onClick={pickFiles} title="添加图片或附件">
            <Paperclip />
          </IconButton>
          <IconButton aria-label="引用资料" onClick={insertMention} title="引用资料（@）">
            <AtSign />
          </IconButton>
          <div className="flex-1" />
          {configured && contextUsage && <ContextIndicator usage={contextUsage} />}
          {configured && (
            <Popover.Root onOpenChange={openModelPicker} open={modelPickerOpen}>
              <Popover.Trigger asChild>
                <button
                  aria-label="模型服务"
                  className={cn(triggerButton, '@max-[220px]:px-1.5')}
                  title={model}
                  type="button"
                >
                  <span className="truncate @max-[220px]:hidden">{model}</span>
                  <Bot className="hidden size-3.5 @max-[220px]:block" />
                  <ChevronDown className="size-3 @max-[220px]:hidden" />
                </button>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content
                  align="end"
                  className={cn('z-50 w-80', menuPanel)}
                  side="bottom"
                  sideOffset={6}
                  style={{
                    animation: 'pop-in 180ms cubic-bezier(0.23,1,0.32,1) both',
                    transformOrigin: 'top center',
                  }}
                >
                  {providers === null ? (
                    <p className="px-2 py-3 text-[12px] text-ink-3">正在加载模型列表…</p>
                  ) : providers.length === 0 ? (
                    <div className="grid gap-2 px-1.5 py-2">
                      <p className="text-[12px] text-ink-3">
                        还没有配置模型供应商，可在设置 › 模型供应商 中添加。
                      </p>
                      <Button
                        className="w-full justify-start [&_svg]:size-3.5"
                        onClick={() => {
                          setModelPickerOpen(false);
                          useNavigationStore.getState().openSettings('providers');
                        }}
                        size="xs"
                        type="button"
                        variant="secondary"
                      >
                        <Settings />
                        打开设置 › 模型供应商
                      </Button>
                    </div>
                  ) : (
                    <div className="flex gap-0.5">
                      <ul aria-label="模型服务" className="max-h-64 w-28 shrink-0 overflow-y-auto">
                        {providers.map((provider) => (
                          <li key={provider.id}>
                            <button
                              className={cn(
                                'flex h-7.5 w-full items-center gap-1 rounded-[6px] px-2 text-left text-[12.5px] transition-colors',
                                provider.id === focusedId
                                  ? 'bg-hover font-medium text-ink'
                                  : 'text-ink-2 hover:bg-hover hover:text-ink',
                              )}
                              onClick={() => setFocusedId(provider.id)}
                              type="button"
                            >
                              <span className="truncate">{provider.name}</span>
                              {provider.active && (
                                <span
                                  aria-label="使用中"
                                  className="ms-auto size-1.5 shrink-0 rounded-full bg-green"
                                  title="使用中"
                                />
                              )}
                            </button>
                          </li>
                        ))}
                      </ul>
                      <ul
                        aria-label="模型"
                        className="max-h-64 min-w-0 flex-1 overflow-y-auto border-l border-line pl-1.5"
                      >
                        {focused?.models.map((item) => (
                          <li key={item}>
                            <button
                              className={cn(
                                'flex h-7.5 w-full items-center gap-1 rounded-[6px] px-2 text-left text-[12.5px] transition-colors',
                                focused.active && model === item
                                  ? 'bg-hover font-medium text-ink'
                                  : 'text-ink-2 hover:bg-hover hover:text-ink',
                              )}
                              onClick={() => {
                                setModelPickerOpen(false);
                                onModelSelect(focused, item);
                              }}
                              type="button"
                            >
                              <span className="truncate">{item}</span>
                              {focused.active && model === item && (
                                <Check
                                  className="ms-auto size-3 shrink-0 text-ink"
                                  strokeWidth={2.5}
                                />
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
                <button
                  aria-label="思考强度"
                  // 中窄容器（≤260px）收成图标而非整颗消失，极窄（≤160px）才随次要按钮退场。
                  className={cn(triggerButton, '@max-[260px]:px-1.5 @max-[160px]:hidden')}
                  disabled={effortLevels.length === 0}
                  title={
                    effortLevels.length ? '思考强度' : '在设置 › 模型供应商 中开启推理强度后可选'
                  }
                  type="button"
                >
                  <span className="truncate @max-[260px]:hidden">{effort ?? 'default'}</span>
                  <Sparkles className="hidden size-3.5 @max-[260px]:block" />
                  <ChevronDown className="size-3 @max-[260px]:hidden" />
                </button>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content
                  align="end"
                  className={cn('z-50 w-32', menuPanel)}
                  side="bottom"
                  sideOffset={6}
                  style={{
                    animation: 'pop-in 180ms cubic-bezier(0.23,1,0.32,1) both',
                    transformOrigin: 'top center',
                  }}
                >
                  <ul aria-label="思考强度">
                    {effortLevels.map((level) => (
                      <li key={level}>
                        <button
                          className={cn(
                            'flex h-7.5 w-full items-center gap-1 rounded-[6px] px-2 text-left text-[12.5px] transition-colors',
                            level === effort
                              ? 'bg-hover font-medium text-ink'
                              : 'text-ink-2 hover:bg-hover hover:text-ink',
                          )}
                          onClick={() => {
                            setEffortPickerOpen(false);
                            onEffortSelect(level);
                          }}
                          type="button"
                        >
                          <span className="truncate">{level}</span>
                          {level === effort && (
                            <Check className="ms-auto size-3 shrink-0 text-ink" strokeWidth={2.5} />
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
          )}
          {busy ? (
            <button
              aria-label="停止执行"
              className="flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-ink text-surface transition-opacity duration-150 hover:opacity-90 active:scale-[0.94]"
              onClick={onStop}
              title="停止执行"
              type="button"
            >
              <Square className="size-3 fill-current" />
            </button>
          ) : (
            <button
              aria-label="发送"
              className="flex size-7 shrink-0 items-center justify-center rounded-[8px] transition-[background-color,color,transform] duration-200 enabled:active:scale-[0.94]"
              disabled={!configured || !canSend}
              onClick={onSend}
              style={{
                background: configured && canSend ? 'var(--ink)' : 'var(--line-strong)',
                color: configured && canSend ? 'var(--surface)' : 'var(--ink-2)',
              }}
              title="发送"
              type="button"
            >
              <ArrowUp className="size-4" strokeWidth={2.4} />
            </button>
          )}
        </div>
        {/* min-w-56 下限在窄容器会越出 composer 边界（分屏时压到相邻组），≤260px 时收为贴容器宽。 */}
        {menuOpen && (
          <ul
            // 只保留 absolute：relative 与 absolute 同时写时生成 CSS 谁生效不确定，实测会掉回
            // 文档流向下撑开布局；父容器（composer 外框）已是 relative，向上展开由 bottom-full 定住。
            // 高亮块与 li 都靠本元素的绝对定位建立包含块，不能改成 static。
            className="absolute bottom-full left-0 z-20 mb-2 max-h-64 w-full min-w-56 overflow-auto rounded-[10px] bg-surface p-1 shadow-raised @max-[260px]:min-w-0"
            id={menuListId}
            role="listbox"
            style={{
              animation: 'pop-in 180ms cubic-bezier(0.23,1,0.32,1) both',
              transformOrigin: 'bottom center',
            }}
          >
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-1 rounded-[6px] bg-hover"
              style={{
                top: rowBox?.top ?? 0,
                height: rowBox?.height ?? 0,
                opacity: rowBox ? 1 : 0,
                transition:
                  'top 220ms cubic-bezier(0.23,1,0.32,1), height 220ms cubic-bezier(0.23,1,0.32,1), opacity 150ms ease',
              }}
            />
            {items.map((item, position) => (
              <li
                aria-selected={position === index}
                className="relative z-10 flex h-9 w-full items-center gap-2.5 rounded-[6px] px-2 text-left"
                id={menuOptionId(position)}
                key={'name' in item ? item.name : item.key}
                // 阻止点击选项时编辑器失焦。
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setIndex(position)}
                onClick={() => handleSelect(position)}
                ref={position === index ? itemRef : undefined}
                role="option"
              >
                {menu?.kind === 'mention' ? (
                  <AtSign className="size-3.5 shrink-0 text-ink-3" />
                ) : (
                  <span className="shrink-0 font-mono text-[12.5px] text-ink-3">/</span>
                )}
                {'name' in item ? (
                  <>
                    <span className="shrink-0 text-[12.5px] font-medium text-ink">
                      /{item.name}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-ink-3">
                      {item.hint}
                    </span>
                  </>
                ) : (
                  <MentionTitle title={item.title} />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** 引用候选的标题：目录留灰阶、文件名用强调蓝加粗——整条路径都上强调色反而找不到文件名。 */
function MentionTitle({ title }: { title: string }) {
  const at = title.lastIndexOf('/');
  const dir = at < 0 ? '' : title.slice(0, at + 1);
  const name = at < 0 ? title : title.slice(at + 1);
  return (
    <span className="min-w-0 flex-1 truncate text-[12.5px]">
      <span className="text-ink-3">{dir}</span>
      <span className="font-semibold" style={{ color: 'var(--cal-blue-text)' }}>
        {name}
      </span>
    </span>
  );
}

/** 引用与附件统一一种 chip：图标 + 名称 + 可选细节 + 移除。 */
function ComposerChip({
  icon,
  label,
  detail,
  onRemove,
  removeLabel,
}: {
  icon: ReactNode;
  label: string;
  detail?: string;
  onRemove: () => void;
  removeLabel: string;
}) {
  return (
    <span
      className="flex h-7 min-w-0 max-w-full items-center gap-1.5 rounded-control bg-field pr-0.5 pl-2 text-[12px] text-ink-2 shadow-hairline [&>svg]:size-3.5 [&>svg]:shrink-0 [&>svg]:text-ink-3"
      style={{ animation: 'pop-in 200ms cubic-bezier(0.23,1,0.32,1) both' }}
      title={label}
    >
      {icon}
      <span className="truncate">{label}</span>
      {detail && <span className="shrink-0 text-ink-3">{detail}</span>}
      <button
        aria-label={removeLabel}
        className="flex size-6 shrink-0 items-center justify-center rounded-chip text-ink-3 transition-colors duration-100 hover:bg-hover-2 hover:text-ink"
        onClick={onRemove}
        type="button"
      >
        <X className="size-3" strokeWidth={2.2} />
      </button>
    </span>
  );
}

/** composer 上方的提示条：发送前的错误（未配置、文件不支持、引用未保存）。 */
function ComposerNotice({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  return (
    <div
      className="absolute inset-x-0 bottom-full z-10 mb-2 flex items-start gap-2 rounded-card bg-surface bg-[linear-gradient(var(--red-tint),var(--red-tint))] px-3 py-1.5 text-[13px] leading-6 text-ink shadow-hairline"
      role="alert"
      style={{ animation: 'pop-in 180ms cubic-bezier(0.23,1,0.32,1) both' }}
    >
      <CircleAlert aria-hidden className="mt-1 size-3.5 shrink-0 text-red" />
      <p className="min-w-0 flex-1 break-words">{message}</p>
      {onDismiss && (
        <button
          aria-label="关闭提示"
          className="-mr-1 flex size-6 shrink-0 items-center justify-center rounded-chip text-ink-3 transition-colors hover:bg-surface hover:text-ink"
          onClick={onDismiss}
          type="button"
        >
          <X className="size-3" strokeWidth={2.2} />
        </button>
      )}
    </div>
  );
}

function ContextIndicator({ usage }: { usage: ContextUsageView }) {
  const tone = usageTone(usage.percent);
  const color =
    tone === 'red' ? 'var(--red)' : tone === 'orange' ? 'var(--orange)' : 'var(--ink-2)';
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          aria-label="上下文占用"
          className="flex size-7 shrink-0 items-center justify-center rounded-[8px] transition-colors duration-150 hover:bg-hover"
          title="上下文占用"
          type="button"
        >
          <ProgressRing progress={(usage.percent ?? 0) / 100} size={18} tone={tone} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="center"
          aria-label="上下文占用"
          className="z-50 w-60 rounded-[10px] bg-surface px-3 py-2.5 shadow-raised"
          side="top"
          sideOffset={6}
          style={{
            animation: 'pop-in 180ms cubic-bezier(0.23,1,0.32,1) both',
            transformOrigin: 'bottom center',
          }}
        >
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[12.5px] font-medium text-ink">上下文</span>
            <span className="text-[12px] tabular-nums text-ink-3">
              {usage.tokens === null ? '—' : formatTokens(usage.tokens)} /{' '}
              {formatTokens(usage.contextWindow)}
              {usage.percent !== null && ` (${usage.percent.toFixed(1).replace(/\.0$/, '')}%)`}
            </span>
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-field">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(100, usage.percent ?? 0)}%`,
                background: color,
                transition: 'width 400ms cubic-bezier(0.23,1,0.32,1)',
              }}
            />
          </div>
          {/* 按本会话累计显示（不是最近一轮）：单轮命中率受该轮是否新建缓存影响，波动大、看不出趋势。 */}
          <div className="mt-2 flex items-baseline justify-between gap-3">
            <span className="text-[12.5px] text-ink-2">缓存命中率</span>
            <span className="text-[12px] tabular-nums text-ink-3">{cacheHitRateText(usage)}</span>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
