import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWebPage } from '../web-fetch';

vi.mock('../../documents/parse', () => ({
  extractPdfText: vi.fn(async () => ({ text: 'PDF 正文', pages: 1, hasTextLayer: true })),
}));

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

  it('保留无标题正文、article header 和定位布局内容', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          `
      <p>无标题正文</p><article><header><h1>文章标题</h1></header>
      <div class="sticky">定位正文</div><aside>补充资料</aside></article>
    `,
          { headers: { 'content-type': 'text/html' } },
        ),
      ),
    );
    const page = await fetchWebPage('https://example.com');
    for (const content of ['无标题正文', '文章标题', '定位正文', '补充资料']) {
      expect(page.text).toContain(content);
    }
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

  it('纯文本保持原样，PDF 继续走文档提取', async () => {
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
    expect(await fetchWebPage('https://example.com/file.pdf')).toMatchObject({
      title: null,
      text: 'PDF 正文',
      pages: 1,
      hasTextLayer: true,
    });
  });
});
