import { useEffect, useId, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AtSign,
  Bot,
  ChevronDown,
  FileText,
  Globe,
  MessageSquare,
  Paperclip,
  Sparkles,
} from 'lucide-react';
import { cn } from '../../../ui/lib/cn';
import type { ComposerContext } from './composer-context';
import { ComposerContextBar } from './composer-context-bar';
import { ReplyCommentRail } from './reply-comment';
import { formatDuration } from './format-duration';
import { openSubagent } from './tool-views';
import { BackgroundTasks } from '../../../ui/agent/background-tasks';
import { ContextIndicator } from '../../../ui/agent/context-indicator';
import {
  PromptInput,
  PromptInputAttachments,
  PromptInputChip,
  PromptInputMenu,
  PromptInputMenuItem,
  PromptInputNotice,
  PromptInputOption,
  PromptInputOptionCheck,
  PromptInputOptionList,
  PromptInputSetup,
  PromptInputSubmit,
  PromptInputToolbar,
  PromptInputTrigger,
} from '../../../ui/agent/prompt-input';
import { QueuedMessages } from '../../../ui/agent/queued-messages';
import { Button } from '../../../ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../../../ui/popover';
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

/** 本会话累计缓存命中率 = cacheRead / (输入 + cacheRead)。main 没给出缓存字段（提供商不上报
 *  缓存）或分母为 0 时显示 —：写成 0% 会把「没有数据」说成「一次都没命中」。 */
export function cacheHitRateText(usage: ContextUsageView): string {
  const { inputTokens, cachedTokens } = usage;
  if (inputTokens === undefined || cachedTokens === undefined) return '—';
  const total = inputTokens + cachedTokens;
  return total > 0 ? `${((cachedTokens / total) * 100).toFixed(1)}%` : '—';
}

