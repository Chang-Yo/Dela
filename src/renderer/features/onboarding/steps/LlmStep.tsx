import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  CircleCheck,
  CircleX,
  ExternalLink,
  Eye,
  EyeOff,
  ListPlus,
  Loader2,
  PlugZap,
} from 'lucide-react';
import { DesktopOnlyNotice } from '../../../components/ui/desktop-only-notice';
import { SelectItem } from '../../../components/ui/select';
import { errorText } from '../../../workspace/store';
import { StepButton, StepInput, StepSelect, type StepButtonState } from './step-controls';
import { StepGuide } from './step-guide';
import { StepModelImportDialog } from './step-model-import';
import { capModels } from './model-import';
import { llmProviderPresets, findLlmPreset } from '../../../../shared/llm-presets';
import type { LlmVerifyResult } from '../../../../shared/api';

/** 向导 · 模型服务步骤：选预设或自定义 OpenAI 兼容服务，可先检测连通性并导入模型列表。 */
export function LlmStep({ onDone }: { onDone: () => void }) {
  const [presetId, setPresetId] = useState(llmProviderPresets[0]!.id);
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState(llmProviderPresets[0]!.baseUrl);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [models, setModels] = useState<string[]>([...llmProviderPresets[0]!.models]);
  const [model, setModel] = useState(llmProviderPresets[0]!.models[0] ?? '');
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyResult, setVerifyResult] = useState<LlmVerifyResult | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [state, setState] = useState<StepButtonState>('idle');
  const [error, setError] = useState<string | null>(null);

  if (!window.dela) {
    return (
      <DesktopOnlyNotice
        description="模型服务的凭据不会暴露给浏览器。"
        title="模型服务仅在 Dela 桌面端可用"
      />
    );
  }

  const custom = presetId === 'custom';
  const preset = findLlmPreset(presetId)!;
  const effectiveBaseUrl = custom ? baseUrl.trim() : preset.baseUrl;

  const detected = verifyResult?.ok ? (verifyResult.models ?? []) : [];

  const applyPreset = (id: string) => {
    const next = findLlmPreset(id)!;
    setPresetId(id);
    setName('');
    setBaseUrl(next.baseUrl);
    setModels([...next.models]);
    setModel(next.models[0] ?? '');
    setVerifyResult(null);
    setImportOpen(false);
    setImportNotice(null);
  };

  /** 检测只验证连通性并报出模型数量；哪些模型进配置由用户在弹层里勾选。 */
  const verify = async () => {
    if (!window.dela || verifyBusy || !effectiveBaseUrl) return;
    setVerifyBusy(true);
    setVerifyResult(null);
    setImportNotice(null);
    try {
      setVerifyResult(
        await window.dela.llm.verify({ baseUrl: effectiveBaseUrl, apiKey: apiKey || undefined }),
      );
    } catch (cause) {
      setVerifyResult({ ok: false, message: errorText(cause) });
    } finally {
      setVerifyBusy(false);
    }
  };

  const importModels = (picked: string[]) => {
    const { models: next, notice } = capModels(picked);
    setModels(next);
    setModel(next.includes(model) ? model : (next[0] ?? ''));
    setImportNotice(notice);
    setImportOpen(false);
  };

  const save = async () => {
    if (state === 'success') return onDone();
    if (state === 'busy' || !window.dela || !model) return;
    setState('busy');
    setError(null);
    try {
      // 引导里选的模型排到列表首位：还没有会话可以沿用时，新会话取第一个可用提供商的首个模型。
      await window.dela.llm.save({
        name: custom ? name.trim() : preset.name,
        baseUrl: effectiveBaseUrl,
        apiKey: apiKey || undefined,
        models: [model, ...models.filter((item) => item !== model)],
        presetId: custom ? null : presetId,
      });
      setState('success');
    } catch (cause) {
      setError(errorText(cause));
      setState('idle');
    }
  };

  return (
    <form
      className="grid gap-7"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <header className="grid gap-2">
        <h2 className="text-2xl font-semibold tracking-tight">配置模型服务</h2>
        <p className="text-13 leading-relaxed text-ink-3">
          选择服务商或自定义 OpenAI 兼容端点，密钥加密保存于本机。
        </p>
      </header>
      <StepGuide
        steps={[
          {
            title: '选择服务商',
            content: (
              <div className="grid gap-4">
                <StepSelect label="服务商" onValueChange={applyPreset} value={presetId}>
                  {llmProviderPresets.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </StepSelect>
                <AnimatePresence initial={false}>
                  {custom && (
                    <motion.div
                      animate={{ height: 'auto', opacity: 1 }}
                      className="overflow-hidden"
                      exit={{ height: 0, opacity: 0 }}
                      initial={{ height: 0, opacity: 0 }}
                      key="custom-fields"
                      transition={{ duration: 0.22, ease: 'easeOut' }}
                    >
                      <div className="grid gap-4">
                        <label className="grid gap-2">
                          <span className="text-13 font-medium text-ink-2">名称</span>
                          <StepInput
                            autoComplete="off"
                            onChange={(event) => setName(event.target.value)}
                            placeholder="给这个服务起个名字"
                            required
                            value={name}
                          />
                        </label>
                        <label className="grid gap-2">
                          <span className="text-13 font-medium text-ink-2">API 地址</span>
                          <StepInput
                            autoComplete="off"
                            onChange={(event) => setBaseUrl(event.target.value)}
                            placeholder="https://api.example.com/v1"
                            required
                            value={baseUrl}
                          />
                        </label>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ),
          },
          {
            title: '填写密钥并检测',
            content: (
              <div className="grid gap-2.5">
                {preset.keyUrl && (
                  <div className="flex justify-end">
                    <a
                      className="flex items-center gap-1 text-xs text-ink-3 transition-colors hover:text-ink"
                      href={preset.keyUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      获取密钥
                      <ExternalLink className="size-3" aria-hidden="true" />
                    </a>
                  </div>
                )}
                <div className="relative">
                  <StepInput
                    aria-label="API Key"
                    autoComplete="off"
                    className="pr-16"
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder="sk-…"
                    required
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                  />
                  <div className="absolute inset-y-0 right-0.5 flex items-center gap-1">
                    <button
                      aria-label="检测连接"
                      className="grid size-7 place-items-center rounded-control text-ink-3 transition-colors hover:bg-hover hover:text-ink-2 disabled:cursor-not-allowed disabled:opacity-40"
                      disabled={verifyBusy || !effectiveBaseUrl}
                      onClick={() => void verify()}
                      title="检测连接"
                      type="button"
                    >
                      {verifyBusy ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <PlugZap className="size-4" aria-hidden="true" />
                      )}
                    </button>
                    <button
                      aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}
                      className="grid size-7 place-items-center rounded-control text-ink-3 transition-colors hover:bg-hover hover:text-ink-2"
                      onClick={() => setShowKey((value) => !value)}
                      title={showKey ? '隐藏 API Key' : '显示 API Key'}
                      type="button"
                    >
                      {showKey ? (
                        <EyeOff className="size-4" aria-hidden="true" />
                      ) : (
                        <Eye className="size-4" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                </div>
                {(verifyResult || importNotice) && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    {verifyResult && (
                      <p
                        className={`flex min-w-0 flex-1 items-start gap-1.5 text-xs leading-5 ${
                          verifyResult.ok ? 'text-emerald-600' : 'text-red-600'
                        }`}
                        role="status"
                      >
                        {verifyResult.ok ? (
                          <CircleCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                        ) : (
                          <CircleX className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                        )}
                        <span className="min-w-0 break-words">{verifyResult.message}</span>
                      </p>
                    )}
                    {detected.length > 0 && (
                      <button
                        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-card border border-line border-line-strong bg-surface px-3 text-xs font-medium text-ink-2 transition-colors hover:border-ink-3"
                        onClick={() => setImportOpen(true)}
                        type="button"
                      >
                        <ListPlus className="size-3.5" aria-hidden="true" />
                        导入模型（{detected.length}）
                      </button>
                    )}
                  </div>
                )}
                {importNotice && (
                  <p className="text-xs text-ink-3" role="status">
                    {importNotice}
                  </p>
                )}
              </div>
            ),
          },
          {
            title: '选择模型',
            content: (
              <div className="grid gap-4">
                <StepSelect
                  disabled={models.length === 0}
                  // 空模型列表（自定义未检测）与就绪态间切换时重挂载，避免受控值 undefined 化。
                  key={models.length === 0 ? 'empty' : 'ready'}
                  label="模型"
                  onValueChange={setModel}
                  placeholder="先检测连接，导入可用模型"
                  value={model === '' ? undefined : model}
                >
                  {models.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </StepSelect>
                {custom && models.length === 0 && (
                  <span className="text-xs text-ink-3">
                    自定义服务没有预设模型，检测后从列表导入。
                  </span>
                )}
                {error && (
                  <p className="text-13 [overflow-wrap:anywhere] text-red-600" role="alert">
                    {error}
                  </p>
                )}
                <StepButton
                  busyLabel="保存中…"
                  disabled={models.length === 0}
                  idleLabel="保存并完成"
                  state={state}
                  successLabel="已保存，完成设置"
                />
              </div>
            ),
          },
        ]}
      />
      <StepModelImportDialog
        onConfirm={importModels}
        onOpenChange={setImportOpen}
        open={importOpen}
        options={detected}
        preselected={models}
      />
    </form>
  );
}
