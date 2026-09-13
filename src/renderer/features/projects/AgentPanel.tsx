import { leaveComposer } from '../mail/compose-close';
import { useEffect, useRef, useState } from 'react';
import { ArrowUp, LoaderCircle, Settings2, Square } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Dialog } from 'radix-ui';
import type { PreparedEmail, WorkspaceChat } from '../../../shared/api';
import { MailComposer } from '../mail/MailComposer';
import { PanelToggleButton } from '../../components/ui/panel-toggle';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { errorText, useWorkspace } from './workspace';

const toolLabels: Record<string, string> = {
  prepare_email: '准备邮件草稿',
  query_schedule: '查询日程',
  query_assignments: '查询作业',
  find_courses: '查找课程',
  sync_sources: '同步课程资料',
  search_sources: '查找资料',
  search_workspace: '查找项目文件',
  search_mail: '查找邮件',
  read_resource: '读取资料',
  create_entry: '创建条目',
  update_entry: '整理条目',
  write_note: '保存笔记',
  link_source: '关联资料',
  copy_file_to_project: '复制文件',
  create_event: '创建日程',
};

export function AgentPanel({
  scope,
  tabs,
  title,
  onCollapse,
  onSaveNote,
  onOpen,
  home = false,
}: {
  scope: string;
  tabs: string[];
  title: (key: string) => string;
  onCollapse?: () => void;
  onSaveNote: (text: string) => void;
  onOpen: (key: string) => void;
  home?: boolean;
}) {
  const [chat, setChat] = useState<WorkspaceChat | null>(null);
  const [prompt, setPrompt] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [key, setKey] = useState('');
  const [model, setModel] = useState('qwen');
  const [settings, setSettings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const drafts = useWorkspace((s) => s.drafts);
  const activeScope = useRef(scope);
  const [email, setEmail] = useState<{ draft: PreparedEmail; address: string } | null>(null);
  const [openingEmail, setOpeningEmail] = useState(false);
  const openEmail = async (id: string) => {
    if (!window.dela || openingEmail) return;
    setOpeningEmail(true);
    try {
      const state = await window.dela.mail.getState();
      if (!state.account) throw new Error('请先在邮箱页面配置账号');
      const draft = await window.dela.mail.openDraft(id);
      setEmail({ draft, address: state.account.address });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setOpeningEmail(false);
    }
  };
  const closeEmail = () => {
    if (!leaveComposer(() => setEmail(null))) return;
    setEmail(null);
  };
  useEffect(() => {
    activeScope.current = scope;
    setChat(null);
    setSelected([]);
    setPrompt('');
    setError(null);
    setBusy(false);
    let active = true;
    void window.dela?.workspace
      .getChat(scope)
      .then((value) => {
        if (active) {
          setChat(value);
          setBusy(Boolean(value.running));
          setModel(value.model);
        }
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      });
    const unsubscribe = window.dela?.workspace.onChatUpdate((updatedScope, value) => {
      if (!active || updatedScope !== scope) return;
      setChat(value);
      setBusy(Boolean(value.running));
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [scope]);
  const send = async () => {
    if (!window.dela || !prompt.trim() || busy) return;
    setBusy(true);
    setError(null);
    const requestedScope = scope;
    try {
      const context = selected.filter((id) => tabs.includes(id));
      for (const id of context) {
        await useWorkspace.getState().save(id);
        const draft = useWorkspace.getState().drafts[id];
        if (draft && draft.text !== draft.saved)
          throw new Error('所选笔记尚未保存成功，请先保存或移除该引用');
      }
      const result = await window.dela.workspace.ask(scope, prompt, context);
      if (activeScope.current === requestedScope) {
        setChat(result);
        setPrompt('');
      }
    } catch (e) {
      if (activeScope.current === requestedScope) setError(errorText(e));
    } finally {
      if (activeScope.current === requestedScope) setBusy(false);
    }
  };
  return (
    <aside
      id="workspace-agent"
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-muted/40"
      aria-label="学习生活助手"
    >
      <div className="flex h-11 shrink-0 items-center gap-1 border-b px-3">
        <strong className="flex-1 text-xs font-medium">助手</strong>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="模型设置"
          title="模型设置"
          onClick={() => setSettings((v) => !v)}
        >
          <Settings2 />
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
      {(!chat?.configured || settings) && (
        <form
          className="grid shrink-0 gap-3 border-b p-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!window.dela) return;
            setBusy(true);
            void window.dela.workspace
              .configureModel(key, model)
              .then(() => window.dela!.workspace.getChat(scope))
              .then((result) => {
                setChat(result);
                setKey('');
                setSettings(false);
              })
              .catch((e) => setError(errorText(e)))
              .finally(() => setBusy(false));
          }}
        >
          <label className="grid gap-2 text-xs">
            致远一号 API Key
            <Input
              type="password"
              autoComplete="off"
              required
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
          </label>
          <select
            aria-label="模型"
            className="h-8 rounded-md border bg-background px-2 text-xs"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          >
            <option value="qwen">Qwen</option>
            <option value="deepseek-chat">DeepSeek</option>
            <option value="deepseek-reasoner">DeepSeek · 深度思考</option>
            <option value="minimax">MiniMax</option>
          </select>
          <Button type="submit" size="sm" disabled={busy}>
            保存配置
          </Button>
        </form>
      )}
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {!chat?.messages.length && (
          <p className="text-sm leading-relaxed text-muted-foreground">
            选中需要引用的正文，讨论问题或整理思路。回答可以保存为笔记。
          </p>
        )}
        {chat?.messages.map((message, index) => (
          <div
            key={index}
            className={
              message.role === 'user'
                ? 'mb-5 rounded-lg bg-secondary p-3 text-sm'
                : 'mb-6 text-sm leading-relaxed'
            }
          >
            {message.role === 'user' ? (
              <p className="whitespace-pre-wrap">{message.content}</p>
            ) : (
              <div className="[&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    img: ({ alt }) => <span>{alt}</span>,
                    a: ({ href, children }) => (
                      <button
                        className="underline"
                        onClick={() =>
                          href &&
                          void window.dela?.canvas
                            .openLink(href)
                            .catch((e) => setError(errorText(e)))
                        }
                      >
                        {children}
                      </button>
                    ),
                  }}
                >
                  {message.content}
                </ReactMarkdown>
              </div>
            )}
            {message.sources?.length ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {message.sources.map((source) => (
                  <button
                    key={source.key}
                    className="max-w-full truncate rounded border px-2 py-1 text-xs text-muted-foreground"
                    onClick={() => onOpen(source.key)}
                  >
                    {source.title}
                  </button>
                ))}
              </div>
            ) : null}
            {message.toolResults?.map((result) => {
              const output = result.output as {
                ok?: boolean;
                error?: { message?: string };
                result?: { draftId?: string };
              } | null;
              return (
                <details
                  key={result.id}
                  className="my-2 rounded border p-2 text-xs text-muted-foreground"
                >
                  <summary className="cursor-pointer">
                    {toolLabels[result.name] ?? result.name} · {output?.ok ? '已完成' : '未完成'}
                  </summary>
                  {output?.error?.message && <p className="mt-2">{output.error.message}</p>}
                  {result.name === 'prepare_email' && output?.ok && output.result?.draftId && (
                    <Button
                      size="sm"
                      className="mt-2"
                      disabled={openingEmail}
                      onClick={() => void openEmail(output.result!.draftId!)}
                    >
                      检查并发送
                    </Button>
                  )}
                  <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all">
                    {JSON.stringify(result.output, null, 2)}
                  </pre>
                </details>
              );
            })}
            {message.role === 'assistant' && (
              <button
                className="mt-2 text-xs font-medium text-muted-foreground hover:text-foreground"
                onClick={() => onSaveNote(message.content)}
              >
                保存为笔记
              </button>
            )}
          </div>
        ))}
        {busy && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
            <LoaderCircle className="size-3 animate-spin" />
            {chat?.activeTool ? `${toolLabels[chat.activeTool] ?? chat.activeTool}…` : '正在处理…'}
          </p>
        )}
        {error && (
          <p role="alert" className="mt-3 text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
      <div className={home ? 'order-first shrink-0 border-b p-3' : 'shrink-0 border-t p-3'}>
        <details className="mb-3 text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            本次引用 · {selected.filter((id) => tabs.includes(id)).length} 项
          </summary>
          <div className="mt-2 grid max-h-32 gap-2 overflow-auto">
            {tabs.map((id) => {
              const format = drafts[id]?.content.format;
              const supported = format && ['html', 'markdown', 'text'].includes(format);
              return (
                <label key={id} className="flex min-w-0 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selected.includes(id)}
                    disabled={!supported || busy}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...selected, id]
                          : selected.filter((value) => value !== id),
                      )
                    }
                  />
                  <span className="truncate">{title(id)}</span>
                  {!supported && (
                    <span className="shrink-0 text-muted-foreground">仅支持文本正文</span>
                  )}
                </label>
              );
            })}
          </div>
        </details>
        <div className="relative">
          <textarea
            aria-label="发送给助手"
            className="w-full resize-none rounded-lg border bg-background p-3 pr-10 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="查找资料、安排日程，或继续一个项目…"
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                void send();
              }
            }}
          />
          <Button
            className="absolute bottom-2 right-2"
            size="icon-sm"
            aria-label={busy ? '停止执行' : '发送问题'}
            disabled={!busy && (!chat?.configured || !prompt.trim())}
            onClick={() =>
              busy
                ? void window.dela?.workspace.cancelAsk(scope).catch((e) => setError(errorText(e)))
                : void send()
            }
          >
            {busy ? <Square /> : <ArrowUp />}
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          对话、选中资料及工具读取的内容会提供给致远一号。
        </p>
      </div>
      <Dialog.Root
        open={Boolean(email)}
        onOpenChange={(open) => {
          if (!open) closeEmail();
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
          <Dialog.Content
            className="fixed inset-4 z-50 flex flex-col overflow-hidden rounded-xl border bg-background shadow-xl"
            aria-describedby={undefined}
          >
            <Dialog.Title className="sr-only">检查邮件草稿</Dialog.Title>
            {email && (
              <MailComposer
                key={email.draft.id}
                draft={email.draft}
                accountAddress={email.address}
                onDirtyChange={() => {}}
                onClose={closeEmail}
                onSent={(warning) => {
                  setEmail(null);
                  if (warning) setError(warning);
                }}
              />
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </aside>
  );
}
