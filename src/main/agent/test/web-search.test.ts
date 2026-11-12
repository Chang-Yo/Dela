// 搜索服务多条目存储：新建即选中、删除回落与选择联动工具开关。
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, expect, it, vi } from 'vitest';

let database: DatabaseSync;
const capabilityCalls: { names: string[]; enabled: boolean }[] = [];
vi.mock('../tools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../tools')>();
  return {
    ...actual,
    setBuiltinCapabilities: (names: string[], enabled: boolean) => {
      capabilityCalls.push({ names, enabled });
      return actual.setBuiltinCapabilities(names, enabled);
    },
  };
});
vi.mock('../../credentials', () => ({
  loadLlmConfig: () => ({
    providers: [
      {
        id: 'p1',
        name: 'DeepSeek 官方',
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: 'sk-school',
        enabled: true,
      },
      {
        id: 'p2',
        name: '中转',
        baseUrl: 'https://relay.example/v1',
        apiKey: 'sk-relay',
        enabled: true,
      },
    ],
  }),
}));
import {
  listWebSearchEntries,
  listWebSearchKeySources,
  listWebSearchOptions,
  readWebSearchConfig,
  readWebSearchKey,
  removeWebSearchEntry,
  saveWebSearchEntry,
  selectWebSearchEntry,
  webSearch,
  webSearchEntryInputSchema,
} from '../web-search';
import { provideTestHostPorts } from '../../test/host-mock';

provideTestHostPorts({ database: () => database });

