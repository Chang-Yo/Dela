import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, GitCompare, History, MessageCircleQuestion, SquarePen } from 'lucide-react';
import type { ChatComment, ChatSessionSummary, WorkspaceChat } from '../../../core/protocol/agent';
import { chatClient } from './client';
import { Button } from '../../../ui/button';
import { cn } from '../../../ui/lib/cn';
import { SubagentBanner, type SubagentStatus } from '../../../ui/agent/subagent-banner';
import { ChatComposer } from './ChatComposer';
import { composerContext } from './composer-context';
import { ChatSessions } from './ChatSessions';
import { ChatThread } from './ChatThread';
import {
  NoReferenceEntries,
  useChatTabSource,
  type ReferenceEntry,
  type ReferenceSource,
} from './chat-source';
import { useChat, useChatDraft, type ChatReference } from './use-chat';
import { referenceContext, sessionReferences } from './reference-tokens';
import { poolKey, updateSession, useSessions } from './sessions';
import { useWorkspaceStore } from '../../workspace/view';
import { showToast } from '../../../ui/toast';
import { reviewTabId } from './review/tab-id';
import { SidechatPanel } from './SidechatPanel';
import { openSidechat, useSidechats } from './sidechat-store';
import { errorMessage } from '../../../core/protocol/contract';
import type { TabId } from '../../../core/protocol/workbench';

function parseChatTabId(tabId: string): string | null {
  if (!tabId.startsWith('chat:')) return null;
  const sessionId = tabId.slice('chat:'.length);
  return sessionId || null;
}

function subagentStatus(chat: WorkspaceChat): SubagentStatus {
  if (chat.running) return 'running';
  const last = chat.messages.at(-1);
  return last?.interrupted ? 'failed' : last?.stopped ? 'stopped' : 'completed';
}

export function ChatTab({ tabId, groupId }: { tabId: TabId; groupId: string }) {
  const sessionId = parseChatTabId(tabId);
  const source = useChatTabSource();
  const projectId = useSessions((state) =>
    sessionId ? (state.chats[sessionId]?.projectId ?? null) : null,
  );
  const referenceSource = source.referenceSource;

  if (sessionId === null) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center p-6 text-center text-sm text-ink-3">
        无效的会话标签
      </div>
    );
  }
  return (
    <ChatSessionView
      key={sessionId}
      active={sessionId}
      home={groupId === 'home'}
      onSaveNote={source.onSaveNote}
      projectId={projectId}
      referenceSource={referenceSource}
    />
  );
}

/** 输入草稿只在本层订阅：打字每键只重渲本层与 ChatComposer，不带动整棵消息树。 */
function ChatComposerArea({
  chat,
  chatState,
  error,
  files,
  sessionId,
  hero = false,
}: {
  /** 会话快照；IPC 返回前为 null，模型信息按空值降级。 */
  chat: WorkspaceChat | null;
  chatState: ReturnType<typeof useChat>;
  error: string | null;
  files: ReferenceEntry[];
  sessionId: string;
  hero?: boolean;
}) {
  const { prompt, comments = noComments } = useChatDraft(sessionId);
  const referenceOptions = useReferenceOptions(files, chat);
  // 引用即文本：发送前从草稿文本解析 @token，附件与引用自此分开计数（附件维持上限 5）。
  const references = referenceContext(prompt, referenceOptions);
  const projectId = chat?.projectId ?? null;
  const project = useWorkspaceStore(
    (state) => state.workspace.entries.find((entry) => entry.id === projectId) ?? null,
  );
  const context = composerContext(chat, project, chatState.busy);
  return (
    <div className={cn('mx-auto w-full shrink-0 p-3', hero ? 'max-w-3xl' : 'max-w-chat')}>
      <ChatComposer
        hero={hero}
        attachments={chatState.attachments}
        comments={comments}
        onCommentsChange={chatState.setComments}
        busy={chatState.busy}
        configured={Boolean(chat?.configured)}
        context={context}
        effort={chat?.effort ?? null}
        effortLevels={chat?.effortLevels ?? []}
        model={chat?.model ?? ''}
        modelUnavailable={chat?.modelUnavailable ?? false}
        providerId={chat?.providerId ?? null}
        onAddAttachmentFile={chatState.addAttachmentFile}
        onAddAttachmentView={chatState.addAttachmentView}
        onChange={chatState.setPrompt}
        onEffortSelect={chatState.selectEffort}
        onModelSelect={chatState.selectModel}
        onRemoveAttachment={chatState.removeAttachment}
        contextUsage={chat?.contextUsage ?? null}
        onSend={() => void chatState.send(references)}
        onStop={chatState.stop}
        queued={chat?.queued}
        onWithdrawQueued={chatState.withdrawQueued}
        tasks={chat?.tasks}
        onStopTask={chatState.stopTask}
        referenceOptions={referenceOptions}
        notice={error}
        onDismissNotice={chatState.clearError}
        value={prompt}
      />
    </div>
  );
}

