// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { FRAME_SCRIPT, htmlFrameDocument } from './html-frame-document';

const parse = (html: string, options: Parameters<typeof htmlFrameDocument>[1]) =>
  new DOMParser().parseFromString(htmlFrameDocument(html, options), 'text/html');
const body = (html: string) =>
  parse(html, { baseUrl: 'https://oc.sjtu.edu.cn/', rootSize: 14 }).body;

describe('htmlFrameDocument', () => {
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

  it('drops relative and local addresses unless the caller allows them', () => {
    const local = 'dela-resource://workspace/a.png';
    const html = `<a href="/x">x</a><img src="${local}"><img data-dela-lazy="${local}" data-dela-zoom="${local}">`;
    const doc = parse(html, { rootSize: 14 });
    expect(doc.querySelector('a')!.hasAttribute('href')).toBe(false);
    expect(doc.body.innerHTML).not.toContain('dela-resource:');
    const allowed = parse(html, { rootSize: 14, localImages: 'dela-resource://workspace/' });
    expect(allowed.querySelector('img')!.getAttribute('src')).toBe(local);
    expect(allowed.querySelector('[data-dela-lazy],[data-dela-zoom]')).toBeNull();
  });
});

describe('frame script', () => {
  function click(markup: string, selector: string) {
    const frame = document.implementation.createHTMLDocument();
    frame.body.innerHTML = markup;
    vi.stubGlobal('document', frame);
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
      },
    );
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
      },
    );
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    new Function(FRAME_SCRIPT)();
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    frame.querySelector(selector)!.dispatchEvent(event);
    const messages = post.mock.calls
      .map(([data]) => data as { source: string })
      .filter((data) => data.source !== 'dela-frame-height');
    post.mockRestore();
    vi.unstubAllGlobals();
    return { prevented: event.defaultPrevented, messages };
  }

  it('reports link clicks instead of navigating', () => {
    expect(click('<a href="https://example.com/a"><b>x</b></a>', 'b')).toEqual({
      prevented: true,
      messages: [{ source: 'dela-frame-link', href: 'https://example.com/a' }],
    });
  });

  it('leaves in-page anchors to the frame', () => {
    expect(click('<a href="#notes">x</a>', 'a')).toEqual({ prevented: false, messages: [] });
  });

  it('reports zoomable images before their surrounding link', () => {
    expect(
      click(
        '<a href="https://example.com/a"><img data-dela-zoom="https://example.com/big.png" alt="图"></a>',
        'img',
      ),
    ).toEqual({
      prevented: true,
      messages: [{ source: 'dela-frame-image', src: 'https://example.com/big.png', alt: '图' }],
    });
  });
});
