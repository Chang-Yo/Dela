import { useEffect, useRef, useState } from 'react';
import { ArrowUp, LoaderCircle, Settings2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { WorkspaceChat } from '../../../shared/api';
import { PanelToggleButton } from '../../components/ui/panel-toggle';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { errorText, useWorkspace } from './workspace';

export function AgentPanel({
  scope,
  tabs,
  title,
  onCollapse,
  onSaveNote,
  onOpen,
}: {
  scope: string;
  tabs: string[];
  title: (key: string) => string;
  onCollapse: () => void;
  onSaveNote: (text: string) => void;
  onOpen: (key: string) => void;
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
          setModel(value.model);
        }
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      });
    return () => {
      active = false;
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
      aria-label="阅读助手"
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
        <PanelToggleButton
          collapsed={false}
          controlsId="workspace-agent"
          label="助手"
          side="right"
          onToggle={onCollapse}
        />
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
            正在处理…
          </p>
        )}
        {error && (
          <p role="alert" className="mt-3 text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
      <div className="shrink-0 border-t p-3">
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
            placeholder="询问或粘贴一段文字…"
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
            aria-label="发送问题"
            disabled={busy || !chat?.configured || !prompt.trim()}
            onClick={() => void send()}
          >
            <ArrowUp />
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          发送时，所选正文及近期对话会提供给致远一号。
        </p>
      </div>
    </aside>
  );
}
