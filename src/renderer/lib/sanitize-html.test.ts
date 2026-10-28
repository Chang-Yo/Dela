// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { sanitizeHtml } from './sanitize-html';

const body = (html: string) =>
  new DOMParser().parseFromString(sanitizeHtml(html, 'https://oc.sjtu.edu.cn/', 14), 'text/html')
    .body;

describe('sanitizeHtml', () => {
  it('drops javascript: links inside svg', () => {
    const doc = body('<svg><a href="javascript:alert(1)"><text>x</text></a></svg>');
    expect(doc.innerHTML).not.toContain('javascript:');
  });

  it('drops script vectors outside a fixed tag list', () => {
    const doc = body(
      '<svg><a><animate attributeName="href" to="javascript:alert(1)"/><text>x</text></a>' +
        '<set attributeName="onmouseover" to="alert(1)"/></svg>' +
        '<math><mtext><style><img src=x onerror=alert(1)></style></mtext></math>' +
        '<details open ontoggle="alert(1)"></details><form><input></form>',
    );
    expect(doc.querySelector('animate,set,form')).toBeNull();
    expect(doc.innerHTML).not.toMatch(/javascript:|onerror|ontoggle/);
  });

  it('keeps ordinary course markup and inline svg', () => {
    const doc = body(
      '<table><tr><td style="color:red">第1周</td></tr></table><svg><circle r="4"/></svg>',
    );
    expect(doc.querySelector('td')!.getAttribute('style')).toBe('color:red');
    expect(doc.querySelector('svg circle')).not.toBeNull();
  });

  it('resolves relative links and images against the base url', () => {
    const doc = body('<a href="/courses/1">课程</a><img src="/files/2.png">');
    expect(doc.querySelector('a')!.getAttribute('href')).toBe('https://oc.sjtu.edu.cn/courses/1');
    expect(doc.querySelector('img')!.getAttribute('src')).toBe(
      'https://oc.sjtu.edu.cn/files/2.png',
    );
  });
});
