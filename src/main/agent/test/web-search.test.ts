import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertPublicHttpUrl,
  decodeDdgUrl,
  fetchWebPage,
  htmlToText,
  parseDdgLiteResults,
  searchWeb,
} from '../web-search';

// 结构取自 2026-09-18 抓取的 lite.duckduckgo.com 真实响应（脱敏缩减）。
const ddgLiteFixture = `
<form action="/lite/" method="post">
  <input class='query' type="text" name="q" value="sjtu canvas">
</form>
<a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Foc.sjtu.edu.cn%2Flogin%2Fcanvas&amp;rut=abc" class='result-link'>登录到 Canvas - SJTU</a>
</td>
<tr><td>&nbsp;&nbsp;&nbsp;</td><td class='result-snippet'>
  请登录<b>Canvas</b>以访问上海交通大学的在线学习平台和课程资源。
</td></tr>
<a rel="nofollow" href="https://example.com/direct-page" class='result-link'>Direct &amp; Co</a>
</td>
<tr><td class='result-snippet'>plain snippet</td></tr>
<a rel="nofollow" href="//duckduckgo.com/ad?ad_domain=spam.example" class='result-link'>Ad</a>
`;

describe('web search', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('parses lite results with decoded redirect URLs and clean snippets', () => {
    const results = parseDdgLiteResults(ddgLiteFixture);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      title: '登录到 Canvas - SJTU',
      url: 'https://oc.sjtu.edu.cn/login/canvas',
      snippet: '请登录Canvas以访问上海交通大学的在线学习平台和课程资源。',
    });
    expect(results[1]).toMatchObject({
      title: 'Direct & Co',
      url: 'https://example.com/direct-page',
      snippet: 'plain snippet',
    });
  });

  it('decodes or rejects DDG redirect hrefs', () => {
    expect(decodeDdgUrl('//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1')).toBe(
      'https://example.com/a?b=1',
    );
    expect(decodeDdgUrl('http://example.com/plain')).toBe('http://example.com/plain');
    expect(decodeDdgUrl('//duckduckgo.com/l/?rut=missing-target')).toBeNull();
    expect(decodeDdgUrl('//duckduckgo.com/ad?ad_domain=spam.example')).toBeNull();
    expect(decodeDdgUrl('javascript:alert(1)')).toBeNull();
    expect(decodeDdgUrl('not a url')).toBeNull();
  });

  it('posts the query and returns parsed results', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(ddgLiteFixture, { headers: { 'content-type': 'text/html; charset=utf-8' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const results = await searchWeb('sjtu canvas');
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe('https://lite.duckduckgo.com/lite/');
    expect(init.method).toBe('POST');
    expect(String(init.body)).toContain('q=sjtu+canvas');
    expect(results).toHaveLength(2);
  });

  it('reports rate limiting when DDG answers with an anomaly page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>anomaly challenge page</html>', { status: 200 })),
    );
    await expect(searchWeb('anything')).rejects.toThrow('暂时限制');
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
