// 搜索服务注册：workspace_settings 读写往返、旧版 { url } 迁移、brave 遗留 endpoint
// 字段剥离、非法配置拒绝、未注册时工具报错引导，以及三家 provider 的请求与响应
// 映射（fetch 桩）：Brave LLM Context、Google、自定义端点（含自定义请求头）。
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const state = vi.hoisted(() => ({ root: '' }));
vi.mock('electron', () => ({ app: { getPath: () => state.root } }));
import { closeDatabase, getDatabase } from '../../../../database';
import { readWebSearchConfig, webSearchTool, writeWebSearchConfig } from '../websearch';
import type { WebSearchConfig } from '../../../../../shared/capabilities';

beforeAll(() => {
  state.root = mkdtempSync(join(tmpdir(), 'dela-websearch-'));
  getDatabase();
});

afterAll(() => {
  vi.unstubAllGlobals();
  closeDatabase();
  rmSync(state.root, { recursive: true, force: true });
});

const lastCall = () => vi.mocked(fetch).mock.calls.at(-1) as [string, RequestInit];

describe('搜索服务注册', () => {
  it('未注册时读取为 null，工具执行报错引导去设置', async () => {
    writeWebSearchConfig(null);
    expect(readWebSearchConfig()).toBeNull();
    await expect(webSearchTool.execute({ query: 'x' }, {})).rejects.toThrow('设置');
  });

  it('三家配置保存后读回；缺字段拒绝；null 清除', () => {
    const brave: WebSearchConfig = { provider: 'brave', apiKey: ' k1 ' };
    expect(writeWebSearchConfig(brave)).toEqual({ provider: 'brave', apiKey: 'k1' });
    expect(readWebSearchConfig()).toEqual({ provider: 'brave', apiKey: 'k1' });
    const custom: WebSearchConfig = {
      provider: 'custom',
      url: 'https://example.com/search',
      headers: { Authorization: 'Bearer t' },
    };
    expect(writeWebSearchConfig(custom)).toEqual(custom);
    expect(() => writeWebSearchConfig({ provider: 'brave', apiKey: '' } as never)).toThrow();
    expect(() => writeWebSearchConfig({ provider: 'google', apiKey: 'k' } as never)).toThrow();
    expect(() =>
      writeWebSearchConfig({
        provider: 'custom',
        url: 'https://example.com/search',
        headers: { 'bad key with space': 'v' },
      } as never),
    ).toThrow();
    writeWebSearchConfig(null);
    expect(readWebSearchConfig()).toBeNull();
  });

  it('旧版 { url } 迁移为自定义端点；brave 遗留 endpoint 字段剥离', () => {
    const upsert = (value: string) =>
      getDatabase()
        .prepare("INSERT OR REPLACE INTO workspace_settings VALUES ('web-search-api', ?)")
        .run(value);
    upsert(JSON.stringify({ url: 'https://legacy.example.com/search' }));
    expect(readWebSearchConfig()).toEqual({
      provider: 'custom',
      url: 'https://legacy.example.com/search',
    });
    upsert(JSON.stringify({ provider: 'brave', apiKey: 'k1', endpoint: 'llm' }));
    expect(readWebSearchConfig()).toEqual({ provider: 'brave', apiKey: 'k1' });
    writeWebSearchConfig(null);
  });

  it('Brave LLM Context：订阅令牌请求专用端点，freshness 透传，合并 grounding 的 generic/map/poi', async () => {
    writeWebSearchConfig({ provider: 'brave', apiKey: 'k1' });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              grounding: {
                generic: [
                  {
                    url: 'https://a.example/1',
                    title: '结果一',
                    snippets: ['片段一', ' 片段 二 '],
                  },
                ],
                map: [{ url: 'https://m.example/9', title: '地点', snippets: ['位置'] }],
                poi: null,
              },
            }),
            { status: 200 },
          ),
      ),
    );
    const result = (await webSearchTool.execute({ query: 'x', freshness: 'pw' }, {})) as {
      provider: string;
      results: { url: string; snippet: string }[];
    };
    const [url, init] = lastCall();
    expect(url).toContain('https://api.search.brave.com/res/v1/llm/context?q=');
    expect(url).toContain('freshness=pw');
    expect((init.headers as Record<string, string>)['x-subscription-token']).toBe('k1');
    expect(result.provider).toBe('brave');
    expect(result.results).toEqual([
      { url: 'https://a.example/1', title: '结果一', snippet: '片段一 片段 二' },
      { url: 'https://m.example/9', title: '地点', snippet: '位置' },
    ]);
    writeWebSearchConfig(null);
  });

  it('Google：key/cx/num 进查询串并映射 items', async () => {
    writeWebSearchConfig({ provider: 'google', apiKey: 'k2', cx: 'cx1' });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              items: [{ link: 'https://b.example/2', title: '结果二', snippet: '摘要' }],
            }),
            { status: 200 },
          ),
      ),
    );
    const result = (await webSearchTool.execute({ query: 'x', count: 3 }, {})) as {
      results: { url: string }[];
    };
    const [url] = lastCall();
    expect(url).toContain('https://www.googleapis.com/customsearch/v1?');
    expect(url).toContain('key=k2');
    expect(url).toContain('cx=cx1');
    expect(url).toContain('num=3');
    expect(result.results).toEqual([
      { url: 'https://b.example/2', title: '结果二', snippet: '摘要' },
    ]);
    writeWebSearchConfig(null);
  });

  it('自定义端点：SearXNG 兼容 JSON、自定义请求头随请求发送；403 给出认证提示', async () => {
    writeWebSearchConfig({
      provider: 'custom',
      url: 'https://search.example.com/search',
      headers: { Authorization: 'Bearer t1' },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              results: [{ url: 'https://c.example/3', title: '结果三', content: ' 摘要 ' }],
            }),
            { status: 200 },
          ),
      ),
    );
    const result = (await webSearchTool.execute({ query: 'x' }, {})) as {
      results: { title: string; snippet: string }[];
    };
    const [url, init] = lastCall();
    expect(url).toContain('https://search.example.com/search?q=');
    expect(init.headers).toMatchObject({ accept: 'application/json', Authorization: 'Bearer t1' });
    expect(result.results).toEqual([
      { url: 'https://c.example/3', title: '结果三', snippet: '摘要' },
    ]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('denied', { status: 403 })),
    );
    await expect(webSearchTool.execute({ query: 'x' }, {})).rejects.toThrow('认证失败');
    writeWebSearchConfig(null);
  });
});
