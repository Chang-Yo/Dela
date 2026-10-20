import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeepSeekError, fetchDeepSeek, searchDeepSeek } from '../deepseek';

afterEach(() => vi.unstubAllGlobals());

describe('deepseek search', () => {
  it('只取标题、链接与面向模型的长摘要（summary），忽略前端用的 snippet', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            { title: '  A  ', url: 'https://a.example', snippet: '短摘要', summary: '长摘要' },
            { title: 'B', url: 'https://b.example', summary: '只有长摘要' },
            { title: '无链接' },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetch);
    expect(await searchDeepSeek('查询', 5, 'sk-test')).toEqual([
      { title: 'A', url: 'https://a.example', snippet: '长摘要' },
      { title: 'B', url: 'https://b.example', snippet: '只有长摘要' },
    ]);
    const [url, init] = fetch.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('https://api.deepseek.com/v1/tools/search');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer sk-test');
    expect(JSON.parse(String(init.body))).toEqual({ query: '查询', count: 5 });
  });

  it('按 count 截断结果', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            results: Array.from({ length: 8 }, (_, index) => ({
              title: `T${index}`,
              url: `https://example.com/${index}`,
              snippet: 's',
            })),
          }),
          { status: 200 },
        ),
      ),
    );
    expect(await searchDeepSeek('q', 3, 'k')).toHaveLength(3);
  });

  it('非 2xx 抛带状态码的错误', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{"error":{"message":"limited"}}', { status: 429 })),
    );
    const error = await searchDeepSeek('q', 3, 'k').catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(DeepSeekError);
    expect((error as DeepSeekError).status).toBe(429);
    expect((error as DeepSeekError).message).toContain('429');
  });
});

describe('deepseek fetch', () => {
  it('返回标题与 Markdown 正文', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ title: ' 标题 ', content: '# 正文' }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetch);
    expect(await fetchDeepSeek('https://example.com/page', 'sk-test')).toEqual({
      title: '标题',
      text: '# 正文',
    });
    const [url, init] = fetch.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('https://api.deepseek.com/v1/tools/fetch');
    expect(JSON.parse(String(init.body))).toEqual({ url: 'https://example.com/page' });
  });

  it('取不到正文时抛 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{"error":{"message":"not found"}}', { status: 404 })),
    );
    const error = await fetchDeepSeek('https://example.com/page', 'k').catch(
      (cause: unknown) => cause,
    );
    expect(error).toBeInstanceOf(DeepSeekError);
    expect((error as DeepSeekError).status).toBe(404);
  });
});
