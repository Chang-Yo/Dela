import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertPublicHttpUrl, fetchWebPage, htmlToText } from '../fetch-page';
import { parseSearxngResults, searchWeb } from '../searxng';

// 结构取自 SearXNG /search?format=json 实际响应（脱敏缩减）。
const searxngFixture = {
  query: 'sjtu canvas',
  results: [
    {
      url: 'https://oc.sjtu.edu.cn/login/canvas',
      title: '登录到 Canvas - SJTU',
      content: '请登录 Canvas 以访问\n  上海交通大学的在线学习平台。',
    },
    { url: 'https://example.com/no-title', title: null, content: null },
    { title: '无链接项应被丢弃', content: 'snippet' },
  ],
  answers: [],
  corrections: [],
  infoboxes: [],
  suggestions: [],
  unresponsive_engines: [],
};

describe('web search', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('maps searxng results, drops link-less items and normalizes snippets', () => {
    const results = parseSearxngResults(searxngFixture);
    expect(results).toEqual([
      {
        title: '登录到 Canvas - SJTU',
        url: 'https://oc.sjtu.edu.cn/login/canvas',
        snippet: '请登录 Canvas 以访问 上海交通大学的在线学习平台。',
      },
      { title: 'https://example.com/no-title', url: 'https://example.com/no-title', snippet: '' },
    ]);
  });

  it('requests the searxng json api with query and language', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(searxngFixture), {
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const results = await searchWeb('sjtu canvas', 'zh-cn');
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe('http://47.117.158.218:8778/search?q=sjtu+canvas&format=json&language=zh-cn');
    expect(init.method).toBeUndefined();
    expect(results).toHaveLength(2);
  });

  it('reports unresponsive engines when no result came back', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              results: [],
              unresponsive_engines: [
                ['google', 'timeout'],
                ['bing', 'captcha'],
              ],
            }),
            { headers: { 'content-type': 'application/json' } },
          ),
      ),
    );
    await expect(searchWeb('anything')).rejects.toThrow('google、bing');
  });

  it('reports http errors, with a dedicated hint for json-disabled instances', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('forbidden', { status: 403 })),
    );
    await expect(searchWeb('anything')).rejects.toThrow('search.formats');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 502 })),
    );
    await expect(searchWeb('anything')).rejects.toThrow('HTTP 502');
  });

  it('allows public http(s) URLs and blocks local or private targets', () => {
    expect(assertPublicHttpUrl('https://example.com/page').hostname).toBe('example.com');
    expect(assertPublicHttpUrl('http://example.com:80/x').port).toBe('');
    for (const blocked of [
      'http://localhost/admin',
      'http://127.0.0.1:80/',
      'http://10.0.0.1/',
      'http://192.168.1.1/',
      'http://172.16.0.1/',
      'http://172.31.255.255/',
      'http://169.254.169.254/',
      'http://[::1]/',
      'http://[fd00::1]/',
      'http://[fe80::1]/',
      'http://example.com:8080/',
      'file:///etc/passwd',
      'ftp://example.com/',
    ]) {
      expect(() => assertPublicHttpUrl(blocked)).toThrow();
    }
  });

  it('follows redirects but refuses redirect targets on private networks', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/x' } }),
      ),
    );
    await expect(fetchWebPage('https://example.com/start')).rejects.toThrow('内网');
  });

  it('converts fetched HTML pages to plain text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            '<html><head><title>页面</title><style>a{}</style><script>bad()</script></head>' +
              '<body><h1>标题</h1><p>第一段 &amp; 实体</p><div>第二段</div></body></html>',
            { headers: { 'content-type': 'text/html; charset=utf-8' } },
          ),
      ),
    );
    const page = await fetchWebPage('https://example.com/doc');
    expect(page).toMatchObject({ title: '页面', contentType: 'text/html; charset=utf-8' });
    expect(page.text).toBe('标题\n第一段 & 实体\n第二段');
    expect(page.truncated).toBe(false);
  });
});

describe('htmlToText', () => {
  it('strips scripts, styles and comments and decodes entities', () => {
    const { title, text } = htmlToText(
      '<!-- note --><title>T &amp; U</title><body>' +
        '<script>fetch("http://evil")</script><noscript>x</noscript>' +
        '<p>alpha &#x4e2d;&#25991; &nbsp;beta</p></body>',
    );
    expect(title).toBe('T & U');
    expect(text).toBe('alpha 中文 beta');
  });
});
