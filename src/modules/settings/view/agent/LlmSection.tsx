import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Lock, Pencil, PlugZap, Plus, Search, Trash2 } from 'lucide-react';
import { StatusPill } from '../../../../ui/status-pill';
import { Switch } from '../../../../ui/switch';
import { Button } from '../../../../ui/button';
import { Card } from '../../../../ui/card';
import { Input } from '../../../../ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../ui/select';
import { cn } from '../../../../ui/cn';
import type {
  LlmCatalogModel,
  LlmCatalogProvider,
  LlmModelSettings,
  LlmProviderView,
  LlmVerifyInput,
  LlmVerifyResult,
} from '../../../../core/protocol/llm';
import {
  reasoningEffortLevels,
  llmModelSettings,
  LLM_MODEL_LIMIT,
  LLM_DEFAULT_CONTEXT_WINDOW,
  LLM_DEFAULT_OUTPUT_TOKENS,
} from '../../../../core/protocol/llm-models';
import { SectionHeader } from '../SectionHeader';
import { SettingsGroup } from '../SettingsGroup';
import { showToast } from '../../../../ui/toast';
import { ErrorText } from '../../../../ui/alert';
import { Spinner } from '../../../../ui/spinner';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../../../ui/dialog';
import { Field } from '../../../../ui/field';
import { llmClient } from '../../../chat/view';
import { errorMessage } from '../../../../core/protocol/contract';

type Detail = { mode: 'create' } | { mode: 'edit'; id: string };

function ProviderMonogram({ name, size }: { name: string; size: 'sm' | 'md' }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid shrink-0 place-items-center rounded-card bg-fill font-medium text-ink-2',
        size === 'sm' ? 'size-6 text-xs' : 'size-8 text-sm',
      )}
    >
      {(name.trim()[0] ?? '新').toUpperCase()}
    </span>
  );
}

const CUSTOM = 'custom';

const compactTokens = (tokens: number) =>
  Intl.NumberFormat('en', { notation: 'compact' }).format(tokens);

function defaultDetail(providers: LlmProviderView[]): Detail | null {
  const provider = providers.find(({ enabled }) => enabled) ?? providers[0];
  return provider ? { mode: 'edit', id: provider.id } : null;
}

interface ModelDialogProps {
  model: string;
  settings: LlmModelSettings;
  onClose: () => void;
  onSave: (settings: LlmModelSettings) => void;
}

/** 内置厂商的模型参数随 Pi 目录，只能选默认思考强度；自定义服务的模型参数全部可编辑。 */
function ModelSettingsDialog({
  catalogModel,
  ...props
}: ModelDialogProps & { catalogModel: LlmCatalogModel | undefined }) {
  return catalogModel ? (
    <CatalogModelDialog
      model={catalogModel}
      effort={props.settings.effort}
      onClose={props.onClose}
      onSave={props.onSave}
    />
  ) : (
    <CustomModelDialog {...props} />
  );
}

