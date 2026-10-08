import { useEffect, useRef, useState } from 'react';
import { Dialog } from 'radix-ui';
import {
  Check,
  LoaderCircle,
  Pencil,
  PlugZap,
  Plus,
  Search,
  Server,
  Trash2,
  X,
} from 'lucide-react';
import { StatusPill } from '@/components/ui/beautifului/atoms/StatusPill';
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
import type { LlmModelSettings, LlmProviderView, LlmVerifyResult } from '../../../../shared/api';
import {
  findLlmPreset,
  llmProviderPresets,
  reasoningEffortLevels,
  llmModelSettings,
  LLM_MODEL_LIMIT,
  LLM_DEFAULT_CONTEXT_WINDOW,
  LLM_DEFAULT_OUTPUT_TOKENS,
  type LlmProviderPreset,
} from '../../../../shared/llm-presets';
import { SectionHeader } from '../SectionHeader';
import { errorText } from '../../../workspace/store';
import { dialogOverlay, dialogPanel } from '../../../components/ui/motion';

/** 详情区目标：新建草稿，或某个已保存提供商的 id。 */
type Detail = { mode: 'create' } | { mode: 'edit'; id: string };

/** 默认详情：当前使用中的提供商，其次列表第一个；列表为空时返回 null。 */
function defaultDetail(providers: LlmProviderView[]): Detail | null {
  const provider = providers.find(({ active }) => active) ?? providers[0];
  return provider ? { mode: 'edit', id: provider.id } : null;
}

