import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { DesktopOnlyNotice } from '../../../components/ui/desktop-only-notice';
import { errorText } from '../../projects/workspace';
import { StepButton, StepInput, StepSelect, type StepButtonState } from './step-controls';
import { llmProviderPresets, findLlmPreset } from '../../../../shared/llm-presets';
import type { LlmVerifyResult } from '../../../../shared/api';

/** 向导 · 模型服务步骤：选预设或自定义 OpenAI 兼容服务，可先检测连通性并导入模型列表。 */
export function LlmStep({ onDone }: { onDone: () => void }) {
  const [presetId, setPresetId] = useState(llmProviderPresets[0]!.id);
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState(llmProviderPresets[0]!.baseUrl);
  const [apiKey, setApiKey] = useState('');
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
          选择模型厂商或填写任意 OpenAI 兼容服务。密钥经系统加密保存在本机，不会回传页面。
        </p>
      </header>
      <form
        className="grid gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label className="grid gap-2">
          <span className="text-sm font-medium text-neutral-700">模型服务</span>
          <StepSelect
            aria-label="模型服务"
            onChange={(event) => applyPreset(event.target.value)}
            value={presetId}
          >
            {llmProviderPresets.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </StepSelect>
        </label>
        {custom && (
          <>
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
              <span className="text-sm font-medium text-neutral-700">Base URL</span>
              <StepInput
                autoComplete="off"
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder="https://api.example.com/v1"
                required
                value={baseUrl}
              />
            </label>
          </>
        )}
        <label className="grid gap-2">
          <span className="text-sm font-medium text-neutral-700">API Key</span>
          <StepInput
            autoComplete="off"
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="sk-…"
            required
            type="password"
            value={apiKey}
          />
        </label>
        <div className="grid gap-2">
          <button
            className="grid h-10 w-full place-items-center rounded-lg border border-neutral-300 bg-white text-sm font-medium text-neutral-800 transition-colors hover:border-neutral-400 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={verifyBusy || !effectiveBaseUrl}
            onClick={() => void verify()}
            type="button"
          >
            <span className="flex items-center gap-2">
              {verifyBusy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              检测连接
            </span>
          </button>
          {verifyResult && (
            <p
              className={`text-sm ${verifyResult.ok ? 'text-emerald-600' : 'text-red-600'}`}
              role="status"
            >
              {verifyResult.message}
              {verifyResult.ok && verifyResult.models?.length
                ? `，已导入 ${verifyResult.models.length} 个模型`
                : ''}
            </p>
          )}
        </div>
        <label className="grid gap-2">
          <span className="text-sm font-medium text-neutral-700">模型</span>
          <StepSelect
            aria-label="模型"
            disabled={models.length === 0}
            onChange={(event) => setModel(event.target.value)}
            required
            value={model}
          >
            {models.length === 0 && <option value="">先检测连接以导入模型</option>}
            {models.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </StepSelect>
          {custom && models.length === 0 && (
            <span className="text-xs text-neutral-400">
              自定义服务没有预设模型，填写 Base URL 与 API Key 后点「检测连接」导入。
            </span>
          )}
        </label>
        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
        <StepButton
          busyLabel="保存中…"
          disabled={models.length === 0 || !model}
          idleLabel="保存并继续"
          state={state}
          successLabel="已保存，下一步"
        />
      </form>
    </div>
  );
}
