import { useEffect, useRef, useState } from 'react';
import { Dialog } from 'radix-ui';
import { Check, LoaderCircle, Lock, Pencil, PlugZap, Plus, Search, Trash2, X } from 'lucide-react';
import { StatusPill } from '@/components/ui/beautifului/atoms/StatusPill';
import { Switch } from '@/components/ui/beautifului/atoms/Switch';
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
import { SettingsGroup } from '../SettingsGroup';
import { errorText } from '../../../workspace/store';
import { showToast } from '../../../app/toasts';
import { dialogOverlay, dialogPanel } from '../../../components/ui/motion';

type Detail = { mode: 'create' } | { mode: 'edit'; id: string };

/** 提供商首字母块（学 ZCode 的品牌位）：没有品牌图标时的身份标识。 */
function ProviderMonogram({ name, size }: { name: string; size: 'sm' | 'md' }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid shrink-0 place-items-center rounded-card bg-hover-2 font-medium text-ink-2',
        size === 'sm' ? 'size-6 text-2xs' : 'size-8 text-13',
      )}
    >
      {(name.trim()[0] ?? '新').toUpperCase()}
    </span>
  );
}

function defaultDetail(providers: LlmProviderView[]): Detail | null {
  const provider = providers.find(({ enabled }) => enabled) ?? providers[0];
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
          <Dialog.Description className="mt-2 text-xs text-ink-3">
            限制留空时沿用默认值；思考档位须由服务支持。
          </Dialog.Description>
          <form
            className="mt-4 grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <label className="grid gap-2 text-13">
              模型 ID
              <Input readOnly value={model} />
            </label>
            <label className="grid gap-2 text-13">
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
            <label className="grid gap-2 text-13">
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
              <legend className="mb-2 text-13">输入类型</legend>
              <div className="flex flex-wrap gap-1.5">
                {/* 文本输入固定开启：不是开关，是带锁的状态（学 ZCode 的 Text 锁定 chip）。 */}
                <span
                  className="flex items-center gap-1 rounded-control border border-transparent bg-hover-2 px-2 py-1 text-xs text-accent-foreground"
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
                      ? 'border-transparent bg-hover-2 text-accent-foreground'
                      : 'text-ink-3 hover:bg-hover-2',
                  )}
                  onClick={() => setVision((current) => !current)}
                >
                  视觉
                </button>
              </div>
              <p className="text-xs text-ink-3">勾选视觉表示模型可读图片；文本固定开启。</p>
            </fieldset>
            <fieldset className="grid gap-2">
              <legend className="mb-2 text-13">思考强度档位</legend>
              <div className="flex flex-wrap gap-1.5">
                {reasoningEffortLevels.map((level) => (
                  <button
                    key={level}
                    type="button"
                    aria-pressed={effortLevels.includes(level)}
                    className={cn(
                      'rounded-control border border-line px-2 py-1 text-xs transition-colors',
                      effortLevels.includes(level)
                        ? 'border-transparent bg-hover-2 text-accent-foreground'
                        : 'text-ink-3 hover:bg-hover-2',
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
              <label className="grid gap-2 text-13">
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
              <p className="text-xs text-red" role="alert">
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

  const run = async (operation: () => Promise<void>) => {
    if (!window.dela) return;
    setBusy(true);
    try {
      await operation();
      refresh();
    } catch (cause) {
      showToast({ variant: 'error', title: '供应商操作失败', description: errorText(cause) });
    } finally {
      setBusy(false);
    }
  };

  if (!window.dela) {
    return (
      <div className="grid gap-10" data-setting-id="providers">
        <SectionHeader title="模型供应商" />
        <p className="text-13 text-ink-3">模型供应商配置仅在桌面端可用。</p>
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
          <Button onClick={() => setDetail({ mode: 'create' })} size="sm">
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
                <p className="px-2 pb-1 pt-3 text-xs font-medium text-ink-3">{label}</p>
                <ul className="grid gap-0.5">
                  {items.map((provider) => {
                    const active = detail?.mode === 'edit' && detail.id === provider.id;
                    return (
                      <li key={provider.id}>
                        <button
                          aria-current={active ? 'true' : undefined}
                          className={cn(
                            'flex h-8 w-full min-w-0 items-center gap-2.5 rounded-card px-2 text-left text-13 transition-colors',
                            active
                              ? 'bg-hover font-medium text-accent-foreground'
                              : 'text-ink-2 hover:bg-hover hover:text-ink',
                          )}
                          onClick={() => setDetail({ mode: 'edit', id: provider.id })}
                          type="button"
                        >
                          <ProviderMonogram name={provider.name} size="sm" />
                          <span className="truncate">{provider.name}</span>
                          {/* 状态点：绿=启用（进入会话的模型候选），灰=停用。 */}
                          <span
                            aria-hidden="true"
                            className={cn(
                              'ms-auto size-1.5 shrink-0 rounded-full',
                              provider.enabled ? 'bg-green' : 'bg-line-strong',
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
          // 详情面板自带底色块：窄屏下两栏堆叠时，它要和上面的提供商列表分得开。
          <SettingsGroup>
            <div className="py-4">
              <ProviderDetail
                busy={busy}
                key={detailProvider?.id ?? 'create'}
                onCancelCreate={() => setDetail(defaultDetail(providers ?? []))}
                onRemove={(id) => void run(() => window.dela!.llm.remove(id))}
                onSaved={(saved) => handleSaved(saved, detail!)}
                onSetEnabled={(id, enabled) =>
                  void run(() => window.dela!.llm.setEnabled(id, enabled))
                }
                provider={detailProvider}
              />
            </div>
          </SettingsGroup>
        ) : providers?.length === 0 ? (
          <SettingsGroup>
            <p className="py-3.5 text-13 text-ink-3">还没有配置提供商。添加一个以启用对话助手。</p>
          </SettingsGroup>
        ) : null}
      </div>
      {error && (
        <p className="text-xs [overflow-wrap:anywhere] text-red" role="alert">
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
  onSetEnabled,
  provider,
}: {
  /** 切换使用中与删除进行中：与列表共用同一 busy。 */
  busy: boolean;
  onCancelCreate: () => void;
  onRemove: (id: string) => void;
  onSaved: (provider: LlmProviderView) => void;
  onSetEnabled: (id: string, enabled: boolean) => void;
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
  // 编辑态即时保存的提交快照：所有字段改动同步写这里，persist 读取它组装完整保存载荷。
  const formRef = useRef({ name, baseUrl, apiKey, models, modelConfigs });

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
    const nextModels = [...models, value];
    formRef.current.models = nextModels;
    setModels(nextModels);
    setModelInput('');
    setImportNotice(null);
    void persist();
  };

  const removeModel = (value: string) => {
    if (models.length <= 1) {
      setImportNotice('至少保留一个模型');
      return;
    }
    modelCheckVersion.current[value] = (modelCheckVersion.current[value] ?? 0) + 1;
    const nextConfigs = { ...modelConfigs };
    delete nextConfigs[value];
    formRef.current.modelConfigs = nextConfigs;
    setModelConfigs(nextConfigs);
    setModelResults((current) => {
      const next = { ...current };
      delete next[value];
      return next;
    });
    const nextModels = models.filter((item) => item !== value);
    formRef.current.models = nextModels;
    setModels(nextModels);
    void persist();
  };

  const importModels = (list: string[]) => {
    const merged = [...new Set([...models, ...list])];
    const imported = merged.slice(0, LLM_MODEL_LIMIT);
    formRef.current.models = imported;
    setModels(imported);
    setImportNotice(
      merged.length > LLM_MODEL_LIMIT
        ? `模型数量过多，最多保留 64 个，${merged.length - LLM_MODEL_LIMIT} 个未导入`
        : `已导入 ${imported.length - models.length} 个模型`,
    );
    void persist();
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
      if (version === connectionVersion.current) {
        setVerifyResult(result);
        // 检测顺带探出的真实 API 根（裸源地址补 /v1）直接采用：对话端点与它同前缀。
        if (result.baseUrl) {
          formRef.current.baseUrl = result.baseUrl;
          setBaseUrl(result.baseUrl);
          void persist();
        }
      }
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
      if (version === connectionVersion.current && modelVersion === modelCheckVersion.current[id]) {
        setModelResults((current) => ({ ...current, [id]: result }));
        if (result.baseUrl) {
          formRef.current.baseUrl = result.baseUrl;
          setBaseUrl(result.baseUrl);
          void persist();
        }
      }
    } catch (cause) {
      if (version === connectionVersion.current && modelVersion === modelCheckVersion.current[id])
        setModelResults((current) => ({
          ...current,
          [id]: { ok: false, message: errorText(cause) },
        }));
    }
  };

  /** 编辑态即时保存：整体写入当前表单；创建态不在此路径（由「保存」显式提交）。 */
  const persist = async () => {
    if (creating || !window.dela) return;
    const d = formRef.current;
    if (!d.name.trim()) {
      setError('名称不能为空');
      return;
    }
    try {
      new URL(d.baseUrl);
    } catch {
      setError('API 地址格式不正确');
      return;
    }
    setError(null);
    try {
      const saved = await window.dela.llm.save({
        id: provider.id,
        name: d.name,
        baseUrl: d.baseUrl,
        apiKey: d.apiKey || undefined,
        models: d.models,
        modelConfigs: Object.fromEntries(
          d.models.map((id) => [id, d.modelConfigs[id] ?? { effortLevels: [] }]),
        ),
        presetId: provider.presetId,
      });
      if (d.apiKey) {
        d.apiKey = '';
        setApiKey('');
      }
      onSaved(saved);
    } catch (cause) {
      showToast({ variant: 'error', title: '保存失败', description: errorText(cause) });
    }
  };

  /** 文本字段失焦时的免打扰保存：与已保存值相同就跳过，不因单纯切焦而写盘。 */
  const persistIfChanged = () => {
    if (creating) return;
    const d = formRef.current;
    if (
      d.name !== provider.name ||
      d.baseUrl.replace(/\/+$/, '') !== provider.baseUrl ||
      d.apiKey !== ''
    )
      void persist();
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
        modelConfigs: Object.fromEntries(
          models.map((id) => [id, modelConfigs[id] ?? { effortLevels: [] }]),
        ),
        presetId: provider ? provider.presetId : presetId === 'custom' ? null : presetId,
      });
      // 新建即启用；创建成功切换到该提供商的编辑态（组件按 id 重挂载，无需手动同步字段）。
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
        {creating && (
          <div className="grid gap-2 text-13">
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
        <label className="grid gap-2 text-13">
          名称
          <Input
            autoComplete="off"
            onBlur={() => persistIfChanged()}
            onChange={(event) => {
              formRef.current.name = event.target.value;
              setName(event.target.value);
            }}
            required
            value={name}
          />
        </label>
        <label className="grid gap-2 text-13">
          API 地址
          <Input
            autoComplete="off"
            onBlur={() => persistIfChanged()}
            onChange={(event) => {
              formRef.current.baseUrl = event.target.value;
              setBaseUrl(event.target.value);
              invalidateDetection();
            }}
            placeholder="https://api.example.com/v1"
            required
            type="url"
            value={baseUrl}
          />
        </label>
        <div className="grid gap-2 text-13">
          <div className="flex items-center justify-between">
            <span>API Key</span>
            {preset?.keyUrl && (
              <a
                className="text-xs text-ink-3 underline-offset-2 hover:underline"
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
            onBlur={() => persistIfChanged()}
            onChange={(event) => {
              formRef.current.apiKey = event.target.value;
              setApiKey(event.target.value);
              invalidateDetection();
            }}
            placeholder={creating ? 'sk-…' : '已保存，留空保持不变'}
            required={creating}
            type="password"
            value={apiKey}
          />
          {/* 密钥去向无法从输入框本身看出，需要就地说明。 */}
          <p className="text-xs leading-relaxed text-ink-3">
            密钥经系统加密保存在本机，不会回传页面。留空即沿用已保存的密钥。
          </p>
        </div>
        <div className="grid gap-2 text-13">
          <div className="flex items-center justify-between gap-2">
            <span>
              模型列表{' '}
              <span className="text-xs text-ink-3">
                {models.length} / {LLM_MODEL_LIMIT}
              </span>
            </span>
            <div className="flex items-center gap-2">
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
          </div>
          {verifyResult && (
            <p
              className={cn(
                'flex flex-wrap items-center gap-1.5 text-xs [overflow-wrap:anywhere]',
                verifyResult.ok ? 'text-success' : 'text-red',
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
              const settings = modelConfigs[id];
              const result = modelResults[id];
              return (
                <li className="grid gap-1 px-3 py-2" key={id}>
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-mono text-xs" title={id}>
                      {id}
                    </span>
                    {settings?.vision && (
                      <StatusPill className="h-5 px-2 text-xs" dot={false}>
                        视觉
                      </StatusPill>
                    )}
                    {settings?.contextWindow && (
                      <StatusPill className="h-5 px-2 text-xs" dot={false}>
                        {Intl.NumberFormat('en', { notation: 'compact' }).format(
                          settings.contextWindow,
                        )}
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
                    <span className="text-xs text-ink-3">
                      思考：{settings.effortLevels.join(' · ')}
                    </span>
                  ) : null}
                  {result && result !== 'pending' && (
                    <p
                      className={cn(
                        'text-xs [overflow-wrap:anywhere]',
                        result.ok ? 'text-success' : 'text-red',
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
            列表结果不代表模型可调用，可用性请用模型行的检测按钮确认。
          </p>
        </div>
        {error && (
          <p className="text-xs text-red" role="alert">
            {error}
          </p>
        )}
        {/* 创建需一次性提交（密钥与地址无法逐键生效）；编辑态全部即时保存，没有底部按钮。 */}
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
              <Dialog.Description className="mt-2 text-xs text-ink-3">
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
                <ul className="max-h-60 overflow-y-auto divide-y rounded-card border border-line">
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
                    className={cn('text-xs', verifyResult.ok ? 'text-success' : 'text-red')}
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
            const nextConfigs = { ...modelConfigs, [editingModel]: settings };
            formRef.current.modelConfigs = nextConfigs;
            setModelConfigs(nextConfigs);
            setModelResults((current) => {
              const next = { ...current };
              delete next[editingModel];
              return next;
            });
            setEditingModel(null);
            void persist();
          }}
        />
      )}
    </div>
  );
}