beforeEach(() => {
  database = new DatabaseSync(':memory:');
  database.exec('CREATE TABLE workspace_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  capabilityCalls.length = 0;
});

it('新建即选中，更新已有条目不改选中', () => {
  const brave = saveWebSearchEntry({ name: 'Brave', provider: 'brave', apiKey: 'BSA-1' })[0]!;
  expect(readWebSearchConfig()?.id).toBe(brave.id);
  const deep = saveWebSearchEntry({
    name: '学校账号',
    provider: 'deepseek',
    apiKey: 'sk-1',
    useForFetch: false,
  }).find(({ name }) => name === '学校账号')!;
  expect(readWebSearchConfig()?.id).toBe(deep.id);
  selectWebSearchEntry(brave.id);
  saveWebSearchEntry({
    id: deep.id,
    name: '学校账号',
    provider: 'deepseek',
    apiKey: 'sk-2',
    useForFetch: true,
  });
  expect(readWebSearchConfig()?.id).toBe(brave.id);
  expect(listWebSearchEntries().find(({ id }) => id === deep.id)).toMatchObject({
    apiKey: 'sk-2',
    useForFetch: true,
  });
});

it('删除选中条目时回落到剩余第一条，删空后停用 web_search', () => {
  const a = saveWebSearchEntry({ name: 'A', provider: 'brave', apiKey: 'BSA-1' })[0]!;
  saveWebSearchEntry({ name: 'B', provider: 'deepseek', apiKey: 'sk-1', useForFetch: false });
  // 新建 B 抢走了选中，先选回 A 再删 A，才会走到「回落到剩余第一条」分支。
  selectWebSearchEntry(a.id);
  const remaining = removeWebSearchEntry(a.id);
  expect(remaining).toHaveLength(1);
  expect(readWebSearchConfig()?.name).toBe('B');
  removeWebSearchEntry(remaining[0]!.id);
  expect(readWebSearchConfig()).toBeNull();
  expect(capabilityCalls.at(-1)).toEqual({ names: ['web_search'], enabled: false });
});

it('选择条目即视为要用搜索，顺带启用 web_search 工具', () => {
  const entry = saveWebSearchEntry({ name: 'A', provider: 'brave', apiKey: 'BSA-1' })[0]!;
  capabilityCalls.length = 0;
  selectWebSearchEntry(entry.id);
  expect(capabilityCalls).toEqual([{ names: ['web_search'], enabled: true }]);
  expect(() => selectWebSearchEntry('00000000-0000-4000-8000-000000000000')).toThrow(/不存在/);
});

it('聊天侧选「关闭」即清空选中并关掉 web_search 工具', () => {
  saveWebSearchEntry({ name: 'A', provider: 'brave', apiKey: 'BSA-1' });
  capabilityCalls.length = 0;
  selectWebSearchEntry(null);
  expect(readWebSearchConfig()).toBeNull();
  expect(capabilityCalls).toEqual([{ names: ['web_search'], enabled: false }]);
});

it('设置里新建即选中并启用 web_search，删空自动停用', () => {
  const list = saveWebSearchEntry({ name: 'A', provider: 'brave', apiKey: 'BSA-1' });
  expect(readWebSearchConfig()?.id).toBe(list[0]!.id);
  expect(capabilityCalls).toEqual([{ names: ['web_search'], enabled: true }]);
  removeWebSearchEntry(list[0]!.id);
  expect(readWebSearchConfig()).toBeNull();
  expect(capabilityCalls).toEqual([
    { names: ['web_search'], enabled: true },
    { names: ['web_search'], enabled: false },
  ]);
});

it('更新时传入已删除的 id 会报错，不会按新建复活条目', () => {
  saveWebSearchEntry({ name: 'A', provider: 'brave', apiKey: 'BSA-1' });
  expect(() =>
    saveWebSearchEntry({
      id: '00000000-0000-4000-8000-000000000000',
      name: '幽灵',
      provider: 'brave',
      apiKey: 'BSA-2',
    }),
  ).toThrow(/不存在/);
  expect(listWebSearchEntries()).toHaveLength(1);
});

it('上限只拒绝真正新增，编辑已有条目不受限', () => {
  let list: ReturnType<typeof listWebSearchEntries> = [];
  for (let i = 0; i < 16; i++)
    list = saveWebSearchEntry({ name: `S${i}`, provider: 'brave', apiKey: 'BSA-1' });
  expect(() => saveWebSearchEntry({ name: 'S16', provider: 'brave', apiKey: 'BSA-1' })).toThrow(
    /16/,
  );
  saveWebSearchEntry({ id: list[0]!.id, name: 'S0 改', provider: 'brave', apiKey: 'BSA-2' });
  expect(listWebSearchEntries()).toHaveLength(16);
});

it('聊天侧选择器数据脱敏且不含密钥', () => {
  saveWebSearchEntry({ name: 'A', provider: 'brave', apiKey: 'BSA-1' });
  const options = listWebSearchOptions();
  expect(options.entries).toEqual([
    { id: readWebSearchConfig()!.id, name: 'A', provider: 'brave' },
  ]);
  expect(options.selectedId).toBe(readWebSearchConfig()!.id);
  expect(JSON.stringify(options)).not.toContain('BSA-1');
});

it('设置中禁用搜索工具后，聊天选择器应显示关闭', async () => {
  const { setBuiltinCapabilities, readDisabledTools } =
    await vi.importActual<typeof import('../tools')>('../tools');
  const entry = saveWebSearchEntry({ name: 'A', provider: 'brave', apiKey: 'BSA-1' })[0]!;
  setBuiltinCapabilities(['web_search'], true);
  expect(listWebSearchOptions().selectedId).toBe(entry.id);

  setBuiltinCapabilities(['web_search'], false);

  expect(readDisabledTools().has('web_search')).toBe(true);
  expect(listWebSearchOptions().selectedId).toBeNull();
});

it('密钥导入只认官方端点且中转网关不算 DeepSeek', () => {
  const sources = listWebSearchKeySources();
  expect(sources).toEqual([{ id: 'p1', name: 'DeepSeek 官方' }]);
  expect(readWebSearchKey('p1')).toBe('sk-school');
  expect(readWebSearchKey('p2')).toBeNull();
});

it('自定义端点按请求体走 POST、替换占位，并识别非 SearXNG 的结果结构', async () => {
  const fetch = vi.fn(async () =>
    Response.json({
      data: { webPages: { value: [{ name: '标题', url: 'https://a.cn', snippet: '摘要' }] } },
    }),
  );
  vi.stubGlobal('fetch', fetch);
  try {
    saveWebSearchEntry(
      webSearchEntryInputSchema.parse({
        name: 'POST',
        provider: 'custom',
        url: 'https://search.example/v1',
        body: '{ "query": "{query}", "count": {count} }',
        headers: { Authorization: 'Bearer k' },
      }),
    );
    expect(await webSearch('交大 "新闻"', 3)).toMatchObject({
      results: [{ title: '标题', url: 'https://a.cn', snippet: '摘要' }],
    });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://search.example/v1');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ query: '交大 "新闻"', count: 3 });

    fetch.mockResolvedValueOnce(Response.json({ answer: 'x' }));
    await expect(webSearch('q')).rejects.toThrow('answer');
  } finally {
    vi.unstubAllGlobals();
  }
});

it('自定义端点不含 {query} 时仍按 SearXNG 追加参数', async () => {
  const fetch = vi.fn(async () =>
    Response.json({ results: [{ title: 't', url: 'https://b.cn', content: 'c' }] }),
  );
  vi.stubGlobal('fetch', fetch);
  try {
    saveWebSearchEntry({ name: 'S', provider: 'custom', url: 'https://searx.example/search' });
    expect((await webSearch('a b')).results).toHaveLength(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://searx.example/search?q=a+b&format=json');
    expect(init.method).toBe('GET');
  } finally {
    vi.unstubAllGlobals();
  }
});

it('请求体模板替换占位后必须是 JSON', () => {
  const entry = { name: 'X', provider: 'custom', url: 'https://x.example' };
  expect(webSearchEntryInputSchema.safeParse({ ...entry, body: '{"q": {count}}' }).success).toBe(
    true,
  );
  expect(webSearchEntryInputSchema.safeParse({ ...entry, body: 'q={query}' }).success).toBe(false);
});
