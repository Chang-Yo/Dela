// @vitest-environment jsdom
// SheetJS 的 sheet_to_html 存在富文本/自定义格式未转义的注入面，消毒函数须全部拦下。
import { describe, expect, it } from 'vitest';
import { sanitizeTableHtml } from './SheetPreview';

describe('sanitizeTableHtml', () => {
  it('keeps ordinary tables intact', () => {
    const html = '<table><tr><td>普通文本 &amp; 数字</td><td>42</td></tr></table>';
    expect(sanitizeTableHtml(html)).toContain('普通文本 &amp; 数字');
    expect(sanitizeTableHtml(html)).toContain('<td>42</td>');
  });

  it('strips scripts, iframes and event handler attributes', () => {
    const html =
      '<table><tr><td onclick="alert(1)">x</td></tr></table>' +
      '<script>alert(1)</script><iframe srcdoc="<b>hi</b>"></iframe>';
    const clean = sanitizeTableHtml(html);
    expect(clean).not.toContain('script');
    expect(clean).not.toContain('iframe');
    expect(clean).not.toContain('onclick');
    expect(clean).toContain('<td>x</td>');
  });

  it('escapes attribute-injection payloads via DOMParser round-trip', () => {
    // SheetJS data-z 属性逃逸形态：属性值里带引号闭合 + 标签注入。
    // 序列化规范对属性值只转义 & 和 "（< > 保留），因此字符串里可能出现 <img 文本；
    // 判定标准是重新解析后不产生真实元素、载荷完整留在属性值内。
    const html =
      '<table><tr><td data-z="&quot;&gt;&lt;img src=x onerror=alert(1)&gt;">x</td></tr></table>';
    const clean = sanitizeTableHtml(html);
    const reparsed = new DOMParser().parseFromString(clean, 'text/html');
    expect(reparsed.querySelectorAll('img').length).toBe(0);
    expect(reparsed.querySelectorAll('td')[0]?.getAttribute('data-z')).toBe(
      '"><img src=x onerror=alert(1)>',
    );
  });

  it('drops javascript: and data: link protocols but keeps http', () => {
    const html =
      '<table><tr><td><a href="javascript:alert(1)">a</a></td>' +
      '<td><a href="data:text/html;base64,xxx">b</a></td>' +
      '<td><a href="https://example.com">c</a></td></tr></table>';
    const clean = sanitizeTableHtml(html);
    expect(clean).not.toContain('javascript:');
    expect(clean).not.toContain('data:text/html');
    expect(clean).toContain('href="https://example.com"');
  });

  it('blocks entity-encoded scheme smuggling that defeats a regex blacklist', () => {
    // 实体解码后的 tab/换行会被 URL 解析从 scheme 中剥掉（java\tscript: → javascript:），
    // 正则黑名单匹配不到；白名单须按解析后的 protocol 判定。相对链接同样剥除。
    const html =
      '<table><tr>' +
      '<td><a href="java&#9;script:alert(1)">a</a></td>' +
      '<td><a href="jav&#10;ascript:alert(1)">b</a></td>' +
      '<td><a href="vbs&#13;cript:msgbox(1)">c</a></td>' +
      '<td><a href="page.html">d</a></td>' +
      '</tr></table>';
    const reparsed = new DOMParser().parseFromString(sanitizeTableHtml(html), 'text/html');
    expect(reparsed.querySelectorAll('a[href]')).toHaveLength(0);
  });
});
