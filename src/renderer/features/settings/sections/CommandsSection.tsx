import { useEffect, useState } from 'react';
import { Dialog } from 'radix-ui';
import { Pencil, Plus, Terminal, Trash2 } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import type { ChatCommandView } from '../../../../shared/api';
import { SectionHeader } from '../SectionHeader';
import { errorText } from '../../../workspace/store';

type EditState = { mode: 'create' } | { mode: 'edit'; command: ChatCommandView } | null;

/** 设置 › 自定义指令：用户附加 Instruction（每次对话生效）+ 可复用的 / 指令模板。 */
export function CommandsSection() {
  const [commands, setCommands] = useState<ChatCommandView[] | null>(null);
  const [dialog, setDialog] = useState<EditState>(null);
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Instruction：null 表示尚未读到当前值；draft 为用户正在编辑的正文。
  const [instruction, setInstruction] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [instructionBusy, setInstructionBusy] = useState(false);
  const [instructionSaved, setInstructionSaved] = useState(false);
  const [instructionError, setInstructionError] = useState<string | null>(null);

  const refresh = () => {
    void window.dela?.chat
      .listCommands()
      .then((views) => {
        setCommands(views);
        setConfirmId(null);
      })
      .catch((cause) => setError(errorText(cause)));
  };

  useEffect(refresh, []);

  useEffect(() => {
    void window.dela?.settings
      .getInstruction()
      .then((text) => {
        setInstruction(text);
        setDraft(text);
      })
      .catch((cause) => setInstructionError(errorText(cause)));
  }, []);

  const saveInstruction = async () => {
    if (!window.dela || instructionBusy || instruction === null) return;
    setInstructionBusy(true);
    setInstructionError(null);
    try {
      const saved = await window.dela.settings.setInstruction(draft);
      setInstruction(saved);
      setDraft(saved);
      setInstructionSaved(true);
    } catch (cause) {
      setInstructionError(errorText(cause));
    } finally {
      setInstructionBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.dela) return;
    setBusy(true);
    setError(null);
    try {
      await window.dela.chat.deleteCommand(id);
      refresh();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-5">
      <SectionHeader title="自定义指令" />
      {!window.dela ? (
        <p className="text-sm text-muted-foreground">指令配置仅在桌面端可用。</p>
      ) : (
        <>
          <section
            className="grid gap-2.5 rounded-xl border bg-card p-5 max-md:p-4"
            data-setting-id="instruction"
          >
            <h2 className="text-sm font-medium">Instruction</h2>
            {/* 说明注入时机与边界：用户指令优先于资料与历史，但不越过基础设定的安全约束。 */}
            <p className="text-xs leading-relaxed text-muted-foreground">
              每次对话都会连同系统设定发送给模型，用于长期偏好（回答语言、写作风格、固定准则）；优先级仅次于系统设定，留空则不发送。
            </p>
            <textarea
              aria-label="Instruction"
              className="min-h-24 rounded-md border bg-background px-3 py-2 text-sm leading-relaxed outline-none placeholder:text-muted-foreground focus-visible:border-ring/60"
              disabled={instruction === null || instructionBusy}
              maxLength={2000}
              onChange={(event) => {
                setDraft(event.target.value);
                setInstructionSaved(false);
              }}
              placeholder="例如：回答先给结论再给依据，尽量简洁；涉及日期时使用北京时间。"
              rows={4}
              value={draft}
            />
            <div className="flex items-center justify-end gap-2">
              {instructionSaved ? (
                <span className="text-xs text-muted-foreground" role="status">
                  已保存
                </span>
              ) : null}
              <Button
                disabled={instruction === null || instructionBusy || draft === instruction}
                onClick={() => void saveInstruction()}
                size="sm"
              >
                {instructionBusy ? '保存中…' : '保存'}
              </Button>
            </div>
            {instructionError && (
              <p className="text-xs text-destructive" role="alert">
                {instructionError}
              </p>
            )}
          </section>
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <h2 className="text-sm font-medium">快捷指令</h2>
            <Button onClick={() => setDialog({ mode: 'create' })} size="sm" variant="secondary">
              <Plus />
              新建指令
            </Button>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            输入 / 名称手动触发，仅该轮生效。
          </p>
          {commands !== null && commands.length === 0 && (
            <p className="text-sm text-muted-foreground">
              还没有自定义指令，例如「周报」：汇总本周日程与未读邮件。
            </p>
          )}
          {commands !== null && commands.length > 0 && (
            <ul className="grid">
              {commands.map((command) => (
                <li
                  className="flex min-h-14 items-center justify-between gap-4 border-b last:border-0"
                  key={command.id}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary">
                      <Terminal className="size-4 text-muted-foreground" strokeWidth={1.8} />
                    </span>
                    <div className="grid min-w-0 gap-0.5">
                      <strong className="truncate text-sm">/{command.name}</strong>
                      <span
                        className="truncate text-xs text-muted-foreground"
                        title={command.prompt}
                      >
                        {command.prompt}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      aria-label={`编辑 ${command.name}`}
                      onClick={() => setDialog({ mode: 'edit', command })}
                      size="icon-sm"
                      variant="ghost"
                    >
                      <Pencil />
                    </Button>
                    {confirmId === command.id ? (
                      <>
                        <Button
                          disabled={busy}
                          onClick={() => void remove(command.id)}
                          size="sm"
                          variant="destructive"
                        >
                          确认删除
                        </Button>
                        <Button onClick={() => setConfirmId(null)} size="sm" variant="ghost">
                          取消
                        </Button>
                      </>
                    ) : (
                      <Button
                        aria-label={`删除 ${command.name}`}
                        disabled={busy}
                        onClick={() => setConfirmId(command.id)}
                        size="icon-sm"
                        variant="ghost"
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {error && (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          )}
          {dialog && (
            <CommandFormDialog editing={dialog} onClose={() => setDialog(null)} onSaved={refresh} />
          )}
        </>
      )}
    </div>
  );
}

function CommandFormDialog({
  editing,
  onClose,
  onSaved,
}: {
  editing: Exclude<EditState, null>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(editing.mode === 'edit' ? editing.command.name : '');
  const [prompt, setPrompt] = useState(editing.mode === 'edit' ? editing.command.prompt : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!window.dela || busy) return;
    setBusy(true);
    setError(null);
    try {
      await window.dela.chat.saveCommand({
        id: editing.mode === 'edit' ? editing.command.id : undefined,
        name,
        prompt,
      });
      onSaved();
      onClose();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root onOpenChange={(open) => !open && !busy && onClose()} open>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30 data-[state=open]:animate-in data-[state=open]:fade-in duration-150" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-full max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border bg-background p-6 shadow-xl max-md:w-[calc(100%-2rem)]">
          <Dialog.Title className="text-base font-semibold">
            {editing.mode === 'create' ? '新建指令' : `编辑 /${editing.command.name}`}
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-xs leading-relaxed text-muted-foreground">
            指令是可复用的提问模板。保存后在助手输入框输入 /{name || '名称'} 触发。
          </Dialog.Description>
          <form
            className="mt-4 grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <label className="grid gap-2 text-sm">
              名称
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">/</span>
                <Input
                  autoComplete="off"
                  onChange={(event) => setName(event.target.value)}
                  placeholder="周报"
                  required
                  value={name}
                />
              </div>
            </label>
            <label className="grid gap-2 text-sm">
              指令内容
              <textarea
                className="min-h-28 rounded-md border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring/60"
                maxLength={2000}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="每周帮我汇总本周的日程、作业与未读邮件"
                required
                rows={4}
                value={prompt}
              />
            </label>
            {error && (
              <p className="text-xs text-destructive" role="alert">
                {error}
              </p>
            )}
            <div className="flex items-center justify-end gap-2">
              <Button disabled={busy} onClick={onClose} variant="ghost">
                取消
              </Button>
              <Button disabled={busy} type="submit">
                {busy ? '处理中…' : '保存'}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
