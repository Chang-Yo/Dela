import { useEffect, useState } from 'react';
import { Dialog } from 'radix-ui';
import { Check, LoaderCircle, Pencil, Plus, Server, Trash2 } from 'lucide-react';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { cn } from '../../lib/utils';
import type { LlmProviderView, LlmVerifyResult } from '../../../shared/api';
import {
  findLlmPreset,
  llmProviderPresets,
  reasoningEffortLevels,
  type LlmProviderPreset,
} from '../../../shared/llm-presets';
import { SectionHeader } from './SectionHeader';
import { errorText } from '../projects/workspace';

type EditState = { mode: 'create' } | { mode: 'edit'; provider: LlmProviderView } | null;

/** 设置 › 模型服务：管理多个 LLM 提供商配置，一键切换当前使用的一个。 */
export function LlmSection() {
  const [providers, setProviders] = useState<LlmProviderView[] | null>(null);
  const [dialog, setDialog] = useState<EditState>(null);
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    void window.dela?.llm
      .list()
      .then((views) => {
        setProviders(views);
        setConfirmId(null);
      })
      .catch((cause) => setError(errorText(cause)));
  };

  useEffect(refresh, []);

  // 启用与删除共用同一套 busy/错误处理，成功后都刷新列表。
  const run = async (operation: () => Promise<void>) => {
    if (!window.dela) return;
    setBusy(true);
    setError(null);
    try {
      await operation();
      refresh();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  if (!window.dela) {
    return (
      <div className="grid gap-5">
        <SectionHeader
          description="配置对话助手使用的模型服务，支持多个 OpenAI 兼容提供商。"
          title="模型服务"
        />
        <p className="text-sm text-muted-foreground">模型服务配置仅在桌面端可用。</p>
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      <SectionHeader
        description="配置对话助手使用的模型服务。可保存多个提供商并随时切换；API Key 经系统加密保存在本机。"
        title="模型服务"
      />
      <div className="flex items-center justify-between gap-2">
        <Button onClick={() => setDialog({ mode: 'create' })} size="sm">
          <Plus />
          添加提供商
        </Button>
      </div>
      {providers !== null && providers.length === 0 && (
        <p className="text-sm text-muted-foreground">还没有配置提供商。添加一个以启用对话助手。</p>
      )}
      {providers !== null && providers.length > 0 && (
        <ul className="grid">
          {providers.map((provider) => (
            <li
              className="flex min-h-16 items-center justify-between gap-4 border-b last:border-0 max-md:items-start max-md:py-3"
              key={provider.id}
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary">
                  <Server className="size-4 text-muted-foreground" strokeWidth={1.8} />
                </span>
                <div className="grid min-w-0 gap-0.5">
                  <strong className="truncate text-sm">{provider.name}</strong>
                  <span className="truncate text-xs text-muted-foreground">
                    {provider.baseUrl} · {provider.model}
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {provider.active ? (
                  <Badge>使用中</Badge>
                ) : (
                  <Button
                    disabled={busy}
                    onClick={() => void run(() => window.dela!.llm.setActive(provider.id))}
                    size="sm"
                    variant="secondary"
                  >
                    使用
                  </Button>
                )}
                <Button
                  aria-label={`编辑 ${provider.name}`}
                  onClick={() => setDialog({ mode: 'edit', provider })}
                  size="icon-sm"
                  variant="ghost"
                >
                  <Pencil />
                </Button>
                {confirmId === provider.id ? (
                  <>
                    <Button
                      disabled={busy}
                      onClick={() => void run(() => window.dela!.llm.remove(provider.id))}
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
                    aria-label={`删除 ${provider.name}`}
                    disabled={busy}
                    onClick={() => setConfirmId(provider.id)}
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
        <p className="text-xs [overflow-wrap:anywhere] text-destructive" role="alert">
          {error}
        </p>
      )}
      {dialog && (
        <ProviderFormDialog editing={dialog} onClose={() => setDialog(null)} onSaved={refresh} />
      )}
    </div>
  );
}

/** 预设只用于预填默认值；密钥留空编辑表示沿用已保存密钥。 */
function ProviderFormDialog({
  editing,
  onClose,
  onSaved,
}: {
  editing: Exclude<EditState, null>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const initialPreset =
    editing.mode === 'edit'
      ? (findLlmPreset(editing.provider.presetId) ??
        llmProviderPresets.find((preset) => preset.id === 'custom')!)
      : llmProviderPresets[0]!;
  const [presetId, setPresetId] = useState(initialPreset.id);
  const [name, setName] = useState(
    editing.mode === 'edit' ? editing.provider.name : initialPreset.name,
  );
  const [baseUrl, setBaseUrl] = useState(
    editing.mode === 'edit' ? editing.provider.baseUrl : initialPreset.baseUrl,
  );
  const [apiKey, setApiKey] = useState('');
  const [models, setModels] = useState<string[]>(
    editing.mode === 'edit' ? [...editing.provider.models] : [...initialPreset.models],
  );
  const [model, setModel] = useState(
    editing.mode === 'edit' ? editing.provider.model : (initialPreset.models[0] ?? ''),
  );
  const [modelInput, setModelInput] = useState('');
  const [effortEnabled, setEffortEnabled] = useState(
    editing.mode === 'edit' && editing.provider.effortLevels.length > 0,
  );
  const [effortLevels, setEffortLevels] = useState<string[]>(
    editing.mode === 'edit' ? [...editing.provider.effortLevels] : [],
  );
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<LlmVerifyResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyPreset = (preset: LlmProviderPreset) => {
    setPresetId(preset.id);
    setName(preset.name === '自定义' ? '' : preset.name);
    setBaseUrl(preset.baseUrl);
    setModels([...preset.models]);
    setModel(preset.models[0] ?? '');
    setVerifyResult(null);
  };

  const addModel = () => {
    const value = modelInput.trim();
    if (!value || models.includes(value) || models.length >= 64) return;
    setModels((current) => [...current, value]);
    setModelInput('');
  };

  const removeModel = (value: string) => {
    setModels((current) => {
      const next = current.filter((item) => item !== value);
      if (model === value) setModel(next[0] ?? '');
      return next;
    });
  };

  const importModels = (list: string[]) => {
    setModels(list);
    setModel(list.includes(model) ? model : (list[0] ?? ''));
  };

  const verify = async () => {
    if (!window.dela || verifying) return;
    setVerifying(true);
    setVerifyResult(null);
    try {
      setVerifyResult(
        await window.dela.llm.verify({
          id: editing.mode === 'edit' ? editing.provider.id : undefined,
          baseUrl,
          apiKey: apiKey || undefined,
        }),
      );
    } catch (cause) {
      setVerifyResult({ ok: false, message: errorText(cause) });
    } finally {
      setVerifying(false);
    }
  };

  const save = async () => {
    if (!window.dela || busy) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await window.dela.llm.save({
        id: editing.mode === 'edit' ? editing.provider.id : undefined,
        name,
        baseUrl,
        apiKey: apiKey || undefined,
        models,
        model,
        effortLevels: effortEnabled ? effortLevels : [],
        presetId:
          editing.mode === 'edit'
            ? editing.provider.presetId
            : presetId === 'custom'
              ? null
              : presetId,
      });
      // 新建后立即启用；编辑不改当前选择。
      if (editing.mode === 'create') await window.dela.llm.setActive(saved.id);
      onSaved();
      onClose();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const preset = findLlmPreset(presetId);

  return (
    <Dialog.Root onOpenChange={(open) => !open && !busy && onClose()} open>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30 data-[state=open]:animate-in data-[state=open]:fade-in duration-150" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-full max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border bg-background p-6 shadow-xl max-md:w-[calc(100%-2rem)]">
          <Dialog.Title className="text-base font-semibold">
            {editing.mode === 'create' ? '添加提供商' : `编辑 ${editing.provider.name}`}
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-xs leading-relaxed text-muted-foreground">
            从预设选择或填写任意 OpenAI 兼容服务地址。密钥经系统加密保存在本机，不会回传页面。
          </Dialog.Description>
          <form
            className="mt-4 grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            {editing.mode === 'create' && (
              <label className="grid gap-2 text-sm">
                预设
                <select
                  className="h-9 rounded-md border bg-background px-2 text-sm"
                  onChange={(event) =>
                    applyPreset(llmProviderPresets.find((item) => item.id === event.target.value)!)
                  }
                  value={presetId}
                >
                  {llmProviderPresets.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="grid gap-2 text-sm">
              名称
              <Input
                autoComplete="off"
                onChange={(event) => setName(event.target.value)}
                required
                value={name}
              />
            </label>
            <label className="grid gap-2 text-sm">
              API 地址
              <Input
                autoComplete="off"
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder="https://…"
                required
                type="url"
                value={baseUrl}
              />
            </label>
            <div className="grid gap-2 text-sm">
              <div className="flex items-center justify-between">
                <span>API Key</span>
                {preset?.keyUrl && (
                  <a
                    className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                    href={preset.keyUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    获取密钥
                  </a>
                )}
              </div>
              <Input
                autoComplete="off"
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={editing.mode === 'edit' ? '已保存，留空保持不变' : 'sk-…'}
                required={editing.mode === 'create'}
                type="password"
                value={apiKey}
              />
            </div>
            <div className="grid gap-2 text-sm">
              <span>模型</span>
              <div className="flex flex-wrap gap-1.5">
                {models.map((item) => (
                  <span
                    className="flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs"
                    key={item}
                  >
                    {item}
                    <button
                      aria-label={`移除模型 ${item}`}
                      className="grid size-4 shrink-0 place-items-center rounded text-muted-foreground hover:text-foreground"
                      onClick={() => removeModel(item)}
                      type="button"
                    >
                      ×
                    </button>
                  </span>
                ))}
                <input
                  aria-label="添加模型"
                  className="h-7 w-36 rounded-md border bg-background px-2 text-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring/60"
                  onChange={(event) => setModelInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addModel();
                    }
                  }}
                  placeholder="添加模型…"
                  value={modelInput}
                />
              </div>
            </div>
            <label className="grid gap-2 text-sm">
              默认模型
              <select
                className="h-9 rounded-md border bg-background px-2 text-sm"
                disabled={!models.length}
                onChange={(event) => setModel(event.target.value)}
                value={model}
              >
                {models.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid gap-2 text-sm">
              <label className="flex items-center gap-2">
                <input
                  checked={effortEnabled}
                  onChange={(event) => setEffortEnabled(event.target.checked)}
                  type="checkbox"
                />
                推理强度
              </label>
              {effortEnabled && (
                <>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    勾选要在对话中暴露的档位（多选）；所选档位经 reasoning_effort
                    随请求下发，默认取第一档，可在输入框旁切换。
                  </p>
                  <div aria-label="推理强度档位" className="flex flex-wrap gap-1.5" role="group">
                    {reasoningEffortLevels.map((level) => {
                      const selected = effortLevels.includes(level);
                      return (
                        <button
                          aria-pressed={selected}
                          className={cn(
                            'rounded-md border px-2 py-1 text-xs transition-colors',
                            selected
                              ? 'border-transparent bg-accent text-accent-foreground'
                              : 'text-muted-foreground hover:bg-accent/40',
                          )}
                          key={level}
                          onClick={() =>
                            setEffortLevels((current) =>
                              current.includes(level)
                                ? current.filter((item) => item !== level)
                                : [...current, level],
                            )
                          }
                          type="button"
                        >
                          {level}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm">密钥检测</span>
                <Button
                  disabled={verifying || !baseUrl}
                  onClick={() => void verify()}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  {verifying ? <LoaderCircle className="animate-spin" /> : null}
                  {verifying ? '检测中…' : '检测密钥'}
                </Button>
              </div>
              {verifyResult && (
                <p
                  className={cn(
                    'flex flex-wrap items-center gap-1.5 text-xs [overflow-wrap:anywhere]',
                    verifyResult.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive',
                  )}
                  role="status"
                >
                  {verifyResult.ok && <Check className="size-3.5 shrink-0" />}
                  {verifyResult.message}
                  {verifyResult.ok && verifyResult.models?.length ? (
                    <button
                      className="underline underline-offset-2"
                      onClick={() => importModels(verifyResult.models!)}
                      type="button"
                    >
                      导入模型列表
                    </button>
                  ) : null}
                </p>
              )}
              <p className="text-xs leading-relaxed text-muted-foreground">
                通过请求服务的模型列表接口检测；个别服务不校验该接口的密钥，检测结果仅供参考。
              </p>
            </div>
            {error && (
              <p className="text-xs text-destructive" role="alert">
                {error}
              </p>
            )}
            <div className="flex items-center justify-end gap-2">
              <Button disabled={busy} onClick={onClose} variant="ghost">
                取消
              </Button>
              <Button
                disabled={busy || !models.length || (effortEnabled && !effortLevels.length)}
                type="submit"
              >
                {busy ? '处理中…' : '保存'}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