const noReferences: ChatReference[] = [];
const noSessions: ChatSessionSummary[] = [];
const noComments: ChatComment[] = [];
/** @ 候选：会话快照就位前（projectId/cwd 未知）不列候选，避免列出别的项目的文件。 */
/** @ 文件候选来自容器注入；# 会话候选是同池的其他会话（各池列表启动时已载入镜像）。 */
function useReferenceOptions(files: ReferenceEntry[], chat: WorkspaceChat | null) {
  const projectId = chat?.projectId ?? null;
  const sessions = useSessions((state) => state.lists[poolKey(projectId)]);
  const sessionId = chat?.sessionId ?? null;
  const ready = chat !== null;
  return ready ? [...files, ...sessionReferences(sessions ?? noSessions, sessionId)] : noReferences;
}

function ChatSessionView({
  active,
  projectId,
  referenceSource,
  home,
  onSaveNote,
}: {
  active: string;
  projectId: string | null;
  referenceSource?: ReferenceSource;
  home: boolean;
  onSaveNote?: (text: string) => void;
}) {
  const { navigate, workbench } = useChatTabSource();
  const onOpenSource = (key: string) => workbench.openDocument(key);
  const startNewChat = () => navigate({ page: 'chat', projectId });
  const openSession = (id: string) => navigate({ page: 'chat', projectId, sessionId: id });
  const chatState = useChat(active, referenceSource, startNewChat);
  const { chat, busy, editLast, fork } = chatState;
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const sidechatOpen = useSidechats((state) => Boolean(state.views[active]));
  const sidechatFromQuote = (quote: string) => void openSidechat(active, { quote });
  // 工作区改动入口的可见性：轻探测会话目录是否为可审阅的 Git 仓库
  // （非仓库、缺 Git、远程项目都不显示，随聊无项目目录同样不显示）。
  const { data: reviewReady = false } = useQuery({
    queryKey: ['chat-uncommitted-availability', active, projectId],
    enabled: projectId !== null && Boolean(window.dela),
    staleTime: Infinity,
    gcTime: 0,
    queryFn: () =>
      chatClient
        .uncommittedAvailability(active)
        .then((value) => value.available)
        .catch(() => false),
  });

  // busy 涵盖「已发送但推送未到」的瞬间：点击发送立即进入会话态。
  // 不用 Boolean() 包裹，保留 TS 对 conversation 真值与 chat 非空的别名收窄。
  // 子 Agent 的会话只读：没有输入框，不能编辑重发、分支或旁问。
  const subagent = chat?.subagent;
  const conversation = chat && (busy || chat.messages.length > 0 || chat.running || subagent);

  const saveConversation = async () => {
    if (!window.dela) return;
    setExporting(true);
    const exportSession = async () => {
      const { saved, missing } = await chatClient.export(active);
      if (saved)
        showToast({
          variant: missing.length ? 'neutral' : 'success',
          title: missing.length ? '会话已导出，部分文件未打包' : '会话已导出',
          description: missing.length ? missing.join('、') : undefined,
        });
    };
    try {
      await exportSession();
    } catch (error) {
      showToast({ variant: 'error', title: '会话导出失败', description: errorMessage(error) });
    }
    setExporting(false);
  };

  const ReferenceEntries = referenceSource?.Entries ?? NoReferenceEntries;
  const withReferences = (render: (files: ReferenceEntry[]) => ReactNode) => (
    <ReferenceEntries projectId={chat?.projectId ?? null} cwd={chat?.cwd ?? null}>
      {render}
    </ReferenceEntries>
  );
  const composer = (hero: boolean) =>
    withReferences((files) => (
      <ChatComposerArea
        chat={chat}
        chatState={chatState}
        error={chatState.error}
        files={files}
        sessionId={active}
        hero={hero}
      />
    ));

  return (
    <div
      aria-label="对话"
      className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-surface @container"
    >
      <div className="flex h-10 shrink-0 items-center gap-1 px-3">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="历史对话"
          onClick={() => setSessionsOpen(true)}
          title="历史对话"
        >
          <History />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="新对话"
          onClick={startNewChat}
          title="新对话"
        >
          <SquarePen />
        </Button>
        {reviewReady && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="工作区改动"
            onClick={() =>
              workbench.open(reviewTabId({ kind: 'uncommitted', sessionId: active }), {
                aside: true,
              })
            }
            title="查看工作区未提交的改动"
          >
            <GitCompare />
          </Button>
        )}
        <div className="flex-1" />
        {chat && chat.messages.length > 0 && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="导出会话"
            disabled={busy || chat.running || chat.compacting || exporting}
            onClick={() => void saveConversation()}
            title="导出会话 ZIP"
          >
            <Download />
          </Button>
        )}
        {conversation && !sidechatOpen && !subagent && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="旁问"
            onClick={() => void openSidechat(active)}
            title="旁问：带着当前对话顺便问一句（/btw）"
          >
            <MessageCircleQuestion />
          </Button>
        )}
      </div>
      {subagent && (
        <SubagentBanner
          backLabel="父会话"
          className="mx-auto w-full max-w-chat shrink-0 px-4 pb-1"
          onBack={() => openSession(subagent.parentId)}
          onStop={chatState.stop}
          status={subagentStatus(chat)}
          title={subagent.description}
        />
      )}
      {/* chat 在 IPC 返回前为 null，需等它就位再判定，否则已配置用户每次进会话都闪现 Key 表单。 */}
      {chat && !chat.configured && (
        <div className="flex items-center gap-2 px-3 text-xs text-ink-3">
          <span>配置模型服务后即可开始对话</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => navigate({ page: 'settings', section: 'providers' })}
          >
            配置模型
          </Button>
        </div>
      )}
      {conversation ? (
        <ChatThread
          chat={chat}
          onEditLast={subagent ? undefined : editLast}
          onFork={subagent ? undefined : fork}
          onSidechat={subagent ? undefined : sidechatFromQuote}
          onOpenSource={onOpenSource}
          onOpenSession={openSession}
          onSaveNote={onSaveNote}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-10">
          <div className="my-auto">
            <h1 className="mb-6 text-center text-3xl font-semibold tracking-tight @max-[400px]:text-2xl">
              现在想聊些什么？
            </h1>
            {composer(true)}
          </div>
        </div>
      )}
      {conversation && !subagent && composer(false)}
      {sidechatOpen &&
        withReferences((files) => (
          <SidechatPanel
            onOpenSource={onOpenSource}
            parentId={active}
            files={files}
            flushReference={referenceSource?.flushReference}
          />
        ))}
      <ChatSessions
        currentSessionId={active}
        onDeleteSession={(id) => {
          void updateSession(id, { archived: true })
            .then(() => {
              workbench.close(`chat:${id}`);
              if (home && useSessions.getState().homeSessionId === id)
                navigate({ page: 'chat', projectId: null });
            })
            .catch((error) => {
              showToast({ variant: 'error', title: '归档失败', description: errorMessage(error) });
            });
        }}
        onOpenChange={setSessionsOpen}
        onOpenSession={openSession}
        open={sessionsOpen}
        projectId={projectId}
      />
    </div>
  );
}
