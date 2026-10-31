import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { GitCompare, History, MessageCircleQuestion, SquarePen } from 'lucide-react';
import type { TabId } from '../../../shared/layout';
import type { ChatComment, WorkspaceChat } from '../../../shared/api';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/beautifului/atoms/IconButton';
import { ChatComposer } from './ChatComposer';
import { composerContext } from './composer-context';
import { ChatSessions } from './ChatSessions';
import { ChatThread } from './ChatThread';
import { useChatTabSource, type MailDraftDialog, type ReferenceSource } from './chat-source';
import { useChat, useChatDraft, type ChatReference } from './use-chat';
import { referenceContext } from './reference-tokens';
import { useNavigationStore } from '../../navigation/view';
import { updateSession, useSessions } from '../../sessions/store';
import { errorText, useWorkspaceStore } from '../../workspace/store';
import { openTarget } from '../../workbench/open-target';
import { showToast } from '../../app/toasts';
import { reviewTabId } from '../review/tab-id';
import { SidechatPanel } from './SidechatPanel';
import { openSidechat, useSidechats } from './sidechat-store';

/** 解析 chat:{sessionId} 标签键；无效载荷返回 null。 */
export function parseChatTabId(tabId: string): string | null {
  if (!tabId.startsWith('chat:')) return null;
  const sessionId = tabId.slice('chat:'.length);
  return sessionId || null;
}

/** 会话作为标签内容。会话身份来自 tabId（chat:{sessionId}），项目归属来自会话快照；
 *  引用候选与邮件草稿弹窗经 ChatTabSourceProvider 注入。 */
export function ChatTab({ tabId }: { tabId: TabId; groupId: string }) {
  const sessionId = parseChatTabId(tabId);
  const source = useChatTabSource();
  const projectId = useSessions((state) =>
    sessionId ? (state.chats[sessionId]?.projectId ?? null) : null,
  );
  const referenceSource = source?.referenceSource;

  if (sessionId === null) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center p-6 text-center text-13 text-ink-3">
        无效的会话标签
      </div>
    );
  }
  return (
    <ChatSessionView
      key={sessionId}
      active={sessionId}
      mailDialog={source?.mailDialog}
      onOpenSource={source?.onOpenSource}
      onSaveNote={source?.onSaveNote}
      projectId={projectId}
      referenceSource={referenceSource}
    />
  );
}

/** 输入区容器：输入草稿（prompt）只在本层经 useChatDraft 订阅——打字每键仅重渲
 *  本层与 ChatComposer，不再带动 ChatSessionView 与 ChatThread 的整棵消息树；
 *  发送与失败恢复草稿仍由 useChat 在调用时读取，引用在发送前从文本解析。 */
function ChatComposerArea({
  chat,
  chatState,
  error,
  referenceSource,
  sessionId,
  hero = false,
}: {
  /** 会话快照；IPC 返回前为 null，模型信息按空值降级。 */
  chat: WorkspaceChat | null;
  chatState: ReturnType<typeof useChat>;
  /** 会话层错误（快照读取失败、发送失败）；null = 无。 */
  error: string | null;
  referenceSource?: ReferenceSource;
  sessionId: string;
  hero?: boolean;
}) {
  const { prompt, comments = noComments } = useChatDraft(sessionId);
  const referenceOptions = useReferenceOptions(referenceSource, chat);
  // 引用即文本：发送前从草稿文本解析 @token，附件与引用自此分开计数（附件维持上限 5）。
  const references = useMemo(
    () => referenceContext(prompt, referenceOptions),
    [prompt, referenceOptions],
  );
  // 新对话的项目浮岛：项目名来自工作区条目，通用池显示「随聊」；分支由浮岛自己查。
  const projectId = chat?.projectId ?? null;
  const project = useWorkspaceStore(
    (state) => state.workspace.entries.find((entry) => entry.id === projectId) ?? null,
  );
  const context = composerContext(chat, project, chatState.busy);
  return (
    <div className="mx-auto w-full max-w-3xl shrink-0 p-3">
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
        referenceOptions={referenceOptions}
        notice={error}
        onDismissNotice={chatState.clearError}
        sessionId={sessionId}
        value={prompt}
      />
    </div>
  );
}

const noReferences: ChatReference[] = [];
const noComments: ChatComment[] = [];
/** @ 候选：会话快照就位前（projectId/cwd 未知）不列候选，避免列出别的项目的文件。 */
function useReferenceOptions(source: ReferenceSource | undefined, chat: WorkspaceChat | null) {
  const options = source?.useEntries(chat?.projectId ?? null, chat?.cwd ?? null);
  return chat && options ? options : noReferences;
}

