// fetch_page 的 offset 续读、source 来源元数据、PDF 直链与 2MB 截断报告。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// DNS 解析 mock：默认解析到公网地址，具体用例按需覆盖（SSRF 防线用例）。
const dns = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: dns.lookup }));
vi.mock('../../../../resource-parse', () => ({ extractDocumentBytes: vi.fn() }));

import { extractDocumentBytes } from '../../../../resource-parse';
import { assertPublicHttpUrl, fetchPageTool, fetchWebPage } from '../fetch-page';

beforeEach(() => {
  vi.resetAllMocks();
  dns.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
});
afterEach(() => vi.unstubAllGlobals());

/** 一页 25000 字符的 HTML 文档。 */
const longPage = () =>
  new Response(`<html><body><p>${'x'.repeat(25000)}</p></body></html>`, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });

describe('fetch_page 分页续读', () => {
  it('超长正文分段返回，nextOffset 指示续读位置', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => longPage()),
    );
    const first = await fetchWebPage('https://example.com/doc');
    expect(first.text).toHaveLength(20000);
    expect(first.totalCharacters).toBe(25000);
    expect(first.nextOffset).toBe(20000);
    expect(first.truncated).toBe(false);
    expect(first.note).toContain('offset=20000');

    const second = await fetchWebPage('https://example.com/doc', 20000);
    expect(second.text).toHaveLength(5000);
    expect(second.totalCharacters).toBe(25000);
    expect(second.nextOffset).toBeNull();
  });

  it('结果带 source 元数据（最终 URL 与抓取时间）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => longPage()),
    );
    const page = await fetchWebPage('https://example.com/doc');
    expect(page.source.url).toBe('https://example.com/doc');
    expect(Number.isNaN(Date.parse(page.source.fetchedAt))).toBe(false);
  });

  it('工具层把 offset 透传给抓取函数', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => longPage()),
    );
    await expect(
      fetchPageTool.execute({ url: 'https://example.com/doc', offset: 20000 }),
    ).resolves.toMatchObject({ text: 'x'.repeat(5000), nextOffset: null });
  });
});

describe('fetch_page PDF 直链', () => {
  it('提取 PDF 文字并报告页数与文本层', async () => {
    vi.mocked(extractDocumentBytes).mockResolvedValue({
      kind: 'pdf',
      text: 'PDF 正文',
      pages: 4,
      hasTextLayer: true,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
            headers: { 'content-type': 'application/pdf' },
          }),
      ),
    );
    await expect(fetchWebPage('https://example.com/paper.pdf')).resolves.toMatchObject({
      source: { url: 'https://example.com/paper.pdf' },
      pages: 4,
      hasTextLayer: true,
      text: 'PDF 正文',
      nextOffset: null,
    });
  });

  it('无文本层的扫描件在 note 中说明', async () => {
    vi.mocked(extractDocumentBytes).mockResolvedValue({
      kind: 'pdf',
      text: '',
      pages: 2,
      hasTextLayer: false,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
            headers: { 'content-type': 'application/pdf' },
          }),
      ),
    );
    await expect(fetchWebPage('https://example.com/scan.pdf')).resolves.toMatchObject({
      hasTextLayer: false,
      note: expect.stringContaining('扫描件'),
    });
  });
});

describe('fetch_page 读取上限', () => {
  it('超过 2MB 时 truncated 为 true 并说明内容可能不完整', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(new Uint8Array(3 * 1024 * 1024), {
            headers: { 'content-type': 'text/plain' },
          }),
      ),
    );
    await expect(fetchWebPage('https://example.com/huge')).resolves.toMatchObject({
      truncated: true,
      note: expect.stringContaining('2MB'),
    });
  });
});

describe('fetch_page SSRF 防线', () => {
  it('私网字面地址含 CGNAT 与 198.18.0.0/15 网段', () => {
    expect(() => assertPublicHttpUrl('http://100.64.0.1/')).toThrow('内网');
    expect(() => assertPublicHttpUrl('http://100.127.255.255/')).toThrow('内网');
    expect(() => assertPublicHttpUrl('http://198.18.0.5/')).toThrow('内网');
    expect(() => assertPublicHttpUrl('http://198.19.255.1/')).toThrow('内网');
    // 网段之外的公网地址不受影响。
    expect(assertPublicHttpUrl('http://100.128.0.1/').hostname).toBe('100.128.0.1');
    expect(assertPublicHttpUrl('http://100.63.0.1/').hostname).toBe('100.63.0.1');
    expect(assertPublicHttpUrl('http://198.20.0.1/').hostname).toBe('198.20.0.1');
  });

  it('域名解析到私网地址（DNS 重绑定）在请求前拒绝', async () => {
    dns.lookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.8', family: 4 },
    ]);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(fetchWebPage('https://rebind.example.com/doc')).rejects.toThrow('内网');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('重定向每跳复检 DNS：跳转到解析为环回的域名同样拒绝', async () => {
    const fetchSpy = vi.fn(async () =>
      Response.redirect('https://hop.example.com/next', 302),
    );
    vi.stubGlobal('fetch', fetchSpy);
    dns.lookup
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
      .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
    await expect(fetchWebPage('https://example.com/doc')).rejects.toThrow('内网');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