const webSearchOptionsKey = ['capabilities', 'webSearchOptions'];

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
  tasks?: BackgroundTaskView[];
  onStopTask?: (taskId: string) => void;
  /** 旁问输入框：模型与思考强度沿用主会话、联网搜索是全局开关，这三个选择器都不显示。 */
  sidechat?: boolean;
  /** 新对话的项目浮岛数据；null = 不显示（已有历史或通用池没有项目）。 */
  context?: ComposerContext | null;
  notice?: string | null;
  onDismissNotice?: () => void;
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  busy: boolean;
  configured: boolean;
  providerId?: string | null;
  model: string;
  /** 会话的模型已停用或被移除：禁止发送，提示另选。 */
  modelUnavailable?: boolean;
  onModelSelect: (provider: LlmProviderView, model: string) => void;
  /** 当前推理强度档位；未配置时为 null，显示「默认」并提供设置入口。 */
  effort: string | null;
  effortLevels: string[];
  onEffortSelect: (level: string) => void;
  referenceOptions: ChatReference[];
  attachments: ChatMediaView[];
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
  // 菜单 id 逐实例唯一：同页可同时挂多个会话的 composer。
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
    queryKey: ['llm', 'list'],
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
      {context && <ComposerContextBar context={context} />}
      {queued.length > 0 && (
        <QueuedMessages
          messages={queued.map((text) => text.trim() || '图片或附件')}
          onWithdraw={onWithdrawQueued}
        />
      )}
      {(fileError ?? notice) && (
        <PromptInputNotice
          message={(fileError ?? notice)!}
          onDismiss={fileError ? () => setFileError(null) : onDismissNotice}
        />
      )}
      <PromptInput
        dragging={dragging}
        dropHint="松开以添加图片或附件"
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
        {(comments.length > 0 || attachments.length > 0) && (
          <PromptInputAttachments>
            {comments.length > 0 && (
              <ReplyCommentRail comments={comments} onChange={onCommentsChange} />
            )}
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {attachments.map((item) => (
                  <PromptInputChip
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
          </PromptInputAttachments>
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
        <PromptInputToolbar>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="添加图片或附件"
            onClick={pickFiles}
            title="添加图片或附件"
          >
            <Paperclip />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="引用资料"
            onClick={insertMention}
            title="引用资料（@）"
          >
            <AtSign />
          </Button>
          {!sidechat && (
            <Popover onOpenChange={openSearchPicker} open={searchPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={
                    selectedSearch ? `联网搜索：${selectedSearch.name}` : '联网搜索：未开启'
                  }
                  title={selectedSearch ? `联网搜索：${selectedSearch.name}` : '联网搜索：未开启'}
                >
                  <Globe className={selectedSearch ? 'text-success' : undefined} />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-64" side="bottom">
                {searchEntries === null ? (
                  <p className="px-2 py-3 text-xs text-ink-3">
                    {searchFailed ? '搜索配置加载失败' : '正在加载搜索配置…'}
                  </p>
                ) : searchEntries.length === 0 ? (
                  <PromptInputSetup
                    actionLabel="打开设置 › 内置能力"
                    message="还没有搜索服务配置，可在设置 › 内置能力 的「网络」分组中添加。"
                    onAction={() => {
                      setSearchPickerOpen(false);
                      navigate({ page: 'settings', section: 'capabilities' });
                    }}
                  />
                ) : (
                  <PromptInputOptionList aria-label="联网搜索">
                    <PromptInputOption
                      active={searchSelectedId === null}
                      className="gap-2"
                      onClick={() => void selectSearchEntry(null)}
                    >
                      <span className="truncate">关闭</span>
                      {searchSelectedId === null && <PromptInputOptionCheck />}
                    </PromptInputOption>
                    {searchEntries.map((entry) => (
                      <PromptInputOption
                        active={entry.id === searchSelectedId}
                        className="gap-2"
                        key={entry.id}
                        onClick={() => void selectSearchEntry(entry.id)}
                      >
                        <span className="truncate">{entry.name}</span>
                        {entry.provider === 'deepseek' && (
                          <span className="shrink-0 text-xs text-ink-3">按次计费</span>
                        )}
                        {entry.id === searchSelectedId && <PromptInputOptionCheck />}
                      </PromptInputOption>
                    ))}
                  </PromptInputOptionList>
                )}
              </PopoverContent>
            </Popover>
          )}
          <div className="flex-1" />
          {tasks.length > 0 && onStopTask && (
            <BackgroundTasks
              formatElapsed={formatDuration}
              onOpenSubagent={(taskId) => void openSubagent(taskId, navigate)}
              onStop={onStopTask}
              tasks={tasks}
            />
          )}
          {configured && contextUsage && (
            <ContextIndicator
              cacheHitLabel="缓存命中率"
              cacheHitRate={cacheHitRateText(contextUsage)}
              usage={contextUsage}
            />
          )}
          {configured && !sidechat && (
            <Popover onOpenChange={openModelPicker} open={modelPickerOpen}>
              <PopoverTrigger asChild>
                <PromptInputTrigger
                  aria-label="模型服务"
                  className={cn(
                    '@max-[220px]:px-1.5',
                    modelUnavailable && 'text-danger hover:text-danger',
                  )}
                  title={modelUnavailable ? `${model}（已停用或被移除，请另选模型）` : model}
                >
                  <span className="truncate @max-[220px]:hidden">
                    {modelUnavailable ? `${model} · 已停用` : model}
                  </span>
                  <Bot className="hidden size-4 @max-[220px]:block" />
                  <ChevronDown className="size-3 @max-[220px]:hidden" />
                </PromptInputTrigger>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80" side="bottom">
                {providers === null ? (
                  providersFailed ? (
                    <p className="px-2 py-3 text-xs text-ink-3">模型列表加载失败</p>
                  ) : (
                    <p className="px-2 py-3 text-xs text-ink-3">正在加载模型列表…</p>
                  )
                ) : providers.length === 0 ? (
                  <PromptInputSetup
                    actionLabel="打开设置 › 模型服务"
                    message="还没有启用的模型供应商，可在设置 › 模型服务 中添加或启用。"
                    onAction={() => {
                      setModelPickerOpen(false);
                      navigate({ page: 'settings', section: 'providers' });
                    }}
                  />
                ) : (
                  <div className="flex gap-0.5">
                    <PromptInputOptionList
                      aria-label="模型服务"
                      className="max-h-64 w-28 shrink-0 overflow-y-auto"
                    >
                      {providers.map((provider) => (
                        <PromptInputOption
                          active={provider.id === focused?.id}
                          key={provider.id}
                          onClick={() => setFocusedId(provider.id)}
                        >
                          <span className="truncate">{provider.name}</span>
                          {provider.id === providerId && (
                            <span
                              aria-label="本会话使用"
                              className="ms-auto size-1.5 shrink-0 rounded-full bg-success"
                              title="本会话使用"
                            />
                          )}
                        </PromptInputOption>
                      ))}
                    </PromptInputOptionList>
                    <PromptInputOptionList
                      aria-label="模型"
                      className="max-h-64 min-w-0 flex-1 overflow-y-auto border-l border-line pl-1.5"
                    >
                      {focused?.models.map((item) => (
                        <PromptInputOption
                          active={focused.id === providerId && model === item}
                          key={item}
                          onClick={() => {
                            setModelPickerOpen(false);
                            onModelSelect(focused, item);
                          }}
                        >
                          <span className="truncate">{item}</span>
                          {focused.id === providerId && model === item && (
                            <PromptInputOptionCheck />
                          )}
                        </PromptInputOption>
                      ))}
                    </PromptInputOptionList>
                  </div>
                )}
              </PopoverContent>
            </Popover>
          )}
          {configured && !sidechat && (
            <Popover onOpenChange={setEffortPickerOpen} open={effortPickerOpen}>
              <PopoverTrigger asChild>
                <PromptInputTrigger
                  aria-label="思考强度"
                  className="@max-[260px]:px-1.5 @max-[160px]:hidden"
                  title="思考强度"
                >
                  <span className="truncate @max-[260px]:hidden">{effort ?? '默认'}</span>
                  <Sparkles className="hidden size-4 @max-[260px]:block" />
                  <ChevronDown className="size-3 @max-[260px]:hidden" />
                </PromptInputTrigger>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className={effortLevels.length ? 'w-32' : 'w-80'}
                side="bottom"
              >
                {effortLevels.length === 0 ? (
                  <PromptInputSetup
                    actionLabel="打开设置 › 模型服务"
                    message="当前模型尚未配置可选的思考强度档位。在设置中编辑当前模型，勾选其支持的档位并保存。"
                    onAction={() => {
                      setEffortPickerOpen(false);
                      navigate({ page: 'settings', section: 'providers' });
                    }}
                  />
                ) : (
                  <PromptInputOptionList aria-label="思考强度">
                    {effortLevels.map((level) => (
                      <PromptInputOption
                        active={level === effort}
                        key={level}
                        onClick={() => {
                          setEffortPickerOpen(false);
                          onEffortSelect(level);
                        }}
                      >
                        <span className="truncate">{level}</span>
                        {level === effort && <PromptInputOptionCheck />}
                      </PromptInputOption>
                    ))}
                  </PromptInputOptionList>
                )}
              </PopoverContent>
            </Popover>
          )}
          <PromptInputSubmit
            onSend={onSend}
            onStop={onStop}
            sendable={sendable}
            sendTitle={modelUnavailable ? '这个会话的模型已停用，请先另选模型' : '发送'}
            stoppable={stoppable}
          />
        </PromptInputToolbar>
        {menuOpen && (
          <PromptInputMenu activeIndex={index} id={menuListId} itemCount={items.length}>
            {items.map((item, position) => (
              <PromptInputMenuItem
                icon={
                  menu?.kind === 'mention' ? (
                    <FileText className="size-3.5 shrink-0 text-ink-3" />
                  ) : menu?.kind === 'session' ? (
                    <MessageSquare className="size-3.5 shrink-0 text-ink-3" />
                  ) : (
                    <span className="shrink-0 font-mono text-sm text-ink-3">/</span>
                  )
                }
                id={menuOptionId(position)}
                key={'name' in item ? item.name : item.key}
                onHover={() => setIndex(position)}
                onSelect={() => handleSelect(position)}
                selected={position === index}
              >
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
              </PromptInputMenuItem>
            ))}
          </PromptInputMenu>
        )}
      </PromptInput>
    </div>
  );
}

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