function CustomModelDialog({ model, settings, onClose, onSave }: ModelDialogProps) {
  const [contextWindow, setContextWindow] = useState(settings.contextWindow?.toString() ?? '');
  const [maxOutputTokens, setMaxOutputTokens] = useState(
    settings.maxOutputTokens?.toString() ?? '',
  );
  const [effortLevels, setEffortLevels] = useState(settings.effortLevels ?? []);
  const [effort, setEffort] = useState(settings.effort ?? settings.effortLevels?.[0] ?? '');
  const [vision, setVision] = useState(settings.vision ?? false);
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
      ...(vision ? { vision: true } : {}),
      effortLevels: levels,
      ...(levels.length
        ? { effort: levels.includes(effort as (typeof levels)[number]) ? effort : levels[0] }
        : {}),
    });
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent size="lg" scroll>
        <DialogHeader>
          <DialogTitle>编辑模型设置</DialogTitle>
          <DialogClose aria-label="关闭模型设置" />
        </DialogHeader>
        <DialogDescription>限制留空时沿用默认值；思考档位须由服务支持。</DialogDescription>
        <form
          className="mt-4 grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <Field label="模型 ID">
            <Input readOnly value={model} />
          </Field>
          <Field label="上下文窗口（tokens）">
            <Input
              aria-label="上下文窗口"
              type="number"
              min="1"
              step="1"
              placeholder={`默认 ${LLM_DEFAULT_CONTEXT_WINDOW}`}
              value={contextWindow}
              onChange={(event) => setContextWindow(event.target.value)}
            />
          </Field>
          <Field label="最大输出（tokens）">
            <Input
              aria-label="最大输出"
              type="number"
              min="1"
              step="1"
              placeholder={`默认 ${LLM_DEFAULT_OUTPUT_TOKENS}`}
              value={maxOutputTokens}
              onChange={(event) => setMaxOutputTokens(event.target.value)}
            />
          </Field>
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm">输入类型</legend>
            <div className="flex flex-wrap gap-1.5">
              <span
                className="flex items-center gap-1 rounded-control border border-transparent bg-selected px-2 py-1 text-xs text-ink"
                title="文本输入固定开启"
              >
                文本
                <Lock aria-hidden="true" className="size-3" />
              </span>
              <button
                type="button"
                aria-pressed={vision}
                className={cn(
                  'rounded-control border border-line px-2 py-1 text-xs transition-colors',
                  vision
                    ? 'border-transparent bg-selected text-ink'
                    : 'text-ink-3 hover:bg-hover-strong',
                )}
                onClick={() => setVision((current) => !current)}
              >
                视觉
              </button>
            </div>
            <p className="text-xs text-ink-3">勾选视觉表示模型可读图片；文本固定开启。</p>
          </fieldset>
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm">思考强度档位</legend>
            <div className="flex flex-wrap gap-1.5">
              {reasoningEffortLevels.map((level) => (
                <button
                  key={level}
                  type="button"
                  aria-pressed={effortLevels.includes(level)}
                  className={cn(
                    'rounded-control border border-line px-2 py-1 text-xs transition-colors',
                    effortLevels.includes(level)
                      ? 'border-transparent bg-selected text-ink'
                      : 'text-ink-3 hover:bg-hover-strong',
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
            <p className="text-xs text-ink-3">
              未勾选时关闭思考强度选择；已勾选的档位可在对话输入框旁切换。
            </p>
          </fieldset>
          {levels.length > 0 && (
            <Field label="默认思考强度">
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
            </Field>
          )}
          {error && <ErrorText>{error}</ErrorText>}
          <div className="flex justify-end gap-2">
            <Button onClick={onClose} variant="ghost">
              取消
            </Button>
            <Button type="submit">应用</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CatalogModelDialog({
  model,
  effort: initialEffort,
  onClose,
  onSave,
}: {
  model: LlmCatalogModel;
  effort: string | undefined;
  onClose: () => void;
  onSave: (settings: LlmModelSettings) => void;
}) {
  const levels = model.effortLevels;
  const [effort, setEffort] = useState(
    initialEffort && levels.includes(initialEffort) ? initialEffort : (levels[0] ?? ''),
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{model.name}</DialogTitle>
          <DialogClose aria-label="关闭模型设置" />
        </DialogHeader>
        <DialogDescription>
          上下文 {compactTokens(model.contextWindow)} · 最大输出{' '}
          {compactTokens(model.maxOutputTokens)}
          {model.vision ? ' · 支持图片' : ''}。参数来自 Pi 模型目录。
        </DialogDescription>
        <form
          className="mt-4 grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            onSave({ effortLevels: levels, ...(effort ? { effort } : {}) });
          }}
        >
          {levels.length > 0 ? (
            <Field label="默认思考强度">
              <Select value={effort} onValueChange={setEffort}>
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
            </Field>
          ) : (
            <p className="text-sm text-ink-3">这个模型不支持调节思考强度。</p>
          )}
          <div className="flex justify-end gap-2">
            <Button onClick={onClose} variant="ghost">
              取消
            </Button>
            <Button disabled={levels.length === 0} type="submit">
              应用
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function LlmSection() {
  const queryClient = useQueryClient();
  const providerList = useQuery({
    queryKey: ['llm', 'providers'],
    queryFn: () => llmClient.list(),
    enabled: Boolean(window.dela),
  });
  const catalogList = useQuery({
    queryKey: ['llm', 'catalog'],
    queryFn: () => llmClient.catalog(),
    enabled: Boolean(window.dela),
  });
  const providers = providerList.data;
  const catalog = catalogList.data ?? [];
  const loadError = providerList.error ?? catalogList.error;
  const [selection, setSelection] = useState<Detail | null>(null);
  const [busy, setBusy] = useState(false);

  // 没有选择，或所选提供商已不在列表（首次加载、删除后），回落到当前使用中的提供商。
  const detail =
    selection && (selection.mode === 'create' || providers?.some(({ id }) => id === selection.id))
      ? selection
      : defaultDetail(providers ?? []);

  const run = async (operation: () => Promise<void>) => {
    if (!window.dela) return;
    setBusy(true);
    setSelection(detail);
    try {
      await operation();
      void queryClient.invalidateQueries({ queryKey: ['llm', 'providers'] });
    } catch (cause) {
      showToast({ variant: 'error', title: '供应商操作失败', description: errorMessage(cause) });
    }
    setBusy(false);
  };

  if (!window.dela) {
    return (
      <div className="grid gap-10" data-setting-id="providers">
        <SectionHeader title="模型服务" />
        <p className="text-sm text-ink-3">模型服务配置仅在桌面端可用。</p>
      </div>
    );
  }

  const selected =
    detail?.mode === 'edit' ? ((providers ?? []).find(({ id }) => id === detail.id) ?? null) : null;
  const detailProvider = detail?.mode === 'create' ? null : selected;
  const detailOpen = detail?.mode === 'create' || selected !== null;
  const groups = [
    { label: '内置厂商', items: (providers ?? []).filter(({ piProvider }) => piProvider) },
    { label: '自定义', items: (providers ?? []).filter(({ piProvider }) => !piProvider) },
  ];

  /** 保存结果并入列表；只有仍停留在本次保存的详情时才切到保存后的提供商。 */
  const handleSaved = (saved: LlmProviderView, source: Detail | null) => {
    queryClient.setQueryData<LlmProviderView[]>(['llm', 'providers'], (current) =>
      current?.some(({ id }) => id === saved.id)
        ? current.map((item) => (item.id === saved.id ? saved : item))
        : [...(current ?? []), saved],
    );
    setSelection((current) => (current === source ? { mode: 'edit', id: saved.id } : current));
    void queryClient.invalidateQueries({ queryKey: ['llm', 'providers'] });
  };

  return (
    <div className="grid gap-10" data-setting-id="providers">
      <SectionHeader
        action={
          <Button onClick={() => setSelection({ mode: 'create' })} size="sm">
            <Plus />
            添加提供商
          </Button>
        }
        title="模型服务"
      />
      <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-6">
        <div className="grid content-start gap-1">
          {groups.map(({ label, items }) =>
            items.length ? (
              <div className="grid" key={label}>
                <p className="px-2 pb-1 pt-3 text-xs font-medium text-ink-3">{label}</p>
                <ul className="grid gap-0.5">
                  {items.map((provider) => {
                    const active = detail?.mode === 'edit' && detail.id === provider.id;
                    return (
                      <li key={provider.id}>
                        <button
                          aria-current={active ? 'true' : undefined}
                          className={cn(
                            'flex h-8 w-full min-w-0 items-center gap-2.5 rounded-card px-2 text-left text-sm transition-colors',
                            active
                              ? 'bg-hover font-medium text-ink'
                              : 'text-ink-2 hover:bg-hover hover:text-ink',
                          )}
                          onClick={() => setSelection({ mode: 'edit', id: provider.id })}
                          type="button"
                        >
                          <ProviderMonogram name={provider.name} size="sm" />
                          <span className="truncate">{provider.name}</span>
                          <span
                            aria-hidden="true"
                            className={cn(
                              'ms-auto size-1.5 shrink-0 rounded-full',
                              provider.enabled ? 'bg-success' : 'bg-line-strong',
                            )}
                          />
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
          <SettingsGroup>
            <div className="py-4">
              <ProviderDetail
                busy={busy}
                catalog={catalog}
                key={detailProvider?.id ?? 'create'}
                onCancelCreate={() => setSelection(null)}
                onRemove={(id) => void run(() => llmClient.remove(id))}
                onSaved={(saved) => handleSaved(saved, selection)}
                onSetEnabled={(id, enabled) =>
                  void run(() => llmClient.setEnabled({ id, enabled }))
                }
                provider={detailProvider}
              />
            </div>
          </SettingsGroup>
        ) : providers?.length === 0 ? (
          <SettingsGroup>
            <p className="py-3.5 text-sm text-ink-3">还没有配置提供商。添加一个以启用对话助手。</p>
          </SettingsGroup>
        ) : null}
      </div>
      {loadError && <ErrorText>{errorMessage(loadError)}</ErrorText>}
    </div>
  );
}

function ProviderDetail({
  busy,
  catalog,
  onCancelCreate,
  onRemove,
  onSaved,
  onSetEnabled,
  provider,
}: {
  busy: boolean;
  catalog: LlmCatalogProvider[];
  onCancelCreate: () => void;
  onRemove: (id: string) => void;
  onSaved: (provider: LlmProviderView) => void;
  onSetEnabled: (id: string, enabled: boolean) => void;
  provider: LlmProviderView | null;
}) {
  const creating = provider === null;
  const [piProvider, setPiProvider] = useState<string | null>(provider?.piProvider ?? null);
  const vendor = catalog.find(({ id }) => id === piProvider);
  const [name, setName] = useState(provider?.name ?? '');
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? '');
  const [apiKey, setApiKey] = useState('');
  const [models, setModels] = useState<string[]>(provider ? [...provider.models] : []);
  const [modelInput, setModelInput] = useState('');
  const [modelConfigs, setModelConfigs] = useState<Record<string, LlmModelSettings>>(() =>
    provider
      ? Object.fromEntries(provider.models.map((id) => [id, llmModelSettings(provider, id)]))
      : {},
  );
  const [addingModel, setAddingModel] = useState(false);
  const [editingModel, setEditingModel] = useState<string | null>(null);
  // result 为 null 表示检测中；带上检测时的输入，这些输入变了就不再接收结果。
  const [modelChecks, setModelChecks] = useState<
    Record<
      string,
      {
        baseUrl: string;
        apiKey: string;
        settings: LlmModelSettings | undefined;
        result: LlmVerifyResult | null;
      }
    >
  >({});
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const verifyConnection = useMutation({
    mutationFn: (input: LlmVerifyInput) =>
      llmClient
        .verify(input)
        .catch((cause): LlmVerifyResult => ({ ok: false, message: errorMessage(cause) })),
  });
  const verifying = verifyConnection.isPending;
  const verifyResult = verifyConnection.data ?? null;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = { name, baseUrl, apiKey, models, modelConfigs };

  const invalidateDetection = () => {
    verifyConnection.reset();
    setModelChecks({});
    setImportNotice(null);
  };

  const chooseVendor = (id: string) => {
    const next = catalog.find((item) => item.id === id);
    setPiProvider(next?.id ?? null);
    setName(next?.name ?? '');
    setBaseUrl('');
    setModels(next?.models[0] ? [next.models[0].id] : []);
    setModelConfigs({});
    invalidateDetection();
  };

  const payload = (next: typeof form) => ({
    id: provider?.id,
    name: next.name,
    ...(piProvider ? {} : { baseUrl: next.baseUrl }),
    apiKey: next.apiKey || undefined,
    models: next.models,
    modelConfigs: Object.fromEntries(
      next.models.map((id) => [id, next.modelConfigs[id] ?? { effortLevels: [] }]),
    ),
    piProvider,
  });

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
    const nextModels = [...models, value];
    setModels(nextModels);
    setModelInput('');
    setImportNotice(null);
    void persist({ models: nextModels });
  };

  const removeModel = (value: string) => {
    if (models.length <= 1) {
      setImportNotice('至少保留一个模型');
      return;
    }
    const nextConfigs = { ...modelConfigs };
    delete nextConfigs[value];
    setModelConfigs(nextConfigs);
    setModelChecks((current) => {
      const rest = { ...current };
      delete rest[value];
      return rest;
    });
    const nextModels = models.filter((item) => item !== value);
    setModels(nextModels);
    void persist({ models: nextModels, modelConfigs: nextConfigs });
  };

  const importModels = (list: string[]) => {
    const merged = [...new Set([...models, ...list])];
    const imported = merged.slice(0, LLM_MODEL_LIMIT);
    setModels(imported);
    setImportNotice(
      merged.length > LLM_MODEL_LIMIT
        ? `模型数量过多，最多保留 64 个，${merged.length - LLM_MODEL_LIMIT} 个未导入`
        : `已导入 ${imported.length - models.length} 个模型`,
    );
    void persist({ models: imported });
  };

  /** 检测顺带探出的真实 API 根（裸源地址补 /v1）直接采用：对话端点与它同前缀。 */
  const adoptApiBase = (discovered: string) => {
    setBaseUrl(discovered);
    void persist({ baseUrl: discovered });
  };

  const verify = () => {
    if (!window.dela || verifying) return;
    verifyConnection.mutate(
      { id: provider?.id, baseUrl, apiKey: apiKey || undefined },
      { onSuccess: (result) => result.baseUrl && adoptApiBase(result.baseUrl) },
    );
  };

  const verifyModel = async (id: string) => {
    if (!window.dela || modelChecks[id]?.result === null) return;
    const inputs = { baseUrl, apiKey, settings: modelConfigs[id] };
    setModelChecks((current) => ({ ...current, [id]: { ...inputs, result: null } }));
    const request = {
      id: provider?.id,
      piProvider,
      baseUrl: piProvider ? undefined : baseUrl,
      apiKey: apiKey || undefined,
      model: id,
      settings: inputs.settings,
    };
    let result: LlmVerifyResult;
    try {
      result = await llmClient.verifyModel(request);
    } catch (cause) {
      result = { ok: false, message: errorMessage(cause) };
    }
    setModelChecks((current) => {
      const check = current[id];
      const stillPending =
        check?.result === null &&
        check.baseUrl === inputs.baseUrl &&
        check.apiKey === inputs.apiKey &&
        check.settings === inputs.settings;
      return stillPending ? { ...current, [id]: { ...check, result } } : current;
    });
    if (result.baseUrl) adoptApiBase(result.baseUrl);
  };

  /** 编辑态即时保存：整体写入当前表单，next 覆盖尚未渲染出来的最新改动；创建态由「保存」显式提交。 */
  const persist = async (next: Partial<typeof form> = {}) => {
    if (creating || !window.dela) return;
    const d = { ...form, ...next };
    if (!d.name.trim()) {
      setError('名称不能为空');
      return;
    }
    if (!piProvider && !URL.canParse(d.baseUrl)) {
      setError('API 地址格式不正确');
      return;
    }
    setError(null);
    try {
      const saved = await llmClient.save(payload(d));
      if (d.apiKey) setApiKey((current) => (current === d.apiKey ? '' : current));
      onSaved(saved);
    } catch (cause) {
      showToast({ variant: 'error', title: '保存失败', description: errorMessage(cause) });
    }
  };

  /** 文本字段失焦时的免打扰保存：与已保存值相同就跳过，不因单纯切焦而写盘。 */
  const persistIfChanged = () => {
    if (creating) return;
    if (name !== provider.name || baseUrl.replace(/\/+$/, '') !== provider.baseUrl || apiKey !== '')
      void persist();
  };

  const save = async () => {
    if (!window.dela || saving) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await llmClient.save(payload(form));
      // 新建即启用；创建成功切换到该提供商的编辑态（组件按 id 重挂载，无需手动同步字段）。
      onSaved(saved);
    } catch (cause) {
      setError(errorMessage(cause));
    }
    setSaving(false);
  };

  return (
    <div className="grid content-start gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <ProviderMonogram name={provider?.name ?? name} size="md" />
          <strong className="truncate text-base font-semibold">
            {provider?.name ?? '新建提供商'}
          </strong>
        </div>
        {provider && (
          <div className="flex shrink-0 items-center gap-2">
            <Switch
              checked={provider.enabled}
              disabled={busy}
              label={provider.enabled ? `停用 ${provider.name}` : `启用 ${provider.name}`}
              onChange={(enabled) => onSetEnabled(provider.id, enabled)}
            />
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
          if (creating) void save();
          else void persist();
        }}
      >
        {creating ? (
          <div className="grid gap-2 text-sm">
            厂商
            <Select onValueChange={chooseVendor} value={piProvider ?? CUSTOM}>
              <SelectTrigger aria-label="厂商">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={CUSTOM}>自定义（OpenAI 兼容）</SelectItem>
                {catalog.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs leading-relaxed text-ink-3">
              内置厂商的协议与模型参数由 Pi 识别，目录定期从 pi.dev
              更新；列表里没有的服务选「自定义」。
            </p>
          </div>
        ) : piProvider ? (
          <p className="text-xs text-ink-3 [overflow-wrap:anywhere]">
            {vendor?.name ?? piProvider} · {provider.baseUrl}
          </p>
        ) : null}
        <Field label="名称">
          <Input
            autoComplete="off"
            onBlur={() => persistIfChanged()}
            onChange={(event) => {
              setName(event.target.value);
            }}
            required
            value={name}
          />
        </Field>
        {!piProvider && (
          <Field label="API 地址">
            <Input
              autoComplete="off"
              onBlur={() => persistIfChanged()}
              onChange={(event) => {
                setBaseUrl(event.target.value);
                invalidateDetection();
              }}
              placeholder="https://api.example.com/v1"
              required
              type="url"
              value={baseUrl}
            />
          </Field>
        )}
        <div className="grid gap-2 text-sm">
          <span>API Key</span>
          <Input
            autoComplete="off"
            onBlur={() => persistIfChanged()}
            onChange={(event) => {
              setApiKey(event.target.value);
              invalidateDetection();
            }}
            placeholder={creating ? 'sk-…' : '已保存，留空保持不变'}
            required={creating}
            type="password"
            value={apiKey}
          />
          <p className="text-xs leading-relaxed text-ink-3">
            密钥经系统加密保存在本机，不会回传页面。留空即沿用已保存的密钥。
          </p>
        </div>
        <div className="grid gap-2 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span>
              模型列表{' '}
              <span className="text-xs text-ink-3">
                {models.length} / {LLM_MODEL_LIMIT}
              </span>
            </span>
            <div className="flex items-center gap-2">
              {!piProvider && (
                <Button
                  disabled={verifying || !baseUrl}
                  onClick={verify}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  {verifying ? <Spinner /> : null}
                  {verifying ? '检测中…' : '检测模型'}
                </Button>
              )}
              <Button
                disabled={piProvider !== null && !vendor}
                onClick={() => {
                  setAddingModel(true);
                  if (!piProvider && !verifyResult && !verifying) verify();
                }}
                size="sm"
                variant="secondary"
              >
                <Plus />
                添加模型
              </Button>
            </div>
          </div>
          {verifyResult && (
            <p
              className={cn(
                'flex flex-wrap items-center gap-1.5 text-xs [overflow-wrap:anywhere]',
                verifyResult.ok ? 'text-success' : 'text-danger',
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
          <ul className="divide-y">
            {models.map((id) => {
              const catalogModel = vendor?.models.find((model) => model.id === id);
              const settings = catalogModel
                ? {
                    ...modelConfigs[id],
                    vision: catalogModel.vision,
                    contextWindow: catalogModel.contextWindow,
                  }
                : modelConfigs[id];
              const check = modelChecks[id];
              const result = check ? (check.result ?? 'pending') : undefined;
              return (
                <li className="grid gap-1 px-3 py-2" key={id}>
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="min-w-0 flex-1 truncate font-mono text-xs"
                      title={catalogModel?.name ?? id}
                    >
                      {id}
                    </span>
                    {vendor && !catalogModel && (
                      <StatusPill dot={false} size="sm">
                        已下架
                      </StatusPill>
                    )}
                    {settings?.vision && (
                      <StatusPill dot={false} size="sm">
                        视觉
                      </StatusPill>
                    )}
                    {settings?.contextWindow && (
                      <StatusPill dot={false} size="sm">
                        {compactTokens(settings.contextWindow)}
                      </StatusPill>
                    )}
                    <div className="flex shrink-0 items-center">
                      <Button
                        aria-label={`检测模型 ${id}`}
                        disabled={(!piProvider && !baseUrl) || result === 'pending'}
                        onClick={() => void verifyModel(id)}
                        size="icon-xs"
                        title="检测可用性"
                        variant="ghost"
                      >
                        {result === 'pending' ? <Spinner size="sm" /> : <PlugZap />}
                      </Button>
                      <Button
                        aria-label={`编辑模型 ${id}`}
                        disabled={piProvider !== null && !catalogModel}
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
                    <span className="text-xs text-ink-3">
                      思考：{settings.effortLevels.join(' · ')}
                      {catalogModel && settings.effort ? `（默认 ${settings.effort}）` : ''}
                    </span>
                  ) : null}
                  {result && result !== 'pending' && (
                    <p
                      className={cn(
                        'text-xs [overflow-wrap:anywhere]',
                        result.ok ? 'text-success' : 'text-danger',
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
            <p className="text-xs text-ink-3" role="status">
              {importNotice}
            </p>
          )}
          <p className="text-xs leading-relaxed text-ink-3">
            {piProvider
              ? '模型目录随 Pi 更新；目录里没有的模型请改用「自定义」服务接入。'
              : '列表结果不代表模型可调用，可用性请用模型行的检测按钮确认。'}
          </p>
        </div>
        {error && <ErrorText>{error}</ErrorText>}
        {creating && (
          <div className="flex items-center justify-end gap-2">
            <Button onClick={onCancelCreate} variant="ghost">
              取消
            </Button>
            <Button disabled={saving || !models.length} type="submit">
              {saving ? '处理中…' : '保存'}
            </Button>
          </div>
        )}
      </form>
      {addingModel && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setAddingModel(false);
          }}
        >
          <DialogContent scroll>
            <DialogHeader>
              <DialogTitle>添加模型</DialogTitle>
              <DialogClose aria-label="关闭添加模型" />
            </DialogHeader>
            <DialogDescription>
              {vendor
                ? `从 ${vendor.name} 的模型目录中选择。`
                : '先检测模型列表，再搜索添加；未提供列表接口时可手动输入模型 ID。'}
            </DialogDescription>
            {vendor ? (
              <div className="mt-4 grid gap-3">
                <Input
                  aria-label="搜索模型"
                  value={modelInput}
                  onChange={(event) => setModelInput(event.target.value)}
                  placeholder="搜索模型…"
                />
                <Card asChild className="max-h-72 divide-y overflow-y-auto">
                  <ul>
                    {vendor.models
                      .filter((model) =>
                        `${model.id} ${model.name}`
                          .toLowerCase()
                          .includes(modelInput.trim().toLowerCase()),
                      )
                      .map((model) => (
                        <li className="flex min-w-0 items-center gap-2 px-3 py-2" key={model.id}>
                          <span className="grid min-w-0 flex-1">
                            <span className="truncate text-sm">{model.name}</span>
                            <span className="truncate font-mono text-xs text-ink-3">
                              {model.id} · {compactTokens(model.contextWindow)}
                              {model.vision ? ' · 视觉' : ''}
                            </span>
                          </span>
                          <Button
                            aria-label={`添加模型 ${model.id}`}
                            disabled={models.includes(model.id) || models.length >= LLM_MODEL_LIMIT}
                            onClick={() => addModel(model.id)}
                            size="icon-xs"
                            variant="ghost"
                          >
                            {models.includes(model.id) ? <Check /> : <Plus />}
                          </Button>
                        </li>
                      ))}
                  </ul>
                </Card>
                {importNotice && (
                  <p className="text-xs text-ink-3" role="status">
                    {importNotice}
                  </p>
                )}
              </div>
            ) : (
              <div className="mt-4 grid gap-3">
                <Button
                  disabled={verifying || !baseUrl}
                  onClick={verify}
                  size="sm"
                  variant="secondary"
                >
                  {verifying ? <Spinner /> : <Search />} {verifying ? '检测中…' : '检测模型'}
                </Button>
                <Input
                  aria-label="搜索或输入模型 ID"
                  value={modelInput}
                  onChange={(event) => setModelInput(event.target.value)}
                  placeholder="搜索或输入模型 ID…"
                />
                <Card asChild className="max-h-60 divide-y overflow-y-auto">
                  <ul>
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
                </Card>
                {verifyResult && (
                  <p
                    className={cn('text-xs', verifyResult.ok ? 'text-success' : 'text-danger')}
                    role="status"
                  >
                    {verifyResult.message}
                  </p>
                )}
                {importNotice && (
                  <p className="text-xs text-ink-3" role="status">
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
            )}
          </DialogContent>
        </Dialog>
      )}
      {editingModel && (
        <ModelSettingsDialog
          key={editingModel}
          catalogModel={vendor?.models.find((model) => model.id === editingModel)}
          model={editingModel}
          settings={modelConfigs[editingModel] ?? {}}
          onClose={() => setEditingModel(null)}
          onSave={(settings) => {
            const nextConfigs = { ...modelConfigs, [editingModel]: settings };
            setModelConfigs(nextConfigs);
            setModelChecks((current) => {
              const rest = { ...current };
              delete rest[editingModel];
              return rest;
            });
            setEditingModel(null);
            void persist({ modelConfigs: nextConfigs });
          }}
        />
      )}
    </div>
  );
}
