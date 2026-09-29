// fetch_page 的 offset 续读、source 来源元数据、PDF 直链与 2MB 截断报告。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../resource-parse', () => ({ extractDocumentBytes: vi.fn() }));

import { extractDocumentBytes } from '../../../../resource-parse';
import { fetchPageTool, fetchWebPage } from '../fetch-page';

beforeEach(() => vi.resetAllMocks());
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
