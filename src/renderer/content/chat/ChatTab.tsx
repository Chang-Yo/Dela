import { useEffect, useState } from 'react';
import { History, SquarePen } from 'lucide-react';
import type { TabId } from '../../../shared/layout';
import { Button } from '../../components/ui/button';
import { ChatComposer } from './ChatComposer';
import { ChatSessions } from './ChatSessions';
import { ChatThread } from './ChatThread';
import { ModelKeyForm } from './ModelKeyForm';
import { useChatTabSource, type MailDraftDialog, type ReferenceSource } from './chat-source';
import { useChat, useChatSession, type ChatReference } from './use-chat';

/** 解析 chat:{sessionId} 标签键；无效载荷返回 null。 */
export function parseChatTabId(tabId: string): string | null {
  if (!tabId.startsWith('chat:')) return null;
  const sessionId = tabId.slice('chat:'.length);
  return sessionId || null;
}

/** 会话作为标签内容（AgentPanel 去面板化：无 aside、无宽度与开关逻辑）。
 *  会话身份来自 tabId（chat:{sessionId}）；引用候选、邮件草稿弹窗与项目归属经
 *  ChatTabSourceProvider 注入（3B 接线），未挂 Provider 时按通用池、无注入运行。 */
export function ChatTab({ tabId }: { tabId: TabId; groupId: string }) {
  const sessionId = parseChatTabId(tabId);
  const source = useChatTabSource();
  const session = useChatSession(source?.projectId ?? null, sessionId ?? '');

  // @ 引用候选：容器注入的数据源，视图挂载时读取一次；候选随打开文档变化的刷新由容器负责。
  const [referenceOptions, setReferenceOptions] = useState<ChatReference[]>([]);
  const referenceSource = source?.referenceSource;
  useEffect(() => {
    let active = true;
    if (!referenceSource) {
      setReferenceOptions([]);
      return;
    }
    void referenceSource
      .loadEntries()
      .then((entries) => {
        if (active) setReferenceOptions(entries);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [referenceSource]);

  if (sessionId === null) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
        无效的会话标签
      </div>
    );
  }
  if (session.active === null) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-muted">
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-sm text-muted-foreground">这个会话已被删除。</p>
          <Button onClick={() => void session.newSession()} size="sm" variant="outline">
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
      projectId={source?.projectId ?? null}
      referenceOptions={referenceOptions}
      referenceSource={referenceSource}
      session={session}
    />
  );
}

function ChatSessionView({
  session,
  active,
  projectId,
  referenceOptions,
  referenceSource,
  mailDialog,
  onOpenSource,
  onSaveNote,
}: {
  session: ReturnType<typeof useChatSession>;
  /** 已收窄为非 null 的当前会话（父组件处理删除后的空态）。 */
  active: string;
  projectId: string | null;
  referenceOptions: ChatReference[];
  referenceSource?: ReferenceSource;
  mailDialog?: MailDraftDialog;
  onOpenSource?: (key: string) => void;
  onSaveNote?: (text: string) => void;
}) {
  const chatState = useChat(active, referenceSource);
  const { chat, busy } = chatState;
  const [sessionsOpen, setSessionsOpen] = useState(false);

  // busy 涵盖「已发送但推送未到」的瞬间：点击发送立即进入会话态。
  // 不用 Boolean() 包裹，保留 TS 对 conversation 真值与 chat 非空的别名收窄。
  const conversation = chat && (busy || chat.messages.length > 0 || chat.running);

  return (
    <div aria-label="对话" className="flex min-h-0 min-w-0 flex-1 flex-col bg-muted">
      {/* 会话切换条：标签标题由 workbench 标签栏承载，这里只留历史与新对话入口。 */}
      <div className="flex h-10 shrink-0 items-center justify-end gap-1 px-3">
        <Button
          aria-label="历史对话"
          className="hover:bg-foreground/10"
          onClick={() => setSessionsOpen(true)}
          size="icon-xs"
          title="历史对话"
          type="button"
          variant="ghost"
        >
          <History />
        </Button>
        <Button
          aria-label="新对话"
          className="hover:bg-foreground/10"
          onClick={() => void session.newSession()}
          size="icon-xs"
          title="新对话"
          type="button"
          variant="ghost"
        >
          <SquarePen />
        </Button>
      </div>
      {/* chat 在 IPC 返回前为 null，需等它就位再判定，否则已配置用户每次进会话都闪现 Key 表单。 */}
      {chat && !chat.configured && <ModelKeyForm onConfigured={chatState.refresh} />}
      {conversation ? (
        <ChatThread
          chat={chat}
          mailDialog={mailDialog}
          onEditLast={(text) => void chatState.editLast(text)}
          onOpenSource={onOpenSource}
          onSaveNote={onSaveNote}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <p className="text-sm leading-relaxed text-muted-foreground">
            询问问题或整理思路，@ 引用资料，回答可以保存为笔记。
          </p>
        </div>
      )}
      <div className="shrink-0 p-3">
        <ChatComposer
          attachments={chatState.attachments}
          busy={busy}
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
          onSend={() => void chatState.send()}
          onStop={chatState.stop}
          referenceOptions={referenceOptions}
          references={chatState.references}
          value={chatState.prompt}
        />
        {(chatState.error ?? session.error) && (
          <p className="mt-2 break-words text-xs text-destructive" role="alert">
            {chatState.error ?? session.error}
          </p>
        )}
      </div>
      <ChatSessions
        currentSessionId={active}
        onDeleteSession={(id) => void session.deleteSession(id)}
        onOpenChange={setSessionsOpen}
        onOpenSession={session.openSession}
        open={sessionsOpen}
        projectId={projectId}
        side="right"
      />
    </div>
  );
}
