import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CircleCheck, CircleX, Eye, EyeOff, ListPlus, Loader2, PlugZap } from 'lucide-react';
import { DesktopOnlyNotice } from '../../../components/ui/desktop-only-notice';
import { SelectItem } from '../../../components/ui/select';
import { errorText } from '../../../workspace/store';
import { StepButton, StepInput, StepSelect, type StepButtonState } from './step-controls';
import { StepGuide } from './step-guide';
import { StepModelImportDialog } from './step-model-import';
import { capModels } from './model-import';
import type { LlmCatalogProvider, LlmVerifyResult } from '../../../../shared/api';

const CUSTOM = 'custom';

/** 向导 · 模型服务步骤：选 Pi 内置厂商或自定义 OpenAI 兼容服务，可先检测再保存。 */
export function LlmStep({ onDone }: { onDone: () => void }) {
  const [catalog, setCatalog] = useState<LlmCatalogProvider[] | null>(null);
  const [vendorChoice, setVendorChoice] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState('');
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyResult, setVerifyResult] = useState<LlmVerifyResult | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [state, setState] = useState<StepButtonState>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void window.dela?.llm
      .catalog()
      .then(setCatalog)
      .catch(() => setCatalog([]));
  }, []);

  if (!window.dela) {
    return (
      <DesktopOnlyNotice
        description="模型服务的凭据不会暴露给浏览器。"
        title="模型服务仅在 Dela 桌面端可用"
      />
    );
  }

  const vendorId =
    vendorChoice ?? (catalog?.some(({ id }) => id === 'deepseek') ? 'deepseek' : CUSTOM);
  const vendor = catalog?.find(({ id }) => id === vendorId);
  const custom = catalog !== null && !vendor;
  const options = vendor ? vendor.models.map(({ id }) => id) : models;
  const selected = options.includes(model) ? model : (options[0] ?? '');

  const detected = verifyResult?.ok ? (verifyResult.models ?? []) : [];

  const chooseVendor = (id: string) => {
    setVendorChoice(id);
    setName('');
    setModels([]);
    setModel('');
    setVerifyResult(null);
    setImportOpen(false);
    setImportNotice(null);
  };

  /** 内置厂商直接检测所选模型；自定义服务只验证连通性，哪些模型进配置由用户在弹层里勾选。 */
  const verify = async () => {
    if (!window.dela || verifyBusy || (vendor ? !selected : !baseUrl.trim())) return;
    setVerifyBusy(true);
    setVerifyResult(null);
    setImportNotice(null);
    try {
      setVerifyResult(
        vendor
          ? await window.dela.llm.verifyModel({
              piProvider: vendor.id,
              apiKey: apiKey || undefined,
              model: selected,
            })
          : await window.dela.llm.verify({ baseUrl: baseUrl.trim(), apiKey: apiKey || undefined }),
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
    setModel(next.includes(selected) ? selected : (next[0] ?? ''));
    setImportNotice(notice);
    setImportOpen(false);
  };

  const save = async () => {
    if (state === 'success') return onDone();
    if (state === 'busy' || !window.dela || !selected) return;
    setState('busy');
    setError(null);
    try {
      // 引导里选的模型排到列表首位：还没有会话可以沿用时，新会话取第一个可用提供商的首个模型。
      await window.dela.llm.save(
        vendor
          ? {
              name: vendor.name,
              apiKey: apiKey || undefined,
              models: [selected],
              piProvider: vendor.id,
            }
          : {
              name: name.trim(),
              baseUrl: baseUrl.trim(),
              apiKey: apiKey || undefined,
              models: [selected, ...models.filter((item) => item !== selected)],
              piProvider: null,
            },
      );
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
          选择 Pi 内置的厂商，或自定义 OpenAI 兼容端点，密钥加密保存于本机。
        </p>
      </header>
      <StepGuide
        steps={[
          {
            title: '选择服务商',
            content: (
              <div className="grid gap-4">
                <StepSelect
                  disabled={catalog === null}
                  label="服务商"
                  onValueChange={chooseVendor}
                  placeholder="正在读取厂商目录…"
                  value={catalog === null ? undefined : vendorId}
                >
                  {catalog?.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                  <SelectItem value={CUSTOM}>自定义（OpenAI 兼容）</SelectItem>
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
                      disabled={verifyBusy || (vendor ? !selected : !baseUrl.trim())}
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
                  disabled={options.length === 0}
                  // 空模型列表（自定义未检测）与就绪态间切换时重挂载，避免受控值 undefined 化。
                  key={options.length === 0 ? 'empty' : 'ready'}
                  label="模型"
                  onValueChange={(value) => {
                    setModel(value);
                    if (vendor) setVerifyResult(null);
                  }}
                  placeholder="先检测连接，导入可用模型"
                  value={selected === '' ? undefined : selected}
                >
                  {vendor
                    ? vendor.models.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.name}
                        </SelectItem>
                      ))
                    : models.map((item) => (
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
                  disabled={options.length === 0}
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
