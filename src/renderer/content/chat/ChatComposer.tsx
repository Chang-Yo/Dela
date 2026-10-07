import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Popover } from 'radix-ui';
import {
  ArrowUp,
  AtSign,
  Bot,
  Check,
  ChevronDown,
  FileText,
  Paperclip,
  Settings,
  Sparkles,
  Square,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { useNavigationStore } from '../../app/navigation';
import type { ChatCommandView, ChatMediaView, LlmProviderView } from '../../../shared/api';
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
  hero = false,
  projectPicker,
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
  attachments: ChatMediaView[];
  onAddAttachmentFile: (file: File) => Promise<void>;
  onAddAttachmentView: (view: ChatMediaView) => void;
  onRemoveAttachment: (id: string) => void;
  hero?: boolean;
  projectPicker?: ReactNode;
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
    <div
      className={cn(
        '@container relative rounded-3xl border bg-card shadow-xs transition-colors focus-within:border-ring/60',
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
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-3xl border-2 border-dashed border-ring/50 bg-background/80 text-sm text-muted-foreground">
          松开以添加图片或附件
        </div>
      )}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
          {attachments.map((item) => (
            <span
              className="flex min-w-0 max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground"
              key={item.id}
            >
              <FileText className="size-3 shrink-0 text-muted-foreground" />
              <span className="truncate" title={item.name}>
                {item.name}
              </span>
              <span className="shrink-0 text-muted-foreground">{formatSize(item.size)}</span>
              <button
                aria-label={`移除附件 ${item.name}`}
                className="grid size-4 shrink-0 place-items-center rounded text-muted-foreground hover:text-foreground"
                onClick={() => onRemoveAttachment(item.id)}
                type="button"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {references.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
          {references.map((ref) => (
            <span
              className="flex min-w-0 max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground"
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
        placeholderText={
          hero ? '查找资料、安排日程，或继续一个项目…' : '继续对话，@ 引用资料，/ 使用指令…'
        }
        value={value}
      />
      {fileError && (
        <p className="px-4 text-xs text-destructive" role="alert">
          {fileError}
        </p>
      )}
      <div className="flex items-center gap-1 px-2.5 pb-2.5 pt-1 @max-[160px]:gap-0.5 @max-[160px]:px-1.5">
        <Button
          aria-label="添加图片或附件"
          className="text-muted-foreground @max-[160px]:size-7"
          onClick={pickFiles}
          size="icon-sm"
          title="添加图片或附件"
          type="button"
          variant="ghost"
        >
          <Paperclip />
        </Button>
        <Button
          aria-label="引用资料"
          className="text-muted-foreground @max-[160px]:size-7"
          onClick={insertMention}
          size="icon-sm"
          title="引用资料（@）"
          type="button"
          variant="ghost"
        >
          <AtSign />
        </Button>
        {projectPicker}
        <div className="flex-1" />
        {configured && (
          <Popover.Root onOpenChange={openModelPicker} open={modelPickerOpen}>
            <Popover.Trigger asChild>
              <Button
                aria-label="模型服务"
                className="min-w-0 shrink gap-1 text-xs text-muted-foreground @max-[220px]:px-1.5"
                size="sm"
                title={model}
                type="button"
                variant="ghost"
              >
                <span className="truncate @max-[220px]:hidden">{model}</span>
                <Bot className="hidden size-3.5 @max-[220px]:block" />
                <ChevronDown className="size-3 @max-[220px]:hidden" />
              </Button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                align="end"
                className="z-50 w-80 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
                side="bottom"
                sideOffset={6}
              >
                {providers === null ? (
                  <p className="px-2 py-3 text-xs text-muted-foreground">正在加载模型列表…</p>
                ) : providers.length === 0 ? (
                  <div className="grid gap-2 px-2 py-3">
                    <p className="text-xs text-muted-foreground">
                      还没有配置模型供应商，可在设置 › 模型供应商 中添加。
                    </p>
                    <Button
                      className="w-full justify-start gap-1.5 text-xs"
                      onClick={() => {
                        setModelPickerOpen(false);
                        useNavigationStore.getState().openSettings('providers');
                      }}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <Settings className="size-3.5" />
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
                                className="ms-auto size-1.5 shrink-0 rounded-full bg-success"
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
                // 中窄容器（≤260px）收成图标而非整颗消失，极窄（≤160px）才随次要按钮退场。
                className="min-w-0 shrink gap-1 text-xs text-muted-foreground @max-[260px]:px-1.5 @max-[160px]:hidden"
                disabled={effortLevels.length === 0}
                size="sm"
                title={
                  effortLevels.length ? '思考强度' : '在设置 › 模型供应商 中开启推理强度后可选'
                }
                type="button"
                variant="ghost"
              >
                <span className="truncate @max-[260px]:hidden">{effort ?? 'default'}</span>
                <Sparkles className="hidden size-3.5 @max-[260px]:block" />
                <ChevronDown className="size-3 @max-[260px]:hidden" />
              </Button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                align="end"
                className="z-50 w-32 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
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
            className="rounded-full @max-[160px]:size-7"
            onClick={onStop}
            size="icon-sm"
            type="button"
          >
            <Square className="size-3.5" />
          </Button>
        ) : (
          <Button
            aria-label="发送"
            className="rounded-full @max-[160px]:size-7"
            disabled={!configured || !canSend}
            onClick={onSend}
            size="icon-sm"
            type="button"
          >
            <ArrowUp />
          </Button>
        )}
      </div>
      {/* min-w-56 下限在窄容器会越出 composer 边界（分屏时压到相邻组），≤260px 时收为贴容器宽。 */}
      {menuOpen && (
        <ul
          className="absolute bottom-full left-0 z-20 mb-2 max-h-64 w-full min-w-56 overflow-auto rounded-lg border bg-popover p-1 shadow-lg @max-[260px]:min-w-0"
          id={menuListId}
          role="listbox"
        >
          {items.map((item, position) => (
            <li
              aria-selected={position === index}
              className={cn(
                'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm',
                position === index ? 'bg-accent text-accent-foreground' : '',
              )}
              id={menuOptionId(position)}
              key={'name' in item ? item.name : item.key}
              // 阻止点击选项时编辑器失焦。
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => handleSelect(position)}
              ref={position === index ? itemRef : undefined}
              role="option"
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
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
