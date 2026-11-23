import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWebPage } from '../web-fetch';

afterEach(() => vi.unstubAllGlobals());

describe('web_fetch', () => {
  it('保留标题、链接、表格与代码，过滤导航和脚本', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          `
      <html><head><title>资料 &amp; 示例</title></head><body>
      <nav>导航内容</nav><main><h1>说明</h1><p><a href="./guide">指南</a></p>
      <table><tr><th>名称</th><th>价格</th></tr><tr><td>A</td><td>免费</td></tr></table>
      <pre><code class="language-js">const x = 1;</code></pre>
      <script>脚本内容</script></main><footer>页脚内容</footer></body></html>
    `,
          { headers: { 'content-type': 'text/html; charset=utf-8' } },
        ),
      ),
    );
    const page = await fetchWebPage('https://example.com/docs/page');
    expect(page.title).toBe('资料 & 示例');
    expect(page.text).toContain('# 说明');
    expect(page.text).toContain('[指南](https://example.com/docs/guide)');
    expect(page.text).toContain('| 名称 | 价格 |');
    expect(page.text).toContain('```js\nconst x = 1;\n```');
    expect(page.text).not.toMatch(/导航内容|脚本内容|页脚内容/);
  });

  it('相对链接基于重定向后的地址解析，Markdown 可按 offset 续读', async () => {
    const html = '<p><a href="guide">指南</a></p><p>' + '正文'.repeat(11000) + '</p>';
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(async (url: URL) =>
          url.pathname === '/start'
            ? new Response(null, { status: 302, headers: { location: '/docs/page' } })
            : new Response(html, { headers: { 'content-type': 'text/html' } }),
        ),
    );
    const first = await fetchWebPage('https://example.com/start');
    const second = await fetchWebPage('https://example.com/start', first.nextOffset!);
    expect(first.source.url).toBe('https://example.com/docs/page');
    expect(first.text).toContain('[指南](https://example.com/docs/guide)');
    expect(first.nextOffset).toBe(20000);
    expect(second.nextOffset).toBeNull();
    expect((first.text + second.text).length).toBe(first.totalCharacters);
    expect(first.truncated).toBe(false);
  });

  it('纯文本保持原样，PDF 交给 read_document 而不在这里下载', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response('普通 <文本>', { headers: { 'content-type': 'text/plain' } }),
        )
        .mockResolvedValueOnce(
          new Response('%PDF-', { headers: { 'content-type': 'application/pdf' } }),
        ),
    );
    expect((await fetchWebPage('https://example.com/text')).text).toBe('普通 <文本>');
    const pdf = await fetchWebPage('https://example.com/file.pdf');
    expect(pdf).toMatchObject({
      title: null,
      text: '',
      readable: false,
      nextOffset: null,
      truncated: false,
      note: expect.stringContaining('read_document'),
    });
  });

  it('PDF 重定向后记录最终来源地址', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: '/download' } }),
      )
      .mockResolvedValueOnce(
        new Response('%PDF-1.7', { headers: { 'content-type': 'application/pdf' } }),
      );
    vi.stubGlobal('fetch', fetch);
    const pdf = await fetchWebPage('https://example.com/start');
    expect(pdf.source.url).toBe('https://example.com/download');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('普通网页仍按 2 MiB 截断并说明内容不完整', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('x'.repeat(2 * 1024 * 1024 + 1), {
          headers: { 'content-type': 'text/plain' },
        }),
      ),
    );
    expect(await fetchWebPage('https://example.com/text')).toMatchObject({
      truncated: true,
      totalCharacters: 2 * 1024 * 1024,
      note: expect.stringContaining('内容可能不完整'),
    });
  });

  it('注册 DeepSeek 且开启网页读取时优先走官方抓取', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ title: 'DeepSeek 标题', content: '正文'.repeat(11000) }), {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const page = await fetchWebPage('https://example.com/page', 0, { apiKey: 'sk-test' });
    expect(page).toMatchObject({ title: 'DeepSeek 标题', contentType: 'text/markdown' });
    expect(page.nextOffset).toBe(20000);
    expect(page.text).toHaveLength(20000);
    expect(page.source.url).toBe('https://example.com/page');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]![0]).toBe('https://api.deepseek.com/v1/tools/fetch');
  });

  it('DeepSeek 取不到正文时回退本地抓取', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"error":{"message":"not found"}}', { status: 404 }))
      .mockResolvedValueOnce(
        new Response('<p>本地正文</p>', { headers: { 'content-type': 'text/html' } }),
      );
    vi.stubGlobal('fetch', fetch);
    const page = await fetchWebPage('https://example.com/page', 0, { apiKey: 'sk-test' });
    expect(page.text).toContain('本地正文');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
