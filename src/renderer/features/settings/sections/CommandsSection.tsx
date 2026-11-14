import { useEffect, useState } from 'react';
import { Pencil, Plus, Terminal, Trash2 } from 'lucide-react';
import { agentClient, chatClient } from '../../../../modules/chat/view';
import { Button } from '../../../../ui/button';
import { Input } from '../../../../ui/input';
import type { ChatCommandView } from '../../../../shared/api';
import {
  SectionHeader,
  SettingsGroup,
  SettingsGroupLabel,
  settingsClient,
} from '../../../../modules/settings/view';
import { errorText } from '../../../workspace/store';
import { showToast } from '../../../app/toasts';
import { ErrorText } from '../../../../ui/alert';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../../../../ui/dialog';
import { Field } from '../../../../ui/field';

type EditState = { mode: 'create' } | { mode: 'edit'; command: ChatCommandView } | null;

/** 设置 › 自定义指令：用户附加的全局指令（每次对话生效）+ 可复用的 / 指令模板。 */
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
  const [instructionError, setInstructionError] = useState<string | null>(null);

  const refresh = () => {
    void agentClient['list-commands']({})
      .then((views) => {
        setCommands(views);
        setConfirmId(null);
      })
      .catch((cause) => setError(errorText(cause)));
  };

  useEffect(refresh, []);

  useEffect(() => {
    if (!window.dela) return;
    void settingsClient
      .instruction()
      .then((text) => {
        setInstruction(text);
        setDraft(text);
      })
      .catch((cause) => setInstructionError(errorText(cause)));
  }, []);

  const saveInstruction = async () => {
    if (!window.dela || instructionBusy || instruction === null) return;
    setInstructionBusy(true);
    try {
      const saved = await settingsClient.setInstruction(draft);
      setInstruction(saved);
      setDraft(saved);
      showToast({ variant: 'success', title: '已保存' });
    } catch (cause) {
      showToast({ variant: 'error', title: '保存失败', description: errorText(cause) });
    } finally {
      setInstructionBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.dela) return;
    setBusy(true);
    try {
      await chatClient.deleteCommand(id);
      refresh();
    } catch (cause) {
      showToast({ variant: 'error', title: '删除失败', description: errorText(cause) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-10">
      <SectionHeader title="自定义指令" />
      {!window.dela ? (
        <p className="text-sm text-ink-3">指令配置仅在桌面端可用。</p>
      ) : (
        <>
          <div className="grid gap-2" data-setting-id="instruction">
            <SettingsGroupLabel
              description="随每次对话发送给模型，留空则不发送。"
              title="全局指令"
            />
            <textarea
              aria-label="全局指令"
              className="min-h-24 rounded-control bg-field px-2.5 py-1.5 text-sm leading-relaxed text-ink shadow-hairline outline-none transition-[background-color,box-shadow] duration-base placeholder:text-ink-3 focus-visible:bg-surface focus-visible:shadow-focus"
              disabled={instruction === null || instructionBusy}
              maxLength={2000}
              onChange={(event) => {
                setDraft(event.target.value);
              }}
              placeholder="例如：回答先给结论再给依据，尽量简洁；涉及日期时使用北京时间。"
              rows={4}
              value={draft}
            />
            <div className="flex items-center justify-end gap-2">
              <Button
                disabled={instruction === null || instructionBusy || draft === instruction}
                onClick={() => void saveInstruction()}
                size="sm"
              >
                {instructionBusy ? '保存中…' : '保存'}
              </Button>
            </div>
            {instructionError && <ErrorText>{instructionError}</ErrorText>}
          </div>
          <div className="grid gap-2">
            <SettingsGroup
              action={
                <Button onClick={() => setDialog({ mode: 'create' })} size="sm" variant="secondary">
                  <Plus />
                  新建指令
                </Button>
              }
              description="输入 / 名称手动触发，仅该轮生效。"
              title="快捷指令"
            >
              {commands !== null && commands.length === 0 && (
                <p className="py-3.5 text-sm text-ink-3">
                  还没有自定义指令，例如「周报」：汇总本周日程与未读邮件。
                </p>
              )}
              {commands !== null && commands.length > 0 && (
                <ul className="grid">
                  {commands.map((command) => (
                    <li
                      className="flex items-center justify-between gap-4 border-b py-3 last:border-0"
                      key={command.id}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="grid size-8 shrink-0 place-items-center rounded-card bg-fill">
                          <Terminal className="size-4 text-ink-3" strokeWidth={1.8} />
                        </span>
                        <div className="grid min-w-0 gap-0.5">
                          <strong className="truncate text-sm">/{command.name}</strong>
                          <span className="truncate text-xs text-ink-3" title={command.prompt}>
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
            </SettingsGroup>
            {error && <ErrorText>{error}</ErrorText>}
          </div>
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
      await chatClient.saveCommand({
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
    <Dialog onOpenChange={(open) => !open && !busy && onClose()} open>
      <DialogContent scroll>
        <DialogTitle>
          {editing.mode === 'create' ? '新建指令' : `编辑 /${editing.command.name}`}
        </DialogTitle>
        <DialogDescription>
          指令是可复用的提问模板。保存后在助手输入框输入 /{name || '名称'} 触发。
        </DialogDescription>
        <form
          className="mt-4 grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <Field label="名称">
            <div className="flex items-center gap-1">
              <span className="text-ink-3">/</span>
              <Input
                autoComplete="off"
                onChange={(event) => setName(event.target.value)}
                placeholder="周报"
                required
                value={name}
              />
            </div>
          </Field>
          <Field label="指令内容">
            <textarea
              className="min-h-28 rounded-control bg-field px-2.5 py-1.5 text-sm text-ink shadow-hairline outline-none transition-[background-color,box-shadow] duration-base placeholder:text-ink-3 focus-visible:bg-surface focus-visible:shadow-focus"
              maxLength={2000}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="每周帮我汇总本周的日程、作业与未读邮件"
              required
              rows={4}
              value={prompt}
            />
          </Field>
          {error && <ErrorText>{error}</ErrorText>}
          <div className="flex items-center justify-end gap-2">
            <Button disabled={busy} onClick={onClose} variant="ghost">
              取消
            </Button>
            <Button disabled={busy} type="submit">
              {busy ? '处理中…' : '保存'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
