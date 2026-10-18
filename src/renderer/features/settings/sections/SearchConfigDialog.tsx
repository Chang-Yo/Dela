import { useState } from 'react';
import { Dialog } from 'radix-ui';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Textarea } from '../../../components/ui/textarea';
import type { WebSearchConfig } from '../../../../shared/api';
import { errorText } from '../../../workspace/store';
import { dialogOverlay, dialogPanel } from '../../../components/ui/motion';
import { Switch } from '../../../components/ui/beautifului/atoms/Switch';
import { cn } from '../../../lib/utils';

/** 三个注册选项的展示名（能力页入口按钮的 title 与表单共用）。 */
export const webSearchProviderLabels: Record<WebSearchConfig['provider'], string> = {
  brave: 'Brave Search API',
  google: 'Google 搜索',
  deepseek: 'DeepSeek',
  custom: '自定义端点',
};

const providers = Object.keys(webSearchProviderLabels) as WebSearchConfig['provider'][];

/** 「每行 Key: Value」文本解析为请求头记录；空行跳过，缺冒号或缺值报错。 */
function parseHeaders(
  text: string,
): { ok: true; headers: Record<string, string> } | { ok: false; error: string } {
  const headers: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const index = line.indexOf(':');
    if (index <= 0 || !line.slice(index + 1).trim())
      return { ok: false, error: `请求头格式错误（应为 Key: Value）：${line.trim()}` };
    headers[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return { ok: true, headers };
}

const headersText = (headers: Record<string, string> | undefined) =>
  Object.entries(headers ?? {})
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');

const headerAreaClass = 'min-h-20 resize-y py-2 font-mono text-xs';

/** 搜索服务注册弹窗：WebSearch 同一时刻至多一个生效；保存与清除走 capability 通道。 */
export function SearchConfigDialog({
  config,
  onClose,
  onSaved,
}: {
  config: WebSearchConfig | null;
  onClose: () => void;
  onSaved: (config: WebSearchConfig | null) => void;
}) {
  const [provider, setProvider] = useState<WebSearchConfig['provider']>(
    config?.provider ?? 'brave',
  );
  // 每个选项保留各自的输入：切换选项只改变显示，不会把上一个选项的 Key 带过去。
  const [braveKey, setBraveKey] = useState(config?.provider === 'brave' ? config.apiKey : '');
  const [googleKey, setGoogleKey] = useState(config?.provider === 'google' ? config.apiKey : '');
  const [googleCx, setGoogleCx] = useState(config?.provider === 'google' ? config.cx : '');
  const [deepseekKey, setDeepseekKey] = useState(
    config?.provider === 'deepseek' ? config.apiKey : '',
  );
  const [url, setUrl] = useState(config?.provider === 'custom' ? config.url : '');
  const [headers, setHeaders] = useState(
    config?.provider === 'custom' ? headersText(config.headers) : '',
  );
  const [useForFetch, setUseForFetch] = useState(
    config?.provider === 'deepseek' ? config.useForFetch : false,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (next: WebSearchConfig | null) => {
    const dela = window.dela;
    if (!dela || busy) return;
    setBusy(true);
    setError(null);
    try {
      onSaved(await dela.capability.writeWebSearchConfig(next));
      onClose();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    if (provider === 'brave') return submit({ provider, apiKey: braveKey.trim() });
    if (provider === 'google')
      return submit({ provider, apiKey: googleKey.trim(), cx: googleCx.trim() });
    if (provider === 'deepseek')
      return submit({ provider, apiKey: deepseekKey.trim(), useForFetch });
    const parsed = parseHeaders(headers);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    return submit({
      provider,
      url: url.trim(),
      ...(Object.keys(parsed.headers).length > 0 ? { headers: parsed.headers } : {}),
    });
  };

  /** 从「模型供应商」里已保存的 DeepSeek 配置导入密钥，避免重复粘贴。 */
  const importExisting = async () => {
    const dela = window.dela;
    if (!dela || busy) return;
    setBusy(true);
    setError(null);
    try {
      const imported = await dela.capability.importWebSearchKey();
      if (!imported || imported.provider !== 'deepseek') {
        setError('没有找到已配置的 DeepSeek 模型供应商，请先在「模型供应商」中添加');
        return;
      }
      setDeepseekKey(imported.apiKey);
      setUseForFetch(imported.useForFetch);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root onOpenChange={(open) => !open && !busy && onClose()} open>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlay} />
        <Dialog.Content className={cn(dialogPanel, 'max-h-[85vh] max-w-md overflow-y-auto')}>
          <Dialog.Title className="text-base font-semibold">搜索服务</Dialog.Title>
          <Dialog.Description className="mt-2 text-xs leading-relaxed text-ink-3">
            注册一个搜索服务供 WebSearch 使用；Dela 不内置搜索服务，凭据仅保存在本地数据库。
            DeepSeek 还可选择让网页读取一并走官方接口；自定义端点需返回{' '}
            {'{ results: [{ title, url, content }] }'} 形状的 JSON（SearXNG 兼容）。
          </Dialog.Description>
          <form
            className="mt-4 grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <div aria-label="搜索服务类型" className="flex flex-wrap gap-2" role="radiogroup">
              {providers.map((id) => (
                <Button
                  aria-pressed={provider === id}
                  key={id}
                  onClick={() => setProvider(id)}
                  size="sm"
                  type="button"
                  variant={provider === id ? 'default' : 'outline'}
                >
                  {webSearchProviderLabels[id]}
                </Button>
              ))}
            </div>
            {provider === 'brave' && (
              <label className="grid gap-2 text-13">
                API Key
                <Input
                  autoComplete="off"
                  onChange={(event) => setBraveKey(event.target.value)}
                  placeholder="BSA…"
                  required
                  spellCheck={false}
                  type="password"
                  value={braveKey}
                />
                <span className="text-xs leading-relaxed text-ink-3">
                  走 Brave 为大模型设计的 LLM Context 端点（res/v1/llm/context），结果是从页面
                  抽取的内容片段，而非普通搜索摘要。
                </span>
              </label>
            )}
            {provider === 'google' && (
              <>
                <label className="grid gap-2 text-13">
                  API Key
                  <Input
                    autoComplete="off"
                    onChange={(event) => setGoogleKey(event.target.value)}
                    placeholder="AIza…"
                    required
                    spellCheck={false}
                    type="password"
                    value={googleKey}
                  />
                </label>
                <label className="grid gap-2 text-13">
                  搜索引擎 ID（cx）
                  <Input
                    autoComplete="off"
                    onChange={(event) => setGoogleCx(event.target.value)}
                    placeholder="Programmable Search 的搜索引擎 ID"
                    required
                    spellCheck={false}
                    value={googleCx}
                  />
                </label>
              </>
            )}
            {provider === 'deepseek' && (
              <>
                <label className="grid gap-2 text-13">
                  API Key
                  <Input
                    autoComplete="off"
                    onChange={(event) => setDeepseekKey(event.target.value)}
                    placeholder="sk-…"
                    required
                    spellCheck={false}
                    type="password"
                    value={deepseekKey}
                  />
                  <span className="text-xs leading-relaxed text-ink-3">
                    走 DeepSeek 自研搜索引擎（/v1/tools/search），按成功请求计费：5 元 / 千次， QPS
                    5。
                  </span>
                </label>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-ink-3">已配置过 DeepSeek 模型？</span>
                  <Button
                    disabled={busy}
                    onClick={() => void importExisting()}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    导入已有 API
                  </Button>
                </div>
                <div className="flex items-start justify-between gap-3 rounded-card border p-3">
                  <div className="grid gap-0.5">
                    <span className="text-13 font-medium">网页读取也使用 DeepSeek</span>
                    <span className="text-xs leading-relaxed text-ink-3">
                      开启后 web_fetch 改走 /v1/tools/fetch；取不到正文或链接是 PDF
                      时自动回退本地抓取。同样按次计费。
                    </span>
                  </div>
                  <Switch
                    checked={useForFetch}
                    label="网页读取也使用 DeepSeek"
                    onChange={setUseForFetch}
                  />
                </div>
              </>
            )}
            {provider === 'custom' && (
              <>
                <label className="grid gap-2 text-13">
                  端点地址
                  <Input
                    autoComplete="off"
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder="https://example.com/search"
                    required
                    spellCheck={false}
                    type="url"
                    value={url}
                  />
                </label>
                <label className="grid gap-2 text-13">
                  自定义请求头（可选，每行 Key: Value）
                  <Textarea
                    className={headerAreaClass}
                    onChange={(event) => setHeaders(event.target.value)}
                    placeholder={'Authorization: Bearer …\nX-API-Key: …'}
                    rows={3}
                    spellCheck={false}
                    value={headers}
                  />
                  <span className="text-xs leading-relaxed text-ink-3">
                    随每次搜索请求发送，用于适配你自己的鉴权或加密策略；与查询参数一同传出。
                  </span>
                </label>
              </>
            )}
            {error && (
              <p className="text-xs text-red" role="alert">
                {error}
              </p>
            )}
            <div className="flex items-center justify-between gap-2">
              <Button
                disabled={busy || !config}
                onClick={() => void submit(null)}
                size="sm"
                type="button"
                variant="ghost"
              >
                清除注册
              </Button>
              <div className="flex items-center gap-2">
                <Button disabled={busy} onClick={onClose} type="button" variant="ghost">
                  取消
                </Button>
                <Button disabled={busy} type="submit">
                  保存
                </Button>
              </div>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
