import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CircleCheck, CircleX, ExternalLink, Eye, EyeOff, Loader2 } from 'lucide-react';
import { DesktopOnlyNotice } from '../../../components/ui/desktop-only-notice';
import { SelectItem } from '../../../components/ui/select';
import { errorText } from '../../../workspace/store';
import { StepButton, StepInput, StepSelect, type StepButtonState } from './step-controls';
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

  const applyPreset = (id: string) => {
    const next = findLlmPreset(id)!;
    setPresetId(id);
    setName('');
    setBaseUrl(next.baseUrl);
    setModels([...next.models]);
    setModel(next.models[0] ?? '');
    setVerifyResult(null);
  };

  const verify = async () => {
    if (!window.dela || verifyBusy || !effectiveBaseUrl) return;
    setVerifyBusy(true);
    setVerifyResult(null);
    try {
      const result = await window.dela.llm.verify({
        baseUrl: effectiveBaseUrl,
        apiKey: apiKey || undefined,
      });
      setVerifyResult(result);
      if (result.ok && result.models?.length) {
        setModels(result.models);
        setModel(result.models[0]!);
      }
    } catch (cause) {
      setVerifyResult({ ok: false, message: errorText(cause) });
    } finally {
      setVerifyBusy(false);
    }
  };

  const save = async () => {
    if (state === 'success') return onDone();
    if (state === 'busy' || !window.dela || !model) return;
    setState('busy');
    setError(null);
    try {
      const saved = await window.dela.llm.save({
        name: custom ? name.trim() : preset.name,
        baseUrl: effectiveBaseUrl,
        apiKey: apiKey || undefined,
        models,
        model,
        presetId: custom ? null : presetId,
      });
      await window.dela.llm.setActive(saved.id);
      setState('success');
    } catch (cause) {
      setError(errorText(cause));
      setState('idle');
    }
  };

  return (
    <div className="grid gap-7">
      <header className="grid gap-2">
        <h2 className="text-2xl font-semibold tracking-tight">配置模型服务</h2>
        <p className="text-sm leading-relaxed text-neutral-500">
          选择服务商或自定义 OpenAI 兼容端点，密钥加密保存于本机。
        </p>
      </header>
      <form
        className="grid gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <section className="grid gap-5">
          <label className="grid gap-2">
            <span className="text-sm font-medium text-neutral-700">服务商</span>
            <StepSelect label="服务商" onValueChange={applyPreset} value={presetId}>
              {llmProviderPresets.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </StepSelect>
          </label>
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
                    <span className="text-sm font-medium text-neutral-700">名称</span>
                    <StepInput
                      autoComplete="off"
                      onChange={(event) => setName(event.target.value)}
                      placeholder="给这个服务起个名字"
                      required
                      value={name}
                    />
                  </label>
                  <label className="grid gap-2">
                    <span className="text-sm font-medium text-neutral-700">API 地址</span>
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
        </section>

        <hr className="border-t border-neutral-100" />

        <section className="grid gap-2.5">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-neutral-700" htmlFor="llm-api-key">
              API Key
            </label>
            {preset.keyUrl && (
              <a
                className="flex items-center gap-1 text-xs text-neutral-500 transition-colors hover:text-neutral-800"
                href={preset.keyUrl}
                rel="noreferrer"
                target="_blank"
              >
                获取密钥
                <ExternalLink className="size-3" aria-hidden="true" />
              </a>
            )}
          </div>
          <div className="relative">
            <StepInput
              autoComplete="off"
              className="pr-10"
              id="llm-api-key"
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="sk-…"
              required
              type={showKey ? 'text' : 'password'}
              value={apiKey}
            />
            <button
              aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}
              className="absolute inset-y-0 right-1.5 my-auto grid size-7 place-items-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600"
              onClick={() => setShowKey((value) => !value)}
              type="button"
            >
              {showKey ? (
                <EyeOff className="size-4" aria-hidden="true" />
              ) : (
                <Eye className="size-4" aria-hidden="true" />
              )}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <button
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 text-xs font-medium text-neutral-700 transition-colors hover:border-neutral-400 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={verifyBusy || !effectiveBaseUrl}
              onClick={() => void verify()}
              type="button"
            >
              {verifyBusy && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
              检测连接
            </button>
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
                <span className="min-w-0 break-words">
                  {verifyResult.message}
                  {verifyResult.ok && verifyResult.models?.length
                    ? `，已导入 ${verifyResult.models.length} 个模型`
                    : ''}
                </span>
              </p>
            )}
          </div>
        </section>

        <hr className="border-t border-neutral-100" />

        <section className="grid gap-4">
          <label className="grid gap-2">
            <span className="text-sm font-medium text-neutral-700">模型</span>
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
              <span className="text-xs text-neutral-400">
                自定义服务没有预设模型，检测后自动导入。
              </span>
            )}
          </label>
          {error && (
            <p className="text-sm [overflow-wrap:anywhere] text-red-600" role="alert">
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
        </section>
      </form>
    </div>
  );
}
