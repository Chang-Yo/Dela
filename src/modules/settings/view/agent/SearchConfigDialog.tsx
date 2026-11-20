import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '../../../../ui/button';
import { EmptyState } from '../../../../ui/empty-state';
import { Input } from '../../../../ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../ui/select';
import { Textarea } from '../../../../ui/textarea';
import type {
  WebSearchEntry,
  WebSearchEntryInput,
  WebSearchKeySource,
} from '../../../../core/protocol/capabilities';
import { Switch } from '../../../../ui/switch';
import { ErrorText } from '../../../../ui/alert';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../../../../ui/dialog';
import { Field } from '../../../../ui/field';
import { capabilitiesClient } from '../../../chat/view';
import { errorMessage } from '../../../../core/protocol/contract';

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

export function SearchConfigDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: ['capabilities', 'listWebSearchEntries'],
    queryFn: () => capabilitiesClient.listWebSearchEntries(),
  });
  const entries = list.data;
  const setEntries = (next: WebSearchEntry[]) =>
    queryClient.setQueryData(['capabilities', 'listWebSearchEntries'], next);
  const [draft, setDraft] = useState<WebSearchEntryInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shownError = error ?? (list.error ? errorMessage(list.error) : null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const remove = async (id: string) => {
    if (!window.dela || busy) return;
    setBusy(true);
    try {
      setEntries(await capabilitiesClient.removeWebSearchEntry(id));
    } catch (cause) {
      setError(errorMessage(cause));
    }
    setBusy(false);
    setConfirmDeleteId(null);
  };

  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open>
      <DialogContent scroll>
        {draft ? (
          <EntryForm
            draft={draft}
            busy={busy}
            error={shownError}
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
            <DialogTitle>搜索服务</DialogTitle>
            <DialogDescription>
              管理搜索服务配置；当前使用哪一条在聊天输入框左下角选择。
            </DialogDescription>
            <ul className="mt-4 flex flex-col gap-2">
              {(entries ?? []).map((entry) => (
                <li
                  className="flex items-center gap-3 rounded-card border px-3 py-2.5"
                  key={entry.id}
                >
                  <div className="min-w-0 flex-1 grid gap-0.5">
                    <span className="truncate text-sm font-medium">{entry.name}</span>
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
                <li>
                  <EmptyState title="还没有搜索配置，点下方添加。" />
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
        {shownError && !draft && <ErrorText className="mt-2">{shownError}</ErrorText>}
      </DialogContent>
    </Dialog>
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
  const [body, setBody] = useState(draft.provider === 'custom' ? (draft.body ?? '') : '');
  const [headers, setHeaders] = useState(
    draft.provider === 'custom' ? headersText(draft.headers) : '',
  );
  const [useForFetch, setUseForFetch] = useState(
    draft.provider === 'deepseek' ? draft.useForFetch : false,
  );
  const [keySources, setKeySources] = useState<WebSearchKeySource[] | null>(null);
  const [sourceId, setSourceId] = useState('');

  const save = async () => {
    if (!window.dela || busy) return;
    onBusy(true);
    const base = { id: draft.id, name: name.trim() };
    const saveEntry = async () => {
      if (provider === 'brave')
        onSaved(
          await capabilitiesClient.saveWebSearchEntry({
            ...base,
            provider: 'brave',
            apiKey: apiKey.trim(),
          }),
        );
      else if (provider === 'google')
        onSaved(
          await capabilitiesClient.saveWebSearchEntry({
            ...base,
            provider: 'google',
            apiKey: apiKey.trim(),
            cx: cx.trim(),
          }),
        );
      else if (provider === 'deepseek')
        onSaved(
          await capabilitiesClient.saveWebSearchEntry({
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
          await capabilitiesClient.saveWebSearchEntry({
            ...base,
            provider: 'custom',
            url: url.trim(),
            ...(body.trim() ? { body: body.trim() } : {}),
            ...(Object.keys(parsed.headers).length > 0 ? { headers: parsed.headers } : {}),
          }),
        );
      }
    };
    try {
      await saveEntry();
    } catch (cause) {
      onError(errorMessage(cause));
    }
    onBusy(false);
  };

  const importKey = async (id?: string) => {
    if (!window.dela || busy) return;
    onBusy(true);
    onError(null);
    const importFromProvider = async () => {
      const sources = keySources ?? (await capabilitiesClient.listWebSearchKeySources());
      setKeySources(sources);
      if (sources.length === 0) {
        onError('没有找到已配置密钥的 DeepSeek 模型供应商，请先在「模型服务」中添加');
        return;
      }
      const target = id ?? sources[0]!.id;
      setSourceId(target);
      const key = await capabilitiesClient.readWebSearchKey(target);
      if (!key) {
        onError('导入失败：该供应商没有可用的密钥');
        return;
      }
      setApiKey(key);
    };
    try {
      await importFromProvider();
    } catch (cause) {
      onError(errorMessage(cause));
    }
    onBusy(false);
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <DialogTitle>{draft.id ? '编辑搜索服务' : '添加搜索服务'}</DialogTitle>
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
        <Field label="名称">
          <Input
            autoComplete="off"
            onChange={(event) => setName(event.target.value)}
            placeholder="区分用途或账号，如「学校账号」"
            required
            value={name}
          />
        </Field>
        {provider === 'brave' && (
          <Field
            label="API Key"
            hint="走 Brave 为大模型设计的 LLM Context 端点，返回从页面抽取的内容片段。"
          >
            <Input
              autoComplete="off"
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="BSA…"
              required
              spellCheck={false}
              type="password"
              value={apiKey}
            />
          </Field>
        )}
        {provider === 'google' && (
          <>
            <Field label="API Key">
              <Input
                autoComplete="off"
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="AIza…"
                required
                spellCheck={false}
                type="password"
                value={apiKey}
              />
            </Field>
            <Field label="搜索引擎 ID（cx）">
              <Input
                autoComplete="off"
                onChange={(event) => setCx(event.target.value)}
                placeholder="Programmable Search 的搜索引擎 ID"
                required
                spellCheck={false}
                value={cx}
              />
            </Field>
          </>
        )}
        {provider === 'deepseek' && (
          <>
            <Field label="API Key" hint="按成功请求计费：5 元 / 千次。">
              <Input
                autoComplete="off"
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="sk-…"
                required
                spellCheck={false}
                type="password"
                value={apiKey}
              />
            </Field>
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
                <span className="text-sm font-medium">网页读取也使用 DeepSeek</span>
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
            <Field
              label="端点地址"
              hint={
                <>
                  用 {'{query}'}、{'{count}'} 占位搜索词与条数；不含 {'{query}'} 的 GET 请求按
                  SearXNG 追加 q 与 format=json。结果自动识别 results、data、items 等常见结构。
                </>
              }
            >
              <Input
                autoComplete="off"
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://example.com/search?q={query}"
                required
                spellCheck={false}
                type="url"
                value={url}
              />
            </Field>
            <Field label="请求体（可选，填写后改用 POST）">
              <Textarea
                className={headerAreaClass}
                onChange={(event) => setBody(event.target.value)}
                placeholder={'{ "query": "{query}", "max_results": {count} }'}
                rows={3}
                spellCheck={false}
                value={body}
              />
            </Field>
            <Field label="自定义请求头（可选，每行 Key: Value）">
              <Textarea
                className={headerAreaClass}
                onChange={(event) => setHeaders(event.target.value)}
                placeholder={'Authorization: Bearer …\nX-API-Key: …'}
                rows={3}
                spellCheck={false}
                value={headers}
              />
            </Field>
          </>
        )}
      </div>
      {error && <ErrorText className="mt-2">{error}</ErrorText>}
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
