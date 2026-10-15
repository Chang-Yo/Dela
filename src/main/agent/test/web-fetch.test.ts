import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchWebPage } from '../web-fetch';
import { releaseDocumentResource } from '../../resources';
import { assertDocumentDependency } from '../../documents/runtime';

const profile = vi.hoisted(() => ({ root: '' }));
profile.root = mkdtempSync(join(tmpdir(), 'dela-web-document-'));
vi.mock('electron', () => ({ app: { getPath: () => profile.root } }));
vi.mock('../../documents/runtime', () => ({
  DOCUMENT_SKILL: 'document-reading',
  assertDocumentDependency: vi.fn(),
  documentPython: () => 'component/python.exe',
}));
vi.mock('../../canvas/api', () => ({}));
vi.mock('../../workspace/api', () => ({}));
vi.mock('../../mail/api', () => ({}));
vi.mock('../../shuiyuan/api', () => ({}));
vi.mock('../../storage', () => ({}));

afterEach(() => vi.unstubAllGlobals());
afterAll(() => rm(profile.root, { recursive: true, force: true }));

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

  it('纯文本保持原样，PDF 返回完整临时任务而不在主进程解析', async () => {
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
      document: { python: 'component/python.exe', jobId: expect.stringMatching(/^job-/) },
    });
    expect(await readFile(pdf.document!.input, 'utf8')).toBe('%PDF-');
    await releaseDocumentResource(pdf.document!.jobId);
  });

  it('识别分块响应中的 PDF 文件头，并保留超过网页 2 MiB 上限的完整文件', async () => {
    const contents = Buffer.concat([
      Buffer.from('%PDF-1.7\n'),
      Buffer.alloc(2 * 1024 * 1024 + 10, 65),
    ]);
    const chunks = [contents.subarray(0, 2), contents.subarray(2, 5), contents.subarray(5)];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream({
            pull(controller) {
              const chunk = chunks.shift();
              if (chunk) controller.enqueue(chunk);
              else controller.close();
            },
          }),
          { headers: { 'content-type': 'application/octet-stream' } },
        ),
      ),
    );
    const pdf = await fetchWebPage('https://example.com/download');
    expect(pdf.readable).toBe(false);
    expect(pdf.truncated).toBe(false);
    expect((await readFile(pdf.document!.input)).equals(contents)).toBe(true);
    await releaseDocumentResource(pdf.document!.jobId);
  });

  it('PDF 重定向只下载一次，任务记录最终来源地址', async () => {
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
    await releaseDocumentResource(pdf.document!.jobId);
  });

  it('下载中断时清理未完成任务', async () => {
    let pulls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream({
            pull(controller) {
              if (pulls++ === 0) controller.enqueue(Buffer.from('%PDF-1.7'));
              else controller.error(new Error('download interrupted'));
            },
          }),
          { headers: { 'content-type': 'application/pdf' } },
        ),
      ),
    );
    await expect(fetchWebPage('https://example.com/file')).rejects.toThrow('download interrupted');
    expect(await readdir(join(profile.root, 'dela-document-reading'))).toEqual([]);
  });

  it('PDF 超过下载上限时明确失败，不留下截断文件', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('%PDF-', {
          headers: {
            'content-type': 'application/pdf',
            'content-length': String(128 * 1024 * 1024 + 1),
          },
        }),
      ),
    );
    await expect(fetchWebPage('https://example.com/large')).rejects.toThrow('128 MiB');
    expect(await readdir(join(profile.root, 'dela-document-reading'))).toEqual([]);
  });

  it('依赖缺失时提示安装并取消 PDF 响应，不创建任务', async () => {
    const cancel = vi.fn();
    vi.mocked(assertDocumentDependency).mockImplementationOnce(() => {
      throw new Error('请先在设置 › Skills 安装文档读取组件');
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(Buffer.from('%PDF-1.7'));
            },
            cancel,
          }),
          { headers: { 'content-type': 'application/pdf' } },
        ),
      ),
    );
    await expect(fetchWebPage('https://example.com/file')).rejects.toThrow('安装文档读取组件');
    expect(cancel).toHaveBeenCalled();
    expect(await readdir(join(profile.root, 'dela-document-reading'))).toEqual([]);
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
});
