import { useEffect, useRef, useState } from 'react';
import { Dialog } from 'radix-ui';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select';
import { Textarea } from '../../../components/ui/textarea';
import type {
  WebSearchEntry,
  WebSearchEntryInput,
  WebSearchKeySource,
} from '../../../../shared/api';
import { errorText } from '../../../workspace/store';
import { dialogOverlay, dialogPanel } from '../../../components/ui/motion';
import { Switch } from '../../../components/ui/beautifului/atoms/Switch';
import { cn } from '../../../lib/utils';

/** 各类型展示名（键序即表单类型按钮的排列顺序，DeepSeek 置首）。 */
const webSearchProviderLabels: Record<WebSearchEntry['provider'], string> = {
  deepseek: 'DeepSeek',
  brave: 'Brave Search API',
  google: 'Google 搜索',
  custom: '自定义端点',
};

const providers = Object.keys(webSearchProviderLabels) as WebSearchEntry['provider'][];

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

/** 列表与新增/编辑表单两态；当前使用哪一条在聊天输入框左下角选择。 */
export function SearchConfigDialog({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<WebSearchEntry[] | null>(null);
  /** null = 列表态；有值为表单态（无 id = 新建）。 */
  const [draft, setDraft] = useState<WebSearchEntryInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 两步删除防误触：待确认的条目 id，删除键先变「确认删除」。 */
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const load = () => {
    void window.dela?.capability
      .listWebSearchEntries()
      .then((list) => {
        setEntries(list);
        setError(null);
      })
      .catch((cause) => setError(errorText(cause)));
  };
  useEffect(load, []);

  const remove = async (id: string) => {
    const dela = window.dela;
    if (!dela || busy) return;
    setBusy(true);
    try {
      setEntries(await dela.capability.removeWebSearchEntry(id));
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
      setConfirmDeleteId(null);
    }
  };

  return (
    <Dialog.Root onOpenChange={(open) => !open && onClose()} open>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlay} />
        <Dialog.Content className={cn(dialogPanel, 'max-h-[85vh] max-w-md overflow-y-auto')}>
          {draft ? (
            <EntryForm
              draft={draft}
              busy={busy}
              error={error}
              onCancel={() => {
                setDraft(null);
                setError(null);
              }}
              onBusy={setBusy}
              onError={setError}
              onSaved={(list) => {
                setEntries(list);
                setDraft(null);
                setError(null);
              }}
            />
          ) : (
            <>
              <Dialog.Title className="text-base font-semibold">搜索服务</Dialog.Title>
              <Dialog.Description className="mt-2 text-xs leading-relaxed text-ink-3">
                管理搜索服务配置；当前使用哪一条在聊天输入框左下角选择。
              </Dialog.Description>
              <ul className="mt-4 flex flex-col gap-2">
                {(entries ?? []).map((entry) => (
                  <li
                    className="flex items-center gap-3 rounded-card border px-3 py-2.5"
                    key={entry.id}
                  >
                    <div className="min-w-0 flex-1 grid gap-0.5">
                      <span className="truncate text-13 font-medium">{entry.name}</span>
                      <span className="text-xs text-ink-3">
                        {webSearchProviderLabels[entry.provider]}
                        {entry.provider === 'deepseek' ? ' · 按次计费' : ''}
                      </span>
                    </div>
                    {confirmDeleteId === entry.id ? (
                      <Button
                        disabled={busy}
                        onClick={() => void remove(entry.id)}
                        size="sm"
                        variant="destructive"
                      >
                        确认删除
                      </Button>
                    ) : (
                      <>
                        <Button
                          aria-label={`编辑 ${entry.name}`}
                          disabled={busy}
                          onClick={() => {
                            setConfirmDeleteId(null);
                            setDraft(entry);
                          }}
                          size="icon-xs"
                          title="编辑"
                          variant="ghost"
                        >
                          <Pencil />
                        </Button>
                        <Button
                          aria-label={`删除 ${entry.name}`}
                          disabled={busy}
                          onClick={() => setConfirmDeleteId(entry.id)}
                          size="icon-xs"
                          title="删除（含密钥，需二次确认）"
                          variant="ghost"
                        >
                          <Trash2 />
                        </Button>
                      </>
                    )}
                  </li>
                ))}
                {entries?.length === 0 && (
                  <li className="py-6 text-center text-13 text-ink-3">
                    还没有搜索配置，点下方添加。
                  </li>
                )}
              </ul>
              <Button
                className="mt-3 w-full"
                disabled={busy}
                onClick={() =>
                  setDraft({ name: '', provider: 'deepseek', apiKey: '', useForFetch: false })
                }
                size="sm"
                type="button"
                variant="outline"
              >
                <Plus />
                添加搜索服务
              </Button>
            </>
          )}
          {error && !draft && (
            <p className="mt-2 text-xs text-red" role="alert">
              {error}
            </p>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function EntryForm({
  busy,
  draft,
  error,
  onBusy,
  onCancel,
  onError,
  onSaved,
}: {
  busy: boolean;
  draft: WebSearchEntryInput;
  error: string | null;
  onBusy: (value: boolean) => void;
  onCancel: () => void;
  onError: (message: string | null) => void;
  onSaved: (entries: WebSearchEntry[]) => void;
}) {
  const [provider, setProvider] = useState<WebSearchEntry['provider']>(draft.provider);
  const [name, setName] = useState(draft.name);
  const [apiKey, setApiKey] = useState('apiKey' in draft ? draft.apiKey : '');
  const [cx, setCx] = useState(draft.provider === 'google' ? draft.cx : '');
  const [url, setUrl] = useState(draft.provider === 'custom' ? draft.url : '');
  const [headers, setHeaders] = useState(
    draft.provider === 'custom' ? headersText(draft.headers) : '',
  );
  const [useForFetch, setUseForFetch] = useState(
    draft.provider === 'deepseek' ? draft.useForFetch : false,
  );
  /** DeepSeek 密钥的导入来源；多于一个时在 Key 下展开选择。 */
  const [keySources, setKeySources] = useState<WebSearchKeySource[] | null>(null);
  const [sourceId, setSourceId] = useState('');
  /** 与 sourceId 同步的最新请求目标：导入返回时据此丢弃过期结果。 */
  const sourceIdRef = useRef('');

  const save = async () => {
    const dela = window.dela;
    if (!dela || busy) return;
    onBusy(true);
    const base = { id: draft.id, name: name.trim() };
    try {
      if (provider === 'brave')
        onSaved(
          await dela.capability.saveWebSearchEntry({
            ...base,
            provider: 'brave',
            apiKey: apiKey.trim(),
          }),
        );
      else if (provider === 'google')
        onSaved(
          await dela.capability.saveWebSearchEntry({
            ...base,
            provider: 'google',
            apiKey: apiKey.trim(),
            cx: cx.trim(),
          }),
        );
      else if (provider === 'deepseek')
        onSaved(
          await dela.capability.saveWebSearchEntry({
            ...base,
            provider: 'deepseek',
            apiKey: apiKey.trim(),
            useForFetch,
          }),
        );
      else {
        const parsed = parseHeaders(headers);
        if (!parsed.ok) {
          onError(parsed.error);
          return;
        }
        onSaved(
          await dela.capability.saveWebSearchEntry({
            ...base,
            provider: 'custom',
            url: url.trim(),
            ...(Object.keys(parsed.headers).length > 0 ? { headers: parsed.headers } : {}),
          }),
        );
      }
    } catch (cause) {
      onError(errorText(cause));
    } finally {
      onBusy(false);
    }
  };

  /** 从「模型供应商」预填 DeepSeek 密钥；命中多个时展开选择，默认第一个（启用的排在前面）。 */
  const importKey = async (id?: string) => {
    const dela = window.dela;
    if (!dela || busy) return;
    onBusy(true);
    onError(null);
    try {
      const sources = keySources ?? (await dela.capability.listWebSearchKeySources());
      setKeySources(sources);
      if (sources.length === 0) {
        onError('没有找到已配置密钥的 DeepSeek 模型供应商，请先在「模型供应商」中添加');
        return;
      }
      const target = id ?? sources[0]!.id;
      sourceIdRef.current = target;
      setSourceId(target);
      const key = await dela.capability.readWebSearchKey(target);
      if (sourceIdRef.current !== target) return;
      if (!key) {
        onError('导入失败：该供应商没有可用的密钥');
        return;
      }
      setApiKey(key);
    } catch (cause) {
      onError(errorText(cause));
    } finally {
      onBusy(false);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <Dialog.Title className="text-base font-semibold">
        {draft.id ? '编辑搜索服务' : '添加搜索服务'}
      </Dialog.Title>
      <div className="mt-4 flex flex-col gap-4">
        <div aria-label="搜索服务类型" className="flex flex-wrap gap-2" role="radiogroup">
          {providers.map((id) => (
            <Button
              aria-pressed={provider === id}
              disabled={busy}
              key={id}
              onClick={() => {
                if (provider === id) return;
                setProvider(id);
                setApiKey('');
                setSourceId('');
                sourceIdRef.current = '';
                setKeySources(null);
              }}
              size="sm"
              type="button"
              variant={provider === id ? 'default' : 'outline'}
            >
              {webSearchProviderLabels[id]}
            </Button>
          ))}
        </div>
        <label className="grid gap-2 text-13">
          名称
          <Input
            autoComplete="off"
            onChange={(event) => setName(event.target.value)}
            placeholder="区分用途或账号，如「学校账号」"
            required
            value={name}
          />
        </label>
        {provider === 'brave' && (
          <label className="grid gap-2 text-13">
            API Key
            <Input
              autoComplete="off"
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="BSA…"
              required
              spellCheck={false}
              type="password"
              value={apiKey}
            />
            <span className="text-xs leading-relaxed text-ink-3">
              走 Brave 为大模型设计的 LLM Context 端点，返回从页面抽取的内容片段。
            </span>
          </label>
        )}
        {provider === 'google' && (
          <>
            <label className="grid gap-2 text-13">
              API Key
              <Input
                autoComplete="off"
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="AIza…"
                required
                spellCheck={false}
                type="password"
                value={apiKey}
              />
            </label>
            <label className="grid gap-2 text-13">
              搜索引擎 ID（cx）
              <Input
                autoComplete="off"
                onChange={(event) => setCx(event.target.value)}
                placeholder="Programmable Search 的搜索引擎 ID"
                required
                spellCheck={false}
                value={cx}
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
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="sk-…"
                required
                spellCheck={false}
                type="password"
                value={apiKey}
              />
              <span className="text-xs leading-relaxed text-ink-3">
                按成功请求计费：5 元 / 千次。
              </span>
            </label>
            {keySources && keySources.length > 1 ? (
              <Select value={sourceId} onValueChange={(value) => void importKey(value)}>
                <SelectTrigger aria-label="选择要导入密钥的 DeepSeek 供应商" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {keySources.map((source) => (
                    <SelectItem key={source.id} value={source.id}>
                      {source.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-ink-3">已配置过 DeepSeek 模型？</span>
                <Button
                  disabled={busy}
                  onClick={() => void importKey()}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  导入已有 API
                </Button>
              </div>
            )}
            <div className="flex items-start justify-between gap-3 rounded-card border p-3">
              <div className="grid gap-0.5">
                <span className="text-13 font-medium">网页读取也使用 DeepSeek</span>
                <span className="text-xs leading-relaxed text-ink-3">
                  web_fetch 改走官方接口，取不到正文或 PDF 时回退本地抓取；同样按次计费。
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
              <span className="text-xs leading-relaxed text-ink-3">
                需返回 {'{ results: [{ title, url, content }] }'} 形状的 JSON（SearXNG 兼容）。
              </span>
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
            </label>
          </>
        )}
      </div>
      {error && (
        <p className="mt-2 text-xs text-red" role="alert">
          {error}
        </p>
      )}
      <div className="flex items-center justify-end gap-2 pt-4">
        <Button disabled={busy} onClick={onCancel} type="button" variant="ghost">
          取消
        </Button>
        <Button disabled={busy} type="submit">
          保存
        </Button>
      </div>
    </form>
  );
}