const ChatSessionView = memo(function ChatSessionView({
  active,
  projectId,
  referenceSource,
  mailDialog,
  onOpenSource,
  onSaveNote,
}: {
  active: string;
  projectId: string | null;
  referenceSource?: ReferenceSource;
  mailDialog?: MailDraftDialog;
  onOpenSource?: (key: string) => void;
  onSaveNote?: (text: string) => void;
}) {
  // 「新对话」按钮与 /new 命令同一个动作：首页里开一个新随聊，工作台里（项目或资料）就地在焦点组开。
  const startNewChat = useCallback(() => {
    if (useNavigationStore.getState().view === 'home')
      useNavigationStore.getState().openGeneralChat(true);
    else void useNavigationStore.getState().newChat(projectId);
  }, [projectId]);
  const chatState = useChat(active, referenceSource, startNewChat);
  const { chat, busy, editLast, fork } = chatState;
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const sidechatOpen = useSidechats((state) => Boolean(state.views[active]));
  const sidechatFromQuote = useCallback(
    (quote: string) => void openSidechat(active, { quote }),
    [active],
  );
  // 工作区改动入口的可见性：轻探测会话目录是否为可审阅的 Git 仓库
  // （非仓库、缺 Git、远程项目都不显示，随聊无项目目录同样不显示）。
  const [reviewReady, setReviewReady] = useState(false);
  useEffect(() => {
    if (projectId === null || !window.dela) {
      setReviewReady(false);
      return;
    }
    let alive = true;
    void window.dela.chat
      .uncommittedAvailability(active)
      .then((value) => {
        if (alive) setReviewReady(value.available);
      })
      .catch(() => {
        if (alive) setReviewReady(false);
      });
    return () => {
      alive = false;
    };
  }, [active, projectId]);

  // busy 涵盖「已发送但推送未到」的瞬间：点击发送立即进入会话态。
  // 不用 Boolean() 包裹，保留 TS 对 conversation 真值与 chat 非空的别名收窄。
  const conversation = chat && (busy || chat.messages.length > 0 || chat.running);

  const composer = (hero: boolean) => (
    <ChatComposerArea
      chat={chat}
      chatState={chatState}
      error={chatState.error}
      referenceSource={referenceSource}
      sessionId={active}
      hero={hero}
    />
  );

  return (
    <div
      aria-label="对话"
      className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-surface @container"
    >
      {/* @container 宿主：空态标题的 @max-[…] 按此宽度生效；ChatComposer 自身另有
          @container 宿主，其内部降级断点测量 composer 实宽（外层 p-3 会造成 24px 死区）。 */}
      {/* 会话切换条：标签标题由 workbench 标签栏承载，这里只留历史与新对话入口。 */}
      <div className="flex h-10 shrink-0 items-center gap-1 px-3">
        <IconButton aria-label="历史对话" onClick={() => setSessionsOpen(true)} title="历史对话">
          <History />
        </IconButton>
        <IconButton aria-label="新对话" onClick={startNewChat} title="新对话">
          <SquarePen />
        </IconButton>
        {reviewReady && (
          <IconButton
            aria-label="工作区改动"
            onClick={() =>
              openTarget(reviewTabId({ kind: 'uncommitted', sessionId: active }), { aside: true })
            }
            title="查看工作区未提交的改动"
          >
            <GitCompare />
          </IconButton>
        )}
        <div className="flex-1" />
        {conversation && !sidechatOpen && (
          <IconButton
            aria-label="旁问"
            onClick={() => void openSidechat(active)}
            title="旁问：带着当前对话顺便问一句（/btw）"
          >
            <MessageCircleQuestion />
          </IconButton>
        )}
      </div>
      {/* chat 在 IPC 返回前为 null，需等它就位再判定，否则已配置用户每次进会话都闪现 Key 表单。 */}
      {chat && !chat.configured && (
        <div className="flex items-center gap-2 px-3 text-xs text-ink-3">
          <span>配置模型供应商后即可开始对话</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => useNavigationStore.getState().openSettings('providers')}
          >
            配置模型
          </Button>
        </div>
      )}
      {conversation ? (
        <ChatThread
          chat={chat}
          mailDialog={mailDialog}
          onEditLast={editLast}
          onFork={fork}
          onSidechat={sidechatFromQuote}
          onOpenSource={onOpenSource}
          onSaveNote={onSaveNote}
        />
      ) : (
        // my-auto 而非 justify-center：内容高于容器（矮窗+大字号）时顶部仍可滚动到达。
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-10">
          <div className="my-auto">
            <h1 className="mb-6 text-center text-3xl font-semibold tracking-tight @max-[400px]:text-2xl">
              现在想聊些什么？
            </h1>
            {composer(true)}
          </div>
        </div>
      )}
      {conversation && composer(false)}
      {sidechatOpen && (
        <SidechatPanel
          onOpenSource={onOpenSource}
          parentId={active}
          referenceSource={referenceSource}
        />
      )}
      <ChatSessions
        currentSessionId={active}
        onDeleteSession={(id) => {
          void updateSession(id, { archived: true })
            .then(() => {
              const navigation = useNavigationStore.getState();
              if (navigation.view === 'home' && navigation.lastHomeSessionId === id)
                navigation.openGeneralChat(true);
            })
            .catch((error) => {
              showToast({ variant: 'error', title: '归档失败', description: errorText(error) });
            });
        }}
        onOpenChange={setSessionsOpen}
        onOpenSession={(id) => useNavigationStore.getState().openChat(id, projectId)}
        open={sessionsOpen}
        projectId={projectId}
      />
    </div>
  );
});
