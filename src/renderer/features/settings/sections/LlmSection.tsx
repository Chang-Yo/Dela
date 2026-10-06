import { useEffect, useState } from 'react';
import { Check, LoaderCircle, Plus, Server, Trash2 } from 'lucide-react';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select';
import { cn } from '../../../lib/utils';
import type { LlmProviderView, LlmVerifyResult } from '../../../../shared/api';
import {
  findLlmPreset,
  llmProviderPresets,
  reasoningEffortLevels,
  type LlmProviderPreset,
} from '../../../../shared/llm-presets';
import { SectionHeader } from '../SectionHeader';
import { errorText } from '../../../workspace/store';

/** 详情区目标：新建草稿，或某个已保存提供商的 id。 */
type Detail = { mode: 'create' } | { mode: 'edit'; id: string };

/** 默认详情：当前使用中的提供商，其次列表第一个；列表为空时返回 null。 */
function defaultDetail(providers: LlmProviderView[]): Detail | null {
  const provider = providers.find(({ active }) => active) ?? providers[0];
  return provider ? { mode: 'edit', id: provider.id } : null;
}

/** 设置 › 模型供应商：左侧按预设/自定义分组列出提供商，右侧编辑选中的那一个。 */
export function LlmSection() {
  const [providers, setProviders] = useState<LlmProviderView[] | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** 读取最新列表；selectId 指定刷新后选中的提供商（保存时用，新建的此时才出现在列表里）。 */
  const refresh = (selectId?: string) => {
    void window.dela?.llm
      .list()
      .then((views) => {
        setProviders(views);
        setDetail((current) => {
          if (selectId && views.some(({ id }) => id === selectId)) {
            return { mode: 'edit', id: selectId };
          }
          // 选中项仍在列表里（编辑后刷新）或正处于新建草稿时保持不变。
          if (
            current?.mode === 'create' ||
            (current && views.some(({ id }) => id === current.id))
          ) {
            return current;
          }
          // 首次加载与删除后回落到当前使用中的提供商。
          return defaultDetail(views);
        });
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
      <div className="grid gap-5" data-setting-id="providers">
        <SectionHeader title="模型供应商" />
        <p className="text-sm text-muted-foreground">模型供应商配置仅在桌面端可用。</p>
      </div>
    );
  }

  const selected =
    detail?.mode === 'edit' ? ((providers ?? []).find(({ id }) => id === detail.id) ?? null) : null;
  // 新建草稿没有 provider；编辑态的目标由列表解出（提供商被删除后由 refresh 收敛）。
  const detailProvider = detail?.mode === 'create' ? null : selected;
  const detailOpen = detail?.mode === 'create' || selected !== null;
  const groups = [
    { label: '预设', items: (providers ?? []).filter(({ presetId }) => findLlmPreset(presetId)) },
    {
      label: '自定义',
      items: (providers ?? []).filter(({ presetId }) => !findLlmPreset(presetId)),
    },
  ];

  /** 保存结果并入列表；只有仍停留在本次保存的详情时才切到保存后的提供商。 */
  const handleSaved = (saved: LlmProviderView, source: Detail) => {
    setProviders((current) =>
      current?.some(({ id }) => id === saved.id)
        ? current.map((item) => (item.id === saved.id ? saved : item))
        : [...(current ?? []), saved],
    );
    setDetail((current) => (current === source ? { mode: 'edit', id: saved.id } : current));
    refresh();
  };

  return (
    <div className="grid gap-5" data-setting-id="providers">
      <SectionHeader title="模型供应商" />
      {/* 主从两栏：左栏固定 15rem（w-60 档）承载列表，右栏是详情表单；中屏以下改为上下堆叠。 */}
      <div className="grid gap-4 rounded-xl border bg-card p-5 max-md:p-4 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-6">
        <div className="grid content-start gap-1">
          <Button
            className="justify-self-start"
            onClick={() => setDetail({ mode: 'create' })}
            size="sm"
          >
            <Plus />
            添加提供商
          </Button>
          {groups.map(({ label, items }) =>
            items.length ? (
              <div className="grid" key={label}>
                <p className="px-2 pb-1 pt-3 text-xs font-medium text-muted-foreground">{label}</p>
                <ul className="grid gap-0.5">
                  {items.map((provider) => {
                    const active = detail?.mode === 'edit' && detail.id === provider.id;
                    return (
                      <li key={provider.id}>
                        <button
                          aria-current={active ? 'true' : undefined}
                          className={cn(
                            'flex h-8 w-full min-w-0 items-center gap-2.5 rounded-lg px-2 text-left text-sm transition-colors',
                            active
                              ? 'bg-accent font-medium text-accent-foreground'
                              : 'text-foreground/75 hover:bg-accent/60 hover:text-foreground',
                          )}
                          onClick={() => setDetail({ mode: 'edit', id: provider.id })}
                          type="button"
                        >
                          <Server
                            className={cn('size-4 shrink-0', active ? '' : 'text-muted-foreground')}
                            strokeWidth={1.8}
                          />
                          <span className="truncate">{provider.name}</span>
                          {provider.active && <Badge className="ms-auto">使用中</Badge>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null,
          )}
        </div>
        {detailOpen ? (
          <ProviderDetail
            busy={busy}
            key={detailProvider?.id ?? 'create'}
            onCancelCreate={() => setDetail(defaultDetail(providers ?? []))}
            onRemove={(id) => void run(() => window.dela!.llm.remove(id))}
            onSaved={(saved) => handleSaved(saved, detail!)}
            onSetActive={(id) => void run(() => window.dela!.llm.setActive(id))}
            provider={detailProvider}
          />
        ) : providers?.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            还没有配置提供商。添加一个以启用对话助手。
          </p>
        ) : null}
      </div>
      {error && (
        <p className="text-xs [overflow-wrap:anywhere] text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** 预设只用于预填默认值；编辑时密钥留空表示沿用已保存密钥。 */
function ProviderDetail({
  busy,
  onCancelCreate,
  onRemove,
  onSaved,
  onSetActive,
  provider,
}: {
  /** 切换使用中与删除进行中：与列表共用同一 busy。 */
  busy: boolean;
  /** 放弃新建草稿，回到当前使用中的提供商。 */
  onCancelCreate: () => void;
  onRemove: (id: string) => void;
  onSaved: (provider: LlmProviderView) => void;
  onSetActive: (id: string) => void;
  /** 新建草稿时为 null；编辑时为该提供商的最新视图。 */
  provider: LlmProviderView | null;
}) {
  const creating = provider === null;
  const initialPreset = provider
    ? (findLlmPreset(provider.presetId) ??
      llmProviderPresets.find((preset) => preset.id === 'custom')!)
    : llmProviderPresets[0]!;
  const [presetId, setPresetId] = useState(initialPreset.id);
  const [name, setName] = useState(provider?.name ?? initialPreset.name);
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? initialPreset.baseUrl);
  const [apiKey, setApiKey] = useState('');
  const [models, setModels] = useState<string[]>(
    provider ? [...provider.models] : [...initialPreset.models],
  );
  const [model, setModel] = useState(provider?.model ?? initialPreset.models[0] ?? '');
  const [modelInput, setModelInput] = useState('');
  const [effortEnabled, setEffortEnabled] = useState(
    provider ? provider.effortLevels.length > 0 : false,
  );
  const [effortLevels, setEffortLevels] = useState<string[]>(
    provider ? [...provider.effortLevels] : [],
  );
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<LlmVerifyResult | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
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
          id: provider?.id,
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

  /** 放弃未保存的修改：各字段恢复为该提供商的已保存值；密钥不回显。 */
  const reset = (source: LlmProviderView) => {
    setName(source.name);
    setBaseUrl(source.baseUrl);
    setApiKey('');
    setModels([...source.models]);
    setModel(source.model);
    setModelInput('');
    setEffortEnabled(source.effortLevels.length > 0);
    setEffortLevels([...source.effortLevels]);
    setVerifyResult(null);
    setError(null);
  };

  const cancel = () => {
    if (!provider) {
      onCancelCreate();
      return;
    }
    reset(provider);
  };

  const save = async () => {
    if (!window.dela || saving) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await window.dela.llm.save({
        id: provider?.id,
        name,
        baseUrl,
        apiKey: apiKey || undefined,
        models,
        model,
        effortLevels: effortEnabled ? effortLevels : [],
        presetId: provider ? provider.presetId : presetId === 'custom' ? null : presetId,
      });
      // 新建后立即启用；编辑不改当前选择。
      if (creating) await window.dela.llm.setActive(saved.id);
      reset(saved);
      onSaved(saved);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setSaving(false);
    }
  };

  const preset = findLlmPreset(presetId);

  return (
    <div className="grid content-start gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary">
            <Server className="size-4 text-muted-foreground" strokeWidth={1.8} />
          </span>
          <strong className="truncate text-sm">{provider?.name ?? '新建提供商'}</strong>
        </div>
        {provider && (
          <div className="flex shrink-0 items-center gap-2">
            {provider.active ? (
              <Badge>使用中</Badge>
            ) : (
              <Button
                disabled={busy}
                onClick={() => onSetActive(provider.id)}
                size="sm"
                variant="secondary"
              >
                使用
              </Button>
            )}
            {confirmDelete ? (
              <>
                <Button
                  disabled={busy}
                  onClick={() => onRemove(provider.id)}
                  size="sm"
                  variant="destructive"
                >
                  确认删除
                </Button>
                <Button
                  aria-label="取消删除"
                  onClick={() => setConfirmDelete(false)}
                  size="sm"
                  variant="ghost"
                >
                  取消
                </Button>
              </>
            ) : (
              <Button
                aria-label={`删除 ${provider.name}`}
                disabled={busy}
                onClick={() => setConfirmDelete(true)}
                size="icon-sm"
                variant="ghost"
              >
                <Trash2 />
              </Button>
            )}
          </div>
        )}
      </div>
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {creating && (
          <div className="grid gap-2 text-sm">
            预设
            <Select
              onValueChange={(value) =>
                applyPreset(llmProviderPresets.find((item) => item.id === value)!)
              }
              value={presetId}
            >
              <SelectTrigger aria-label="预设">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {llmProviderPresets.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
            placeholder={creating ? 'sk-…' : '已保存，留空保持不变'}
            required={creating}
            type="password"
            value={apiKey}
          />
          {/* 密钥去向无法从输入框本身看出，保留原来的说明。 */}
          <p className="text-xs leading-relaxed text-muted-foreground">
            密钥经系统加密保存在本机，不会回传页面。更改 API 地址时需重新填写密钥。
          </p>
        </div>
        <div className="grid gap-2 text-sm">
          <span>模型列表</span>
          <div className="flex flex-wrap gap-1.5">
            {models.map((item) => (
              <span
                className="flex max-w-full items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs"
                key={item}
              >
                <span className="min-w-0 truncate">{item}</span>
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
        <div className="grid gap-2 text-sm">
          默认模型
          <Select disabled={!models.length} onValueChange={setModel} value={model}>
            <SelectTrigger aria-label="默认模型">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {models.map((item) => (
                <SelectItem key={item} value={item}>
                  {item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
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
              {/* 默认取第一档：解释档位的实际语义，防止误以为勾选顺序无意义。 */}
              <p className="text-xs leading-relaxed text-muted-foreground">
                勾选要在对话中暴露的档位（多选）；默认取第一档，可在输入框旁切换。
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
                verifyResult.ok ? 'text-success' : 'text-destructive',
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
            个别服务不校验该接口的密钥，检测结果仅供参考。
          </p>
        </div>
        {error && (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
        <div className="flex items-center justify-end gap-2">
          <Button disabled={saving} onClick={cancel} variant="ghost">
            取消
          </Button>
          <Button
            disabled={saving || !models.length || (effortEnabled && !effortLevels.length)}
            type="submit"
          >
            {saving ? '处理中…' : '保存'}
          </Button>
        </div>
      </form>
    </div>
  );
}
