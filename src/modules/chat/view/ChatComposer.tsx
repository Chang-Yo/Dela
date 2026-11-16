import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUp,
  AtSign,
  Bot,
  Check,
  ChevronDown,
  CircleAlert,
  FileText,
  Globe,
  Layers,
  MessageSquare,
  Paperclip,
  Settings,
  Sparkles,
  Square,
  SquareTerminal,
  Undo2,
  X,
} from 'lucide-react';
import { cn } from '../../../ui/cn';
import type { ComposerContext } from './composer-context';
import { ComposerContextBar } from './composer-context-bar';
import { ReplyCommentRail } from './reply-comment';
import { formatDuration } from './ToolTimeline';
import { openSubagent } from './tool-views';
import { Button } from '../../../ui/button';
import { useNow } from '../../../ui/use-now';
import { IconButton } from '../../../ui/icon-button';
import { Popover, PopoverContent, PopoverTrigger } from '../../../ui/popover';
import { ProgressRing } from '../../../ui/progress-ring';
import { useChatTabSource } from './chat-source';
import type {
  BackgroundTaskView,
  ChatComment,
  ChatMediaView,
  ContextUsageView,
} from '../../../core/protocol/agent';
import type { LlmProviderView } from '../../../core/protocol/llm';
import { SESSION_COMMANDS } from '../../../core/protocol/agent';
import {
  CHAT_ATTACHMENT_MAX,
  chatFileKindOfFile,
  chatImageToken,
  hasChatImages,
  INLINE_IMAGE_MAX,
  matchChatImageTokens,
} from '../../../core/protocol/chat-input';
import type { ChatReference } from './use-chat';
import { ComposerEditor, type ComposerEditorHandle } from './ComposerEditor';
import { releaseChatMedia, setChatMediaPreview } from './media';
import {
  agentClient,
  capabilitiesClient,
  chatClient,
  llmClient,
  onWebSearchChanged,
} from './client';
import { errorMessage } from '../../../core/protocol/contract';

const builtinCommands = [
  { name: '日程', prompt: '帮我查看本周的日程安排', hint: '课程与个人事件' },
  { name: '作业', prompt: '帮我查询即将截止的作业，按课程整理', hint: 'Canvas 截止时间' },
  { name: '邮件', prompt: '帮我查找最近的未读邮件', hint: '已缓存的邮件' },
  { name: '资料', prompt: '帮我在课程资料中查找相关文件', hint: '搜索并读取资料' },
  { name: '整理', prompt: '帮我把引用资料里的要点整理成一份笔记', hint: '生成并保存笔记' },
];

type MenuState = { kind: 'slash' | 'mention' | 'session'; query: string; start: number } | null;

