import { memo, useState } from 'react';
import { History, SquarePen } from 'lucide-react';
import type { TabId } from '../../../shared/layout';
import type { WorkspaceChat } from '../../../shared/api';
import { Button } from '@/components/ui/beautifului/atoms/Button';
import { IconButton } from '@/components/ui/beautifului/atoms/IconButton';
import { ChatComposer } from './ChatComposer';
import { ChatSessions } from './ChatSessions';
import { ChatThread } from './ChatThread';
import { useChatTabSource, type MailDraftDialog, type ReferenceSource } from './chat-source';
import { useChat, useChatDraft, useChatSession, type ChatReference } from './use-chat';
import { useNavigationStore } from '../../app/navigation';
import { useSessions } from '../../sessions/store';

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
  const session = useChatSession(projectId, sessionId ?? '');
  const referenceSource = source?.referenceSource;

  if (sessionId === null) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center p-6 text-center text-[13px] text-ink-3">
        无效的会话标签
      </div>
    );
  }
  if (session.active === null) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface">
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-[13px] text-ink-3">这个会话已被删除。</p>
          <Button
            className="[&_svg]:size-3.5"
            onClick={() => void session.newSession()}
            size="sm"
            variant="secondary"
          >
            <SquarePen />
            新对话
          </Button>
        </div>
      </div>
    );
  }
  return (
    <ChatSessionView
      active={session.active}
      mailDialog={source?.mailDialog}
      onOpenSource={source?.onOpenSource}
      onSaveNote={source?.onSaveNote}
      projectId={projectId}
      referenceSource={referenceSource}
      session={session}
    />
  );
}

/** 输入区容器：输入草稿（prompt/引用）只在本层经 useChatDraft 订阅——打字每键仅重渲
 *  本层与 ChatComposer，不再带动 ChatSessionView 与 ChatThread 的整棵消息树；
 *  发送与失败恢复草稿仍由 useChat 在调用时读取，行为不变。 */
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
  /** 发送错误与会话级错误的合并展示；null = 无。 */
  error: string | null;
  referenceSource?: ReferenceSource;
  sessionId: string;
  hero?: boolean;
}) {
  const { prompt, references } = useChatDraft(sessionId);
  const referenceOptions = useReferenceOptions(referenceSource, chat);
  return (
    <div className="mx-auto w-full max-w-3xl shrink-0 p-3">
      <ChatComposer
        hero={hero}
        attachments={chatState.attachments}
        busy={chatState.busy}
        configured={Boolean(chat?.configured)}
        effort={chat?.effort ?? null}
        effortLevels={chat?.effortLevels ?? []}
        model={chat?.model ?? ''}
        onAddAttachmentFile={chatState.addAttachmentFile}
        onAddAttachmentView={chatState.addAttachmentView}
        onAddReference={chatState.addReference}
        onChange={chatState.setPrompt}
        onEffortSelect={chatState.selectEffort}
        onModelSelect={chatState.selectModel}
        onRemoveAttachment={chatState.removeAttachment}
        onRemoveReference={chatState.removeReference}
        contextUsage={chat?.contextUsage ?? null}
        onSend={() => void chatState.send()}
        onStop={chatState.stop}
        referenceOptions={referenceOptions}
        references={references}
        notice={error}
        onDismissNotice={chatState.clearError}
        value={prompt}
      />
    </div>
  );
}

const noReferences: ChatReference[] = [];
/** @ 候选：会话快照就位前（projectId/cwd 未知）不列候选，避免列出别的项目的文件。 */
function useReferenceOptions(source: ReferenceSource | undefined, chat: WorkspaceChat | null) {
  const options = source?.useEntries(chat?.projectId ?? null, chat?.cwd ?? null);
  return chat && options ? options : noReferences;
}

const ChatSessionView = memo(function ChatSessionView({
  session,
  active,
  projectId,
  referenceSource,
  mailDialog,
  onOpenSource,
  onSaveNote,
}: {
  session: ReturnType<typeof useChatSession>;
  /** 已收窄为非 null 的当前会话（父组件处理删除后的空态）。 */
  active: string;
  projectId: string | null;
  referenceSource?: ReferenceSource;
  mailDialog?: MailDraftDialog;
  onOpenSource?: (key: string) => void;
  onSaveNote?: (text: string) => void;
}) {
  const chatState = useChat(active, referenceSource);
  const { chat, busy, editLast } = chatState;
  const [sessionsOpen, setSessionsOpen] = useState(false);

  // busy 涵盖「已发送但推送未到」的瞬间：点击发送立即进入会话态。
  // 不用 Boolean() 包裹，保留 TS 对 conversation 真值与 chat 非空的别名收窄。
  const conversation = chat && (busy || chat.messages.length > 0 || chat.running);

  const composer = (hero: boolean) => (
    <ChatComposerArea
      chat={chat}
      chatState={chatState}
      error={chatState.error ?? session.error}
      referenceSource={referenceSource}
      sessionId={active}
      hero={hero}
    />
  );

  return (
    <div aria-label="对话" className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface @container">
      {/* @container 宿主：空态标题的 @max-[…] 按此宽度生效；ChatComposer 自身另有
          @container 宿主，其内部降级断点测量 composer 实宽（外层 p-3 会造成 24px 死区）。 */}
      {/* 会话切换条：标签标题由 workbench 标签栏承载，这里只留历史与新对话入口。 */}
      <div className="flex h-10 shrink-0 items-center gap-1 px-3">
        <IconButton aria-label="历史对话" onClick={() => setSessionsOpen(true)} title="历史对话">
          <History />
        </IconButton>
        <IconButton
          aria-label="新对话"
          onClick={() =>
            projectId === null
              ? useNavigationStore.getState().openGeneralChat(true)
              : void useNavigationStore.getState().newChat(projectId)
          }
          title="新对话"
        >
          <SquarePen />
        </IconButton>
      </div>
      {/* chat 在 IPC 返回前为 null，需等它就位再判定，否则已配置用户每次进会话都闪现 Key 表单。 */}
      {chat && !chat.configured && (
        <div className="flex items-center gap-2 px-3 text-[12px] text-ink-3">
          <span>配置模型供应商后即可开始对话</span>
          <Button
            size="xs"
            variant="quiet"
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
      <ChatSessions
        currentSessionId={active}
        onDeleteSession={(id) => void session.deleteSession(id)}
        onOpenChange={setSessionsOpen}
        onOpenSession={(id) => useNavigationStore.getState().openChat(id, projectId)}
        open={sessionsOpen}
        projectId={projectId}
      />
    </div>
  );
});
