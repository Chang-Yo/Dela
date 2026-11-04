// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import appHtml from '../../index.html?raw';
import { injectFrameHeightReport } from './frame-height';

function clickLightboxImage(lightbox: boolean) {
  document.documentElement.removeAttribute('data-dela-lightbox');
  document.head.innerHTML = '';
  document.body.innerHTML =
    '<a class="lightbox" href="https://shuiyuan.sjtu.edu.cn/secure-uploads/original/a.jpeg"><img src="dela-resource://shuiyuan/secure-uploads/original/a.jpeg" alt="a"></a>';
  injectFrameHeightReport(document, { lightbox });
  const post = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
  new Function(document.querySelector('script')!.textContent!)();
  const click = new MouseEvent('click', { bubbles: true, cancelable: true });
  document.querySelector('img')!.dispatchEvent(click);
  const images = post.mock.calls.filter(
    ([data]) => (data as { source?: string }).source === 'dela-frame-image',
  );
  post.mockRestore();
  return { prevented: click.defaultPrevented, images };
}

it('reports lightbox image clicks instead of opening the link', () => {
  const { prevented, images } = clickLightboxImage(true);
  expect(prevented).toBe(true);
  expect(images).toEqual([
    [
      {
        source: 'dela-frame-image',
        src: 'dela-resource://shuiyuan/secure-uploads/original/a.jpeg',
        alt: 'a',
      },
      '*',
    ],
  ]);
});

it('leaves lightbox links alone when the frame did not opt in', () => {
  const { prevented, images } = clickLightboxImage(false);
  expect(prevented).toBe(false);
  expect(images).toEqual([]);
});

it('pins the injected script hash in both the frame and the app CSP', async () => {
  const doc = new DOMParser().parseFromString(
    '<head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'"></head><body></body>',
    'text/html',
  );
  injectFrameHeightReport(doc);
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(doc.querySelector('script')!.textContent!),
  );
  const hash = `'sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}'`;
  expect(doc.querySelector('meta')!.getAttribute('content')).toContain(hash);
  expect(appHtml).toContain(hash);
});

it('loads visible snapshot images and releases them offscreen while opening the original', () => {
  let changed!: IntersectionObserverCallback;
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        changed = callback;
      }
      observe() {}
    },
  );
  document.body.innerHTML =
    '<a class="lightbox"><img width="690" height="518" data-dela-image="dela-resource://shuiyuan-snapshot/42/image.jpg?thumbnail=1" data-dela-original="dela-resource://shuiyuan-snapshot/42/image.jpg"></a>';
  injectFrameHeightReport(document, { lightbox: true });
  const send = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
  new Function(document.querySelector('script')!.textContent!)();
  const img = document.querySelector('img')!;
  changed(
    [{ target: img, isIntersecting: true }] as unknown as IntersectionObserverEntry[],
    {} as IntersectionObserver,
  );
  expect(img.src).toContain('?thumbnail=1');
  img.click();
  expect(send).toHaveBeenCalledWith(
    { source: 'dela-frame-image', src: 'dela-resource://shuiyuan-snapshot/42/image.jpg', alt: '' },
    '*',
  );
  changed(
    [{ target: img, isIntersecting: false }] as unknown as IntersectionObserverEntry[],
    {} as IntersectionObserver,
  );
  expect(img.hasAttribute('src')).toBe(false);
  expect(img.width).toBe(690);
  send.mockRestore();
  vi.unstubAllGlobals();
});