/** 检测光标前的 /、@ 或 # 触发词；单独输入也打开候选（空查询）。「# 」是 Markdown 标题，不触发。 */
function detectMenu(text: string, caret: number): MenuState {
  const before = text.slice(0, caret);
  const slash = /(?:^|\s)\/([^\s]{0,30})$/.exec(before);
  if (slash) return { kind: 'slash', query: slash[1]!, start: caret - slash[1]!.length - 1 };
  const mention = /(?:^|\s)@([^\s@]{0,50})$/.exec(before);
  if (mention)
    return { kind: 'mention', query: mention[1]!, start: caret - mention[1]!.length - 1 };
  const session = /(?:^|\s)#([^\s#]{0,50})$/.exec(before);
  if (session)
    return { kind: 'session', query: session[1]!, start: caret - session[1]!.length - 1 };
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
  'flex h-7 min-w-0 shrink items-center gap-1 rounded-control px-1.5 text-xs font-medium text-ink-2 transition-colors duration-base hover:bg-hover hover:text-ink';
const webSearchOptionsKey = ['capabilities', 'webSearchOptions'];
// 候选行固定 h-9（9 个 spacing 单位），滑动高亮据此定位。
const MENU_ROW_UNITS = 9;
const scrollRowIntoView = (node: HTMLLIElement | null) =>
  node?.scrollIntoView({ block: 'nearest' });

export function ChatComposer({
  value,
  onChange,
  onSend,
  onStop,
  busy,
  configured,
  providerId = null,
  model,
  modelUnavailable = false,
  onModelSelect,
  effort,
  effortLevels,
  onEffortSelect,
  referenceOptions,
  attachments,
  comments,
  onCommentsChange,
  onAddAttachmentFile,
  onAddAttachmentView,
  onRemoveAttachment,
  contextUsage = null,
  notice = null,
  onDismissNotice,
  hero = false,
  context = null,
  sidechat = false,
  queued = [],
  onWithdrawQueued,
  tasks = [],
  onStopTask,
}: {
  /** 运行中插队、还没送达的消息；非空时显示在输入框上方，可整体撤回。 */
  queued?: string[];
  onWithdrawQueued?: () => void;
  /** 正在运行的后台任务；为空时不显示工具栏里的后台任务按钮。 */
  tasks?: BackgroundTaskView[];
  onStopTask?: (taskId: string) => void;
  /** 旁问输入框：模型与思考强度沿用主会话、联网搜索是全局开关，这三个选择器都不显示。 */
  sidechat?: boolean;
  /** 新对话的项目浮岛数据；null = 不显示（已有历史或通用池没有项目）。 */
  context?: ComposerContext | null;
  /** 发送前错误（会话层），显示在输入框上方；null = 无。 */
  notice?: string | null;
  onDismissNotice?: () => void;
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  busy: boolean;
  configured: boolean;
  /** 会话选中的提供商；模型列表据此标出当前项。 */
  providerId?: string | null;
  model: string;
  /** 会话的模型已停用或被移除：禁止发送，提示另选。 */
  modelUnavailable?: boolean;
  onModelSelect: (provider: LlmProviderView, model: string) => void;
  /** 当前推理强度档位；未配置时为 null，显示 default 并提供设置入口。 */
  effort: string | null;
  effortLevels: string[];
  onEffortSelect: (level: string) => void;
  referenceOptions: ChatReference[];
  attachments: ChatMediaView[];
  /** 对回复正文的评论（草稿的一部分），显示在附件条上方的独立轨道。 */
  comments: ChatComment[];
  onCommentsChange: (comments: ChatComment[]) => void;
  onAddAttachmentFile: (file: File) => Promise<void>;
  onAddAttachmentView: (view: ChatMediaView) => void;
  onRemoveAttachment: (id: string) => void;
  contextUsage?: ContextUsageView | null;
  hero?: boolean;
}) {
  const { navigate } = useChatTabSource();
  const editorRef = useRef<ComposerEditorHandle | null>(null);
  const [menu, setMenu] = useState<MenuState>(null);
  const [index, setIndex] = useState(0);
  // 候选菜单 id 逐实例唯一（同页可同时挂多个会话的 composer），选项 id 按序号派生，
  // 供编辑器的 aria-controls / aria-activedescendant 引用。
  const menuListId = `${useId()}-list`;
  const menuOptionId = (position: number) => `${menuListId}-option-${position}`;
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const customCommands = useQuery({
    queryKey: ['settings', 'commands'],
    queryFn: () => agentClient['list-commands']({}),
  }).data;
  // 两列模型面板：打开时重读设置配置保证新鲜；focusedId 是左列手动查看的提供商，空则跟随当前使用项。
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const providerQuery = useQuery({
    queryKey: ['llm', 'providers'],
    queryFn: () => llmClient.list(),
    enabled: Boolean(window.dela) && modelPickerOpen,
  });
  const providers = providerQuery.data?.filter((view) => view.enabled) ?? null;
  const providersFailed = providerQuery.isError;
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const focused =
    providers?.find((provider) => provider.id === focusedId) ??
    providers?.find((provider) => provider.id === providerId) ??
    providers?.[0] ??
    null;
  const [effortPickerOpen, setEffortPickerOpen] = useState(false);
  // 搜索服务选择器：选中态是持久数据，挂载即读（发送首轮会重挂 composer）；配置的增删改在设置弹窗。
  const [searchPickerOpen, setSearchPickerOpen] = useState(false);
  const searchQuery = useQuery({
    queryKey: webSearchOptionsKey,
    queryFn: () => capabilitiesClient.listWebSearchOptions(),
    enabled: Boolean(window.dela),
  });
  const searchEntries = searchQuery.data?.entries ?? null;
  const searchSelectedId = searchQuery.data?.selectedId ?? null;
  const searchFailed = searchQuery.isError;
  // 先取消在途读取：首次读取还没回来时，失效不会重读，旧响应会盖掉新配置。
  const refreshSearch = async () => {
    await queryClient.cancelQueries({ queryKey: webSearchOptionsKey });
    await queryClient.invalidateQueries({ queryKey: webSearchOptionsKey });
  };
  useEffect(() => onWebSearchChanged(() => void refreshSearch()), []);

  const slashItems =
    menu?.kind === 'slash'
      ? [
          ...builtinCommands,
          ...(customCommands ?? []).map((command) => ({ ...command, hint: '自定义' })),
          // Dela 的会话命令：插入 `/name ` 留给参数，发送时由 use-chat 拦下执行。
          // 旁问里没有会话命令：发出去就是普通提问。
          ...(sidechat ? [] : SESSION_COMMANDS).map((command) => ({
            name: command.name,
            prompt: `/${command.name} `,
            hint: ['argumentHint' in command ? command.argumentHint : '', command.description]
              .filter(Boolean)
              .join(' · '),
          })),
        ].filter((command) => command.name.includes(menu.query))
      : [];
  const mentionItems =
    menu && menu.kind !== 'slash'
      ? referenceOptions
          .filter(
            (option) =>
              Boolean(option.session) === (menu.kind === 'session') &&
              option.title.toLowerCase().includes(menu.query.toLowerCase()),
          )
          .slice(0, 8)
      : [];
  const items: (typeof slashItems)[number][] | ChatReference[] =
    menu?.kind === 'slash' ? slashItems : mentionItems;
  const menuOpen = menu !== null && items.length > 0;

  const handleCaret = (text: string, caret: number) => {
    if (fileError) setFileError(null);
    const next = detectMenu(text, caret);
    // 候选词变化时高亮从头开始；同词内移动光标保留当前高亮。
    const kindChanged = next?.kind !== menu?.kind;
    const queryChanged = next?.query !== menu?.query;
    if (kindChanged || queryChanged) setIndex(0);
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
      // 引用即文本：原位留下「@相对路径」或「#会话标题」token（尾随空格隔开后续输入），发送时解析回 key。
      editorRef.current?.replaceRange(
        menu.start,
        caret,
        `${option.session ? '#' : '@'}${option.title} `,
      );
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
    let attachmentCount = attachments.length;
    for (const file of files) {
      const kind = await chatFileKindOfFile(file);
      if (kind === 'image' && imageCount >= INLINE_IMAGE_MAX) {
        setFileError(`最多插入 ${INLINE_IMAGE_MAX} 张图片`);
        continue;
      }
      if (kind !== 'image' && attachmentCount >= CHAT_ATTACHMENT_MAX) {
        setFileError(`附件最多 ${CHAT_ATTACHMENT_MAX} 个`);
        continue;
      }
      try {
        if (kind === 'image') {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const view = await agentClient['stage-media']({ name: file.name, bytes });
          insertPos = insertImageView(view, insertPos);
          imageCount += 1;
        } else {
          await onAddAttachmentFile(file);
          attachmentCount += 1;
        }
        setFileError(null);
      } catch (e) {
        setFileError(errorMessage(e));
      }
    }
  };

  const pickFiles = () => {
    if (!window.dela) return;
    void chatClient
      .pickMedia()
      .then((views) => {
        let insertPos = editorRef.current?.selectionStart() ?? value.length;
        let imageCount = matchChatImageTokens(value).length;
        let attachmentCount = attachments.length;
        for (const view of views) {
          try {
            if (view.kind === 'image') {
              if (imageCount >= INLINE_IMAGE_MAX) {
                setFileError(`最多插入 ${INLINE_IMAGE_MAX} 张图片`);
                releaseChatMedia([view.id]);
                continue;
              }
              insertPos = insertImageView(view, insertPos);
              imageCount += 1;
            } else if (attachmentCount >= CHAT_ATTACHMENT_MAX) {
              releaseChatMedia([view.id]);
              setFileError(`附件最多 ${CHAT_ATTACHMENT_MAX} 个`);
            } else {
              onAddAttachmentView(view);
              attachmentCount += 1;
            }
          } catch (error) {
            releaseChatMedia([view.id]);
            setFileError(errorMessage(error));
          }
        }
      })
      .catch((e) => setFileError(errorMessage(e)));
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

  const canSend =
    value.trim().length > 0 ||
    hasChatImages(value) ||
    attachments.length > 0 ||
    comments.length > 0;

  const sendable = configured && !modelUnavailable && canSend;
  // 主会话运行中输入框有内容就是插队发送；旁问不插队，运行中始终是停止。
  const stoppable = busy && (sidechat || !canSend);

  const openModelPicker = (open: boolean) => {
    setModelPickerOpen(open);
    if (open) setFocusedId(null);
  };

  const openSearchPicker = (open: boolean) => {
    setSearchPickerOpen(open);
    if (open) void refreshSearch();
  };

  const selectSearchEntry = async (id: string | null) => {
    if (!window.dela) return;
    try {
      await capabilitiesClient.selectWebSearchEntry(id);
      void refreshSearch();
      setSearchPickerOpen(false);
    } catch (cause) {
      setFileError(errorMessage(cause));
      setSearchPickerOpen(false);
    }
  };

  const selectedSearch = searchEntries?.find(({ id }) => id === searchSelectedId) ?? null;

  return (
    <div className="relative">
      {/* 新对话的项目浮岛：项目与分支各一个可点胶囊；有历史后 context 为 null 就撤掉。 */}
      {context && <ComposerContextBar context={context} />}
      {queued.length > 0 && <QueuedMessages messages={queued} onWithdraw={onWithdrawQueued} />}
      {/* 提示条浮在输入框上方，不推移输入框与消息列表。 */}
      {(fileError ?? notice) && (
        <ComposerNotice
          message={(fileError ?? notice)!}
          onDismiss={fileError ? () => setFileError(null) : onDismissNotice}
        />
      )}
      <div
        className={cn(
          '@container relative rounded-window border border-line bg-surface shadow-card transition-colors duration-base focus-within:border-line-strong',
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
          <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-window border-2 border-dashed border-line-strong bg-page/80 text-sm text-ink-3">
            松开以添加图片或附件
          </div>
        )}
        {(comments.length > 0 || attachments.length > 0) && (
          <div className="grid gap-1.5 px-3 pt-3">
            {comments.length > 0 && (
              <ReplyCommentRail comments={comments} onChange={onCommentsChange} />
            )}
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
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
            if (canSend && !modelUnavailable) onSend();
          }}
          placeholderText={
            hero
              ? '有什么可以帮你？'
              : sidechat
                ? '顺便问一句…  @ 引用文件'
                : '回复…  @ 引用文件，/ 指令'
          }
          referenceOptions={referenceOptions}
          value={value}
        />
        <div className="flex items-center gap-1 px-2.5 pb-2.5 pt-1 @max-[160px]:gap-0.5 @max-[160px]:px-1.5">
          <IconButton aria-label="添加图片或附件" onClick={pickFiles} title="添加图片或附件">
            <Paperclip />
          </IconButton>
          <IconButton aria-label="引用资料" onClick={insertMention} title="引用资料（@）">
            <AtSign />
          </IconButton>
          {!sidechat && (
            <Popover onOpenChange={openSearchPicker} open={searchPickerOpen}>
              <PopoverTrigger asChild>
                <IconButton
                  aria-label={
                    selectedSearch ? `联网搜索：${selectedSearch.name}` : '联网搜索：未开启'
                  }
                  title={selectedSearch ? `联网搜索：${selectedSearch.name}` : '联网搜索：未开启'}
                >
                  <Globe className={selectedSearch ? 'text-success' : undefined} />
                </IconButton>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-64" side="bottom">
                {searchEntries === null ? (
                  <p className="px-2 py-3 text-xs text-ink-3">
                    {searchFailed ? '搜索配置加载失败' : '正在加载搜索配置…'}
                  </p>
                ) : searchEntries.length === 0 ? (
                  <div className="grid gap-2 px-1.5 py-2">
                    <p className="text-xs text-ink-3">
                      还没有搜索服务配置，可在设置 › 内置能力 的「网络」分组中添加。
                    </p>
                    <Button
                      className="w-full justify-start [&_svg]:size-3.5"
                      onClick={() => {
                        setSearchPickerOpen(false);
                        navigate({ page: 'settings', section: 'capabilities' });
                      }}
                      size="sm"
                      variant="outline"
                    >
                      <Settings />
                      打开设置 › 内置能力
                    </Button>
                  </div>
                ) : (
                  <ul aria-label="联网搜索">
                    <li>
                      <button
                        aria-checked={searchSelectedId === null}
                        className={cn(
                          'flex h-8 w-full items-center gap-2 rounded-chip px-2 text-left text-sm transition-colors',
                          searchSelectedId === null
                            ? 'bg-hover font-medium text-ink'
                            : 'text-ink-2 hover:bg-hover hover:text-ink',
                        )}
                        onClick={() => void selectSearchEntry(null)}
                        role="radio"
                        type="button"
                      >
                        <span className="truncate">关闭</span>
                        {searchSelectedId === null && (
                          <Check className="ms-auto size-3 shrink-0 text-ink" strokeWidth={2.5} />
                        )}
                      </button>
                    </li>
                    {searchEntries.map((entry) => (
                      <li key={entry.id}>
                        <button
                          aria-checked={entry.id === searchSelectedId}
                          className={cn(
                            'flex h-8 w-full items-center gap-2 rounded-chip px-2 text-left text-sm transition-colors',
                            entry.id === searchSelectedId
                              ? 'bg-hover font-medium text-ink'
                              : 'text-ink-2 hover:bg-hover hover:text-ink',
                          )}
                          onClick={() => void selectSearchEntry(entry.id)}
                          role="radio"
                          type="button"
                        >
                          <span className="truncate">{entry.name}</span>
                          {entry.provider === 'deepseek' && (
                            <span className="shrink-0 text-xs text-ink-3">按次计费</span>
                          )}
                          {entry.id === searchSelectedId && (
                            <Check className="ms-auto size-3 shrink-0 text-ink" strokeWidth={2.5} />
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </PopoverContent>
            </Popover>
          )}
          <div className="flex-1" />
          {tasks.length > 0 && onStopTask && <BackgroundTasks onStop={onStopTask} tasks={tasks} />}
          {configured && contextUsage && <ContextIndicator usage={contextUsage} />}
          {configured && !sidechat && (
            <Popover onOpenChange={openModelPicker} open={modelPickerOpen}>
              <PopoverTrigger asChild>
                <button
                  aria-label="模型服务"
                  className={cn(
                    triggerButton,
                    '@max-[220px]:px-1.5',
                    modelUnavailable && 'text-danger hover:text-danger',
                  )}
                  title={modelUnavailable ? `${model}（已停用或被移除，请另选模型）` : model}
                  type="button"
                >
                  <span className="truncate @max-[220px]:hidden">
                    {modelUnavailable ? `${model} · 已停用` : model}
                  </span>
                  <Bot className="hidden size-3.5 @max-[220px]:block" />
                  <ChevronDown className="size-3 @max-[220px]:hidden" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80" side="bottom">
                {providers === null ? (
                  providersFailed ? (
                    <p className="px-2 py-3 text-xs text-ink-3">模型列表加载失败</p>
                  ) : (
                    <p className="px-2 py-3 text-xs text-ink-3">正在加载模型列表…</p>
                  )
                ) : providers.length === 0 ? (
                  <div className="grid gap-2 px-1.5 py-2">
                    <p className="text-xs text-ink-3">
                      还没有启用的模型供应商，可在设置 › 模型服务 中添加或启用。
                    </p>
                    <Button
                      className="w-full justify-start [&_svg]:size-3.5"
                      onClick={() => {
                        setModelPickerOpen(false);
                        navigate({ page: 'settings', section: 'providers' });
                      }}
                      size="sm"
                      variant="outline"
                    >
                      <Settings />
                      打开设置 › 模型服务
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-0.5">
                    <ul aria-label="模型服务" className="max-h-64 w-28 shrink-0 overflow-y-auto">
                      {providers.map((provider) => (
                        <li key={provider.id}>
                          <button
                            className={cn(
                              'flex h-7.5 w-full items-center gap-1 rounded-chip px-2 text-left text-sm transition-colors',
                              provider.id === focused?.id
                                ? 'bg-hover font-medium text-ink'
                                : 'text-ink-2 hover:bg-hover hover:text-ink',
                            )}
                            onClick={() => setFocusedId(provider.id)}
                            type="button"
                          >
                            <span className="truncate">{provider.name}</span>
                            {provider.id === providerId && (
                              <span
                                aria-label="本会话使用"
                                className="ms-auto size-1.5 shrink-0 rounded-full bg-success"
                                title="本会话使用"
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
                              'flex h-7.5 w-full items-center gap-1 rounded-chip px-2 text-left text-sm transition-colors',
                              focused.id === providerId && model === item
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
                            {focused.id === providerId && model === item && (
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
              </PopoverContent>
            </Popover>
          )}
          {configured && !sidechat && (
            <Popover onOpenChange={setEffortPickerOpen} open={effortPickerOpen}>
              <PopoverTrigger asChild>
                <button
                  aria-label="思考强度"
                  // 中窄容器（≤260px）收成图标而非整颗消失，极窄（≤160px）才随次要按钮退场。
                  className={cn(triggerButton, '@max-[260px]:px-1.5 @max-[160px]:hidden')}
                  title="思考强度"
                  type="button"
                >
                  <span className="truncate @max-[260px]:hidden">{effort ?? 'default'}</span>
                  <Sparkles className="hidden size-3.5 @max-[260px]:block" />
                  <ChevronDown className="size-3 @max-[260px]:hidden" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className={effortLevels.length ? 'w-32' : 'w-80'}
                side="bottom"
              >
                {effortLevels.length === 0 ? (
                  <div className="grid gap-2 px-1.5 py-2">
                    <p className="text-xs text-ink-3">
                      当前模型尚未配置可选的思考强度档位。在设置中编辑当前模型，勾选其支持的档位并保存。
                    </p>
                    <Button
                      className="w-full justify-start [&_svg]:size-3.5"
                      onClick={() => {
                        setEffortPickerOpen(false);
                        navigate({ page: 'settings', section: 'providers' });
                      }}
                      size="sm"
                      variant="outline"
                    >
                      <Settings />
                      打开设置 › 模型服务
                    </Button>
                  </div>
                ) : (
                  <ul aria-label="思考强度">
                    {effortLevels.map((level) => (
                      <li key={level}>
                        <button
                          className={cn(
                            'flex h-7.5 w-full items-center gap-1 rounded-chip px-2 text-left text-sm transition-colors',
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
                )}
              </PopoverContent>
            </Popover>
          )}
          {stoppable ? (
            <button
              aria-label="停止执行"
              className="flex size-7 shrink-0 items-center justify-center rounded-control bg-ink text-surface transition-opacity duration-base hover:opacity-90 active:scale-[0.94]"
              onClick={onStop}
              title="停止执行"
              type="button"
            >
              <Square className="size-3 fill-current" />
            </button>
          ) : (
            <button
              aria-label="发送"
              className="flex size-7 shrink-0 items-center justify-center rounded-control transition-[background-color,color,transform] duration-slow enabled:active:scale-[0.94]"
              disabled={!sendable}
              onClick={onSend}
              style={{
                background: sendable ? 'var(--ink)' : 'var(--line-strong)',
                color: sendable ? 'var(--surface)' : 'var(--ink-2)',
              }}
              title={modelUnavailable ? '这个会话的模型已停用，请先另选模型' : '发送'}
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
            className="absolute bottom-full left-0 z-20 mb-2 max-h-64 w-full min-w-56 overflow-auto rounded-card bg-surface p-1 shadow-raised @max-[260px]:min-w-0"
            id={menuListId}
            role="listbox"
          >
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-1 rounded-chip bg-hover"
              style={{
                top: `calc(var(--spacing) * ${index * MENU_ROW_UNITS + 1})`,
                height: `calc(var(--spacing) * ${MENU_ROW_UNITS})`,
                opacity: index < items.length ? 1 : 0,
                transition:
                  'top 220ms cubic-bezier(0.23,1,0.32,1), height 220ms cubic-bezier(0.23,1,0.32,1), opacity 150ms ease',
              }}
            />
            {items.map((item, position) => (
              <li
                aria-selected={position === index}
                className="relative z-10 flex h-9 w-full items-center gap-2.5 rounded-chip px-2 text-left"
                id={menuOptionId(position)}
                key={'name' in item ? item.name : item.key}
                // 阻止点击选项时编辑器失焦。
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setIndex(position)}
                onClick={() => handleSelect(position)}
                ref={position === index ? scrollRowIntoView : undefined}
                role="option"
              >
                {menu?.kind === 'mention' ? (
                  <FileText className="size-3.5 shrink-0 text-ink-3" />
                ) : menu?.kind === 'session' ? (
                  <MessageSquare className="size-3.5 shrink-0 text-ink-3" />
                ) : (
                  <span className="shrink-0 font-mono text-sm text-ink-3">/</span>
                )}
                {'name' in item ? (
                  <>
                    <span className="shrink-0 text-sm font-medium text-ink">/{item.name}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-ink-3">{item.hint}</span>
                  </>
                ) : item.session ? (
                  <span
                    className="min-w-0 flex-1 truncate text-sm font-semibold"
                    style={{ color: 'var(--accent-ink)' }}
                  >
                    {item.title}
                  </span>
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

/** 引用候选：文件名强调蓝加粗在前，所在目录以小字灰阶缀后（过长省略号截断）。 */
function MentionTitle({ title }: { title: string }) {
  const at = title.lastIndexOf('/');
  const dir = at < 0 ? '' : title.slice(0, at + 1);
  const name = at < 0 ? title : title.slice(at + 1);
  return (
    <span className="flex min-w-0 flex-1 items-baseline gap-1.5 text-sm">
      <span className="shrink-0 font-semibold" style={{ color: 'var(--accent-ink)' }}>
        {name}
      </span>
      {dir && <span className="min-w-0 truncate text-xs text-ink-3">{dir}</span>}
    </span>
  );
}

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
      className="flex h-7 min-w-0 max-w-full items-center gap-1.5 rounded-control bg-field pr-0.5 pl-2 text-xs text-ink-2 shadow-hairline [&>svg]:size-3.5 [&>svg]:shrink-0 [&>svg]:text-ink-3"
      style={{ animation: 'pop-in 200ms cubic-bezier(0.23,1,0.32,1) both' }}
      title={label}
    >
      {icon}
      <span className="truncate">{label}</span>
      {detail && <span className="shrink-0 text-ink-3">{detail}</span>}
      <IconButton
        size="sm"
        aria-label={removeLabel}

        onClick={onRemove}
      >
        <X strokeWidth={2.2} />
      </IconButton>
    </span>
  );
}

/** composer 上方的提示条：发送前的错误（未配置、文件不支持、引用未保存）。 */
/** 待送达的插队消息：当前工具执行完后才交给模型；撤回把它们全部放回输入框（Pi 的队列只能整体清空）。 */
function QueuedMessages({ messages, onWithdraw }: { messages: string[]; onWithdraw?: () => void }) {
  return (
    <div
      aria-label="待送达的消息"
      className="mb-2 flex items-start gap-2 rounded-card bg-surface px-3 py-1.5 text-sm leading-6 shadow-hairline"
      role="status"
      style={{ animation: 'pop-in 180ms cubic-bezier(0.23,1,0.32,1) both' }}
    >
      <ol className="min-w-0 flex-1">
        {messages.map((text, index) => (
          <li className="flex min-w-0 items-baseline gap-2" key={index}>
            <span
              aria-hidden
              className="min-w-3 shrink-0 text-right text-xs tabular-nums text-ink-3"
            >
              {index + 1}
            </span>
            <span className="truncate text-ink-2" title={text}>
              {text.trim() || '图片或附件'}
            </span>
          </li>
        ))}
      </ol>
      {onWithdraw && (
        <button
          className="-mr-1 flex h-6 shrink-0 items-center gap-1 rounded-chip px-1.5 text-xs text-ink-3 transition-colors hover:bg-hover hover:text-ink [&_svg]:size-3"
          onClick={onWithdraw}
          title="撤回到输入框"
          type="button"
        >
          <Undo2 />
          撤回
        </button>
      )}
    </div>
  );
}

function ComposerNotice({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  return (
    <div
      className="absolute inset-x-0 bottom-full z-10 mb-2 flex items-start gap-2 rounded-card bg-surface bg-[linear-gradient(var(--danger-tint),var(--danger-tint))] px-3 py-1.5 text-sm leading-6 text-ink shadow-hairline"
      role="alert"
      style={{ animation: 'pop-in 180ms cubic-bezier(0.23,1,0.32,1) both' }}
    >
      <CircleAlert aria-hidden className="mt-1 size-3.5 shrink-0 text-danger" />
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

/** 工具栏里的后台任务：图标带运行数，弹层逐个列出，可停止；子 Agent 点开进入它的子会话。 */
function BackgroundTasks({
  tasks,
  onStop,
}: {
  tasks: BackgroundTaskView[];
  onStop: (taskId: string) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          aria-label={`后台任务（${tasks.length} 个运行中）`}
          className="flex h-7 shrink-0 items-center gap-1 rounded-control px-1.5 text-ink-3 transition-colors duration-base hover:bg-hover hover:text-ink"
          title="后台任务"
          type="button"
        >
          <Layers className="size-4" />
          <span className="text-xs tabular-nums">{tasks.length}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" aria-label="后台任务" className="w-72" side="top">
        <BackgroundTaskList onStop={onStop} tasks={tasks} />
      </PopoverContent>
    </Popover>
  );
}

/** 弹层打开时才挂载：计时每秒走一次，关上即停。 */
function BackgroundTaskList({
  tasks,
  onStop,
}: {
  tasks: BackgroundTaskView[];
  onStop: (taskId: string) => void;
}) {
  const { navigate } = useChatTabSource();
  const now = useNow(1000);
  return (
    <ul className="grid grid-cols-1">
      {tasks.map((task) => {
        const Icon = task.kind === 'bash' ? SquareTerminal : Bot;
        const label = (
          <>
            <Icon className="size-3.5 shrink-0 text-ink-3" />
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-sm text-ink',
                task.kind === 'bash' && 'font-mono',
              )}
              title={task.label}
            >
              {task.label}
            </span>
          </>
        );
        return (
          <li className="flex h-9 items-center gap-2 rounded-chip pl-2 pr-1" key={task.id}>
            {task.kind === 'subagent' ? (
              <button
                className="flex min-w-0 flex-1 items-center gap-2 text-left hover:underline"
                onClick={() => void openSubagent(task.id, navigate)}
                title="打开子会话"
                type="button"
              >
                {label}
              </button>
            ) : (
              label
            )}
            <span className="shrink-0 text-xs tabular-nums text-ink-3">
              {formatDuration(now - task.startedAt)}
            </span>
            <IconButton aria-label="停止" onClick={() => onStop(task.id)} title="停止">
              <Square />
            </IconButton>
          </li>
        );
      })}
    </ul>
  );
}

function ContextIndicator({ usage }: { usage: ContextUsageView }) {
  const tone = usageTone(usage.percent);
  const color =
    tone === 'red' ? 'var(--danger)' : tone === 'orange' ? 'var(--warning)' : 'var(--ink-2)';
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          aria-label="上下文占用"
          className="flex size-7 shrink-0 items-center justify-center rounded-control transition-colors duration-base hover:bg-hover"
          title="上下文占用"
          type="button"
        >
          <ProgressRing progress={(usage.percent ?? 0) / 100} size={18} tone={tone} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="center"
        aria-label="上下文占用"
        className="w-60 px-3 py-2.5"
        side="top"
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm font-medium text-ink">上下文</span>
          <span className="text-xs tabular-nums text-ink-3">
            {usage.tokens === null
              ? '—'
              : `${usage.estimated ? '约 ' : ''}${formatTokens(usage.tokens)}`}{' '}
            / {formatTokens(usage.contextWindow)}
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
          <span className="text-sm text-ink-2">缓存命中率</span>
          <span className="text-xs tabular-nums text-ink-3">{cacheHitRateText(usage)}</span>
        </div>
      </PopoverContent>
    </Popover>
  );
}
