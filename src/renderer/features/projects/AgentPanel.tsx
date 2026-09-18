import { useMemo, useState } from 'react';
import { History, SquarePen } from 'lucide-react';
import { PanelToggleButton } from '../../components/ui/panel-toggle';
import { Button } from '../../components/ui/button';
import { useWorkspace } from './workspace';
import {
  ChatComposer,
  ChatSessions,
  ChatThread,
  ModelKeyForm,
  useChat,
  type ChatReference,
} from '../chat';

/** 项目页右栏助手：共享对话核心的面板形态。 */
export function AgentPanel({
  scope,
  tabs,
  onCollapse,
  onSaveNote,
  onOpen,
}: {
  scope: string;
  tabs: string[];
  onCollapse?: () => void;
  onSaveNote: (text: string) => void;
  onOpen: (key: string) => void;
}) {
  const chatState = useChat(scope);
  const { chat, busy, error } = chatState;
  const drafts = useWorkspace((s) => s.drafts);
  const entries = useWorkspace((s) => s.workspace.entries);
  const [sessionsOpen, setSessionsOpen] = useState(false);

  // @ 引用候选：当前打开的文档优先，其余可读条目（笔记/导入副本/Canvas 引用）按名搜索。
  const referenceOptions = useMemo<ChatReference[]>(() => {
    const options: ChatReference[] = [];
    for (const id of tabs) {
      const title = drafts[id]?.content.title;
      if (title) options.push({ key: id, title });
    }
    for (const entry of entries) {
      if (
        (entry.kind === 'note' || entry.kind === 'imported' || entry.kind === 'source') &&
        !tabs.includes(entry.id)
      )
        options.push({ key: entry.id, title: entry.name });
    }
    return options;
  }, [drafts, entries, tabs]);

  // busy 涵盖「已发送但推送未到」的瞬间：点击发送立即进入会话态。
  // 不用 Boolean() 包裹，保留 TS 对 conversation 真值与 chat 非空的别名收窄。
  const conversation = chat && (busy || chat.messages.length > 0 || chat.running);

  return (
    <aside
      id="workspace-agent"
      aria-label="学习生活助手"
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-muted/40"
    >
      <div className="flex h-11 shrink-0 items-center gap-1 border-b px-3">
        <strong className="flex-1 text-xs font-medium">助手</strong>
        <Button
          aria-label="历史对话"
          onClick={() => setSessionsOpen(true)}
          size="icon-sm"
          title="历史对话"
          type="button"
          variant="ghost"
        >
          <History />
        </Button>
        <Button
          aria-label="新对话"
          disabled={busy}
          onClick={chatState.newChat}
          size="icon-sm"
          title="新对话"
          type="button"
          variant="ghost"
        >
          <SquarePen />
        </Button>
        {onCollapse && (
          <PanelToggleButton
            collapsed={false}
            controlsId="workspace-agent"
            label="助手"
            side="right"
            onToggle={onCollapse}
          />
        )}
      </div>
      {!chat?.configured && <ModelKeyForm onConfigured={chatState.refresh} />}
      {conversation ? (
        <ChatThread chat={chat} onOpenSource={onOpen} onSaveNote={onSaveNote} />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <p className="text-sm leading-relaxed text-muted-foreground">
            询问问题或整理思路，@ 引用资料，回答可以保存为笔记。
          </p>
        </div>
      )}
      <div className="shrink-0 border-t p-3">
        <ChatComposer
          attachments={chatState.attachments}
          busy={busy}
          configured={Boolean(chat?.configured)}
          model={chat?.model ?? ''}
          onAddAttachmentFile={chatState.addAttachmentFile}
          onAddAttachmentView={chatState.addAttachmentView}
          onAddReference={chatState.addReference}
          onChange={chatState.setPrompt}
          onModelSelect={chatState.selectModel}
          onRemoveAttachment={chatState.removeAttachment}
          onRemoveReference={chatState.removeReference}
          onSend={() => void chatState.send()}
          onStop={chatState.stop}
          referenceOptions={referenceOptions}
          references={chatState.references}
          value={chatState.prompt}
        />
        {error && (
          <p className="mt-2 text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          对话、引用资料及工具读取的内容会提供给{chat?.providerName ?? '模型服务'}。
        </p>
      </div>
      <ChatSessions
        currentSessionId={chat?.sessionId ?? null}
        listSessions={chatState.listSessions}
        onDeleteSession={chatState.deleteSession}
        onOpenChange={setSessionsOpen}
        onOpenSession={chatState.openSession}
        open={sessionsOpen}
        scope={scope}
      />
    </aside>
  );
}
