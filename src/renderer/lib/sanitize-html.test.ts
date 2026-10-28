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

  it('resolves relative links and images against the base url', () => {
    const doc = body('<a href="/courses/1">课程</a><img src="/files/2.png">');
    expect(doc.querySelector('a')!.getAttribute('href')).toBe('https://oc.sjtu.edu.cn/courses/1');
    expect(doc.querySelector('img')!.getAttribute('src')).toBe(
      'https://oc.sjtu.edu.cn/files/2.png',
    );
  });
});