/** 编辑单个模型的草稿；最终随提供商保存，取消不会改变已有配置。 */
function ModelSettingsDialog({
  model,
  settings,
  onClose,
  onSave,
}: {
  model: string;
  settings: LlmModelSettings;
  onClose: () => void;
  onSave: (settings: LlmModelSettings) => void;
}) {
  const [contextWindow, setContextWindow] = useState(settings.contextWindow?.toString() ?? '');
  const [maxOutputTokens, setMaxOutputTokens] = useState(
    settings.maxOutputTokens?.toString() ?? '',
  );
  const [effortLevels, setEffortLevels] = useState(settings.effortLevels ?? []);
  const [effort, setEffort] = useState(settings.effort ?? settings.effortLevels?.[0] ?? '');
  const [error, setError] = useState<string | null>(null);
  const levels = reasoningEffortLevels.filter((level) => effortLevels.includes(level));
  const save = () => {
    const context = contextWindow ? Number(contextWindow) : undefined;
    const output = maxOutputTokens ? Number(maxOutputTokens) : undefined;
    if (
      (context !== undefined && (!Number.isSafeInteger(context) || context <= 0)) ||
      (output !== undefined && (!Number.isSafeInteger(output) || output <= 0))
    ) {
      setError('Token 数必须是正整数');
      return;
    }
    if (
      (context !== undefined || output !== undefined) &&
      (output ?? LLM_DEFAULT_OUTPUT_TOKENS) >= (context ?? LLM_DEFAULT_CONTEXT_WINDOW)
    ) {
      setError('最大输出必须小于上下文窗口');
      return;
    }
    onSave({
      ...(context ? { contextWindow: context } : {}),
      ...(output ? { maxOutputTokens: output } : {}),
      effortLevels: levels,
      ...(levels.length
        ? { effort: levels.includes(effort as (typeof levels)[number]) ? effort : levels[0] }
        : {}),
    });
  };
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlay} />
        <Dialog.Content className={cn(dialogPanel, 'max-h-[85vh] max-w-lg overflow-y-auto')}>
          <div className="flex items-center justify-between gap-2">
            <Dialog.Title className="text-base font-semibold">编辑模型设置</Dialog.Title>
            <Dialog.Close asChild>
              <Button aria-label="关闭模型设置" size="icon-xs" variant="ghost">
                <X />
              </Button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="mt-2 text-xs text-muted-foreground">
            模型设置随提供商一起保存。限制留空时沿用默认值；思考档位须由服务支持。
          </Dialog.Description>
          <form
            className="mt-4 grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <label className="grid gap-2 text-sm">
              模型 ID
              <Input readOnly value={model} />
            </label>
            <label className="grid gap-2 text-sm">
              上下文窗口（tokens）
              <Input
                aria-label="上下文窗口"
                type="number"
                min="1"
                step="1"
                placeholder={`默认 ${LLM_DEFAULT_CONTEXT_WINDOW}`}
                value={contextWindow}
                onChange={(event) => setContextWindow(event.target.value)}
              />
            </label>
            <label className="grid gap-2 text-sm">
              最大输出（tokens）
              <Input
                aria-label="最大输出"
                type="number"
                min="1"
                step="1"
                placeholder={`默认 ${LLM_DEFAULT_OUTPUT_TOKENS}`}
                value={maxOutputTokens}
                onChange={(event) => setMaxOutputTokens(event.target.value)}
              />
            </label>
            <fieldset className="grid gap-2">
              <legend className="mb-2 text-sm">思考强度档位</legend>
              <div className="flex flex-wrap gap-1.5">
                {reasoningEffortLevels.map((level) => (
                  <button
                    key={level}
                    type="button"
                    aria-pressed={effortLevels.includes(level)}
                    className={cn(
                      'rounded-md border px-2 py-1 text-xs transition-colors',
                      effortLevels.includes(level)
                        ? 'border-transparent bg-accent text-accent-foreground'
                        : 'text-muted-foreground hover:bg-accent/40',
                    )}
                    onClick={() =>
                      setEffortLevels((current) =>
                        current.includes(level)
                          ? current.filter((item) => item !== level)
                          : [...current, level],
                      )
                    }
                  >
                    {level}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                未勾选时关闭思考强度选择；已勾选的档位可在对话输入框旁切换。
              </p>
            </fieldset>
            {levels.length > 0 && (
              <label className="grid gap-2 text-sm">
                默认思考强度
                <Select
                  value={levels.includes(effort as (typeof levels)[number]) ? effort : levels[0]}
                  onValueChange={setEffort}
                >
                  <SelectTrigger aria-label="默认思考强度">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {levels.map((level) => (
                      <SelectItem key={level} value={level}>
                        {level}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            )}
            {error && (
              <p className="text-xs text-destructive" role="alert">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button onClick={onClose} variant="ghost">
                取消
              </Button>
              <Button type="submit">应用</Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
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
      <div className="grid gap-10" data-setting-id="providers">
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
    <div className="grid gap-10" data-setting-id="providers">
      <SectionHeader
        action={
          <Button onClick={() => setDetail({ mode: 'create' })} size="sm" variant="secondary">
            <Plus />
            添加提供商
          </Button>
        }
        title="模型供应商"
      />
      {/* 主从两栏：左栏固定 15rem（w-60 档）承载列表，右栏是详情表单；中屏以下改为上下堆叠。 */}
      <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-6">
        <div className="grid content-start gap-1">
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
                          {provider.active && (
                            <StatusPill className="ms-auto h-5 px-2 text-[11.5px]" tone="green">
                              使用中
                            </StatusPill>
                          )}
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
  const [modelConfigs, setModelConfigs] = useState<Record<string, LlmModelSettings>>(() =>
    provider
      ? Object.fromEntries(provider.models.map((id) => [id, llmModelSettings(provider, id)]))
      : {},
  );
  const [addingModel, setAddingModel] = useState(false);
  const [editingModel, setEditingModel] = useState<string | null>(null);
  const [modelResults, setModelResults] = useState<Record<string, LlmVerifyResult | 'pending'>>({});
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const connectionVersion = useRef(0);
  const modelCheckVersion = useRef<Record<string, number>>({});
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<LlmVerifyResult | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invalidateDetection = () => {
    connectionVersion.current += 1;
    setVerifying(false);
    setVerifyResult(null);
    setModelResults({});
    setImportNotice(null);
  };

  const applyPreset = (preset: LlmProviderPreset) => {
    setPresetId(preset.id);
    setName(preset.name === '自定义' ? '' : preset.name);
    setBaseUrl(preset.baseUrl);
    setModels([...preset.models]);
    setModel(preset.models[0] ?? '');
    setModelConfigs({});
    invalidateDetection();
  };

  const addModel = (id: string) => {
    const value = id.trim();
    if (!value || models.includes(value)) return;
    if (value.length > 200) {
      setImportNotice('模型 ID 不能超过 200 个字符');
      return;
    }
    if (models.length >= LLM_MODEL_LIMIT) {
      setImportNotice('模型数量已达 64 个，请先移除部分模型');
      return;
    }
    setModels((current) => [...current, value]);
    if (!model) setModel(value);
    setModelInput('');
    setImportNotice(null);
  };

  const removeModel = (value: string) => {
    modelCheckVersion.current[value] = (modelCheckVersion.current[value] ?? 0) + 1;
    setModelConfigs((current) => {
      const next = { ...current };
      delete next[value];
      return next;
    });
    setModelResults((current) => {
      const next = { ...current };
      delete next[value];
      return next;
    });
    setModels((current) => {
      const next = current.filter((item) => item !== value);
      if (model === value) setModel(next[0] ?? '');
      return next;
    });
  };

  const importModels = (list: string[]) => {
    const merged = [...new Set([...models, ...list])];
    const imported = merged.slice(0, LLM_MODEL_LIMIT);
    setModels(imported);
    setModel(imported.includes(model) ? model : (imported[0] ?? ''));
    setImportNotice(
      merged.length > LLM_MODEL_LIMIT
        ? `模型数量过多，最多保留 64 个，${merged.length - LLM_MODEL_LIMIT} 个未导入`
        : `已导入 ${imported.length - models.length} 个模型`,
    );
  };

  const verify = async () => {
    if (!window.dela || verifying) return;
    setVerifying(true);
    setVerifyResult(null);
    const version = connectionVersion.current;
    try {
      const result = await window.dela.llm.verify({
        id: provider?.id,
        baseUrl,
        apiKey: apiKey || undefined,
      });
      if (version === connectionVersion.current) setVerifyResult(result);
    } catch (cause) {
      if (version === connectionVersion.current)
        setVerifyResult({ ok: false, message: errorText(cause) });
    } finally {
      if (version === connectionVersion.current) setVerifying(false);
    }
  };

  const verifyModel = async (id: string) => {
    if (!window.dela || modelResults[id] === 'pending') return;
    const version = connectionVersion.current;
    const modelVersion = (modelCheckVersion.current[id] ?? 0) + 1;
    modelCheckVersion.current[id] = modelVersion;
    setModelResults((current) => ({ ...current, [id]: 'pending' }));
    try {
      const result = await window.dela.llm.verifyModel({
        id: provider?.id,
        baseUrl,
        apiKey: apiKey || undefined,
        model: id,
        settings: modelConfigs[id],
      });
      if (version === connectionVersion.current && modelVersion === modelCheckVersion.current[id])
        setModelResults((current) => ({ ...current, [id]: result }));
    } catch (cause) {
      if (version === connectionVersion.current && modelVersion === modelCheckVersion.current[id])
        setModelResults((current) => ({
          ...current,
          [id]: { ok: false, message: errorText(cause) },
        }));
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
    setModelConfigs(
      Object.fromEntries(source.models.map((id) => [id, llmModelSettings(source, id)])),
    );
    invalidateDetection();
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
        modelConfigs: Object.fromEntries(
          models.map((id) => [id, modelConfigs[id] ?? { effortLevels: [] }]),
        ),
        effortLevels: [],
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
          <strong className="truncate text-base font-semibold">
            {provider?.name ?? '新建提供商'}
          </strong>
        </div>
        {provider && (
          <div className="flex shrink-0 items-center gap-2">
            {provider.active ? (
              <StatusPill className="h-5 px-2 text-[11.5px]" tone="green">
                使用中
              </StatusPill>
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
            onChange={(event) => {
              setBaseUrl(event.target.value);
              invalidateDetection();
            }}
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
            onChange={(event) => {
              setApiKey(event.target.value);
              invalidateDetection();
            }}
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
          <div className="flex items-center justify-between gap-2">
            <span>
              模型列表{' '}
              <span className="text-xs text-muted-foreground">
                {models.length} / {LLM_MODEL_LIMIT}
              </span>
            </span>
            <Button
              onClick={() => {
                setAddingModel(true);
                if (!verifyResult && !verifying) void verify();
              }}
              size="sm"
              variant="secondary"
            >
              <Plus />
              添加模型
            </Button>
          </div>
          <ul className="divide-y">
            {models.map((id) => {
              const settings = modelConfigs[id];
              const result = modelResults[id];
              return (
                <li className="grid gap-1 px-3 py-2" key={id}>
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-mono text-xs" title={id}>
                      {id}
                    </span>
                    {settings?.contextWindow && (
                      <StatusPill className="h-5 px-2 text-[11.5px]" dot={false}>
                        {Intl.NumberFormat('en', { notation: 'compact' }).format(
                          settings.contextWindow,
                        )}
                      </StatusPill>
                    )}
                    {id === model && (
                      <StatusPill className="h-5 px-2 text-[11.5px]" dot={false}>
                        默认
                      </StatusPill>
                    )}
                    <div className="flex shrink-0 items-center">
                      <Button
                        aria-label={`检测模型 ${id}`}
                        disabled={!baseUrl || result === 'pending'}
                        onClick={() => void verifyModel(id)}
                        size="icon-xs"
                        title="检测可用性"
                        variant="ghost"
                      >
                        {result === 'pending' ? (
                          <LoaderCircle className="animate-spin" />
                        ) : (
                          <PlugZap />
                        )}
                      </Button>
                      <Button
                        aria-label={`编辑模型 ${id}`}
                        onClick={() => setEditingModel(id)}
                        size="icon-xs"
                        title="编辑模型"
                        variant="ghost"
                      >
                        <Pencil />
                      </Button>
                      <Button
                        aria-label={`移除模型 ${id}`}
                        onClick={() => removeModel(id)}
                        size="icon-xs"
                        title="移除模型"
                        variant="ghost"
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </div>
                  {settings?.effortLevels?.length ? (
                    <span className="text-xs text-muted-foreground">
                      思考：{settings.effortLevels.join(' · ')}
                    </span>
                  ) : null}
                  {result && result !== 'pending' && (
                    <p
                      className={cn(
                        'text-xs [overflow-wrap:anywhere]',
                        result.ok ? 'text-success' : 'text-destructive',
                      )}
                      role="status"
                    >
                      {result.message}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
          {importNotice && (
            <p className="text-xs text-muted-foreground" role="status">
              {importNotice}
            </p>
          )}
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
        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm">可选模型</span>
            <Button
              disabled={verifying || !baseUrl}
              onClick={() => void verify()}
              size="sm"
              type="button"
              variant="secondary"
            >
              {verifying ? <LoaderCircle className="animate-spin" /> : null}
              {verifying ? '检测中…' : '检测模型'}
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
                  一键导入
                </button>
              ) : null}
            </p>
          )}
          <p className="text-xs leading-relaxed text-muted-foreground">
            列表结果不代表模型可调用，可用性请用模型行的检测按钮确认。
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
          <Button disabled={saving || !models.length} type="submit" variant="secondary">
            {saving ? '处理中…' : '保存'}
          </Button>
        </div>
      </form>
      {addingModel && (
        <Dialog.Root
          open
          onOpenChange={(open) => {
            if (!open) setAddingModel(false);
          }}
        >
          <Dialog.Portal>
            <Dialog.Overlay className={dialogOverlay} />
            <Dialog.Content className={cn(dialogPanel, 'max-h-[85vh] max-w-md overflow-y-auto')}>
              <div className="flex items-center justify-between gap-2">
                <Dialog.Title className="text-base font-semibold">添加模型</Dialog.Title>
                <Dialog.Close asChild>
                  <Button aria-label="关闭添加模型" size="icon-xs" variant="ghost">
                    <X />
                  </Button>
                </Dialog.Close>
              </div>
              <Dialog.Description className="mt-2 text-xs text-muted-foreground">
                先检测模型列表，再搜索添加；未提供列表接口时可手动输入模型 ID。
              </Dialog.Description>
              <div className="mt-4 grid gap-3">
                <Button
                  disabled={verifying || !baseUrl}
                  onClick={() => void verify()}
                  size="sm"
                  variant="secondary"
                >
                  {verifying ? <LoaderCircle className="animate-spin" /> : <Search />}{' '}
                  {verifying ? '检测中…' : '检测模型'}
                </Button>
                <Input
                  aria-label="搜索或输入模型 ID"
                  value={modelInput}
                  onChange={(event) => setModelInput(event.target.value)}
                  placeholder="搜索或输入模型 ID…"
                />
                <ul className="max-h-60 overflow-y-auto divide-y rounded-lg border">
                  {(verifyResult?.models ?? [])
                    .filter((id) => id.toLowerCase().includes(modelInput.trim().toLowerCase()))
                    .map((id) => (
                      <li className="flex min-w-0 items-center gap-2 px-3 py-2" key={id}>
                        <span className="min-w-0 flex-1 truncate font-mono text-xs" title={id}>
                          {id}
                        </span>
                        <Button
                          aria-label={`添加模型 ${id}`}
                          disabled={models.includes(id) || models.length >= LLM_MODEL_LIMIT}
                          onClick={() => addModel(id)}
                          size="icon-xs"
                          variant="ghost"
                        >
                          {models.includes(id) ? <Check /> : <Plus />}
                        </Button>
                      </li>
                    ))}
                </ul>
                {verifyResult && (
                  <p
                    className={cn('text-xs', verifyResult.ok ? 'text-success' : 'text-destructive')}
                    role="status"
                  >
                    {verifyResult.message}
                  </p>
                )}
                {importNotice && (
                  <p className="text-xs text-muted-foreground" role="status">
                    {importNotice}
                  </p>
                )}
                <div className="flex items-center justify-end gap-2">
                  {verifyResult?.models?.length ? (
                    <Button
                      onClick={() => importModels(verifyResult.models!)}
                      size="sm"
                      variant="secondary"
                    >
                      一键导入
                    </Button>
                  ) : null}
                  <Button
                    disabled={!modelInput.trim() || models.includes(modelInput.trim())}
                    onClick={() => addModel(modelInput)}
                    size="sm"
                  >
                    添加此 ID
                  </Button>
                </div>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}
      {editingModel && (
        <ModelSettingsDialog
          key={editingModel}
          model={editingModel}
          settings={modelConfigs[editingModel] ?? {}}
          onClose={() => setEditingModel(null)}
          onSave={(settings) => {
            modelCheckVersion.current[editingModel] =
              (modelCheckVersion.current[editingModel] ?? 0) + 1;
            setModelConfigs((current) => ({ ...current, [editingModel]: settings }));
            setModelResults((current) => {
              const next = { ...current };
              delete next[editingModel];
              return next;
            });
            setEditingModel(null);
          }}
        />
      )}
    </div>
  );
}
