import DOMPurify from 'dompurify';

export type HtmlFrameDocumentOptions = {
  /** 相对地址按它补全；不给时相对地址一律剥除，避免补到外域造成请求泄露。 */
  baseUrl?: string;
  remoteImages?: boolean;
  /** 以此开头的本地资源图片（如主进程存好的快照）保留，并在 CSP 放行其协议。 */
  localImages?: string;
  fitWidth?: boolean;
  /** 不给时用白纸阅读样式。 */
  stylesheet?: string;
  /** 模块自己的可信改写，运行在消毒与地址过滤之后；可用 data-dela-lazy、data-dela-zoom 标记图片。 */
  transform?: (doc: Document) => void;
};

/**
 * 外层 CSP 要 pin 这段脚本的 sha256（见 src/app/renderer/index.html），改动须同步，
 * app/renderer/frame-script-csp.test.ts 会拦下漂移。除图片懒加载与滚动定位外脚本只上报，由外层处理。
 */
export const FRAME_SCRIPT = `(() => {
  const post = (data) => parent.postMessage(data, '*');
  const linkOf = (event) => {
    const link = event.target.closest('a[href]');
    return link && !link.getAttribute('href').startsWith('#') ? link : null;
  };
  const reportLink = (event, link) => {
    event.preventDefault();
    post({ source: 'dela-frame-link', href: link.href });
  };
  document.addEventListener('click', (event) => {
    const image = event.target.closest('[data-dela-zoom]');
    if (image) {
      event.preventDefault();
      post({ source: 'dela-frame-image', src: image.dataset.delaZoom, alt: image.getAttribute('alt') ?? '' });
      return;
    }
    const link = linkOf(event);
    if (link) reportLink(event, link);
  });
  document.addEventListener('auxclick', (event) => {
    const link = event.button === 1 && linkOf(event);
    if (link) reportLink(event, link);
  });
  const lazy = new IntersectionObserver((entries) => {
    for (const { target, isIntersecting } of entries)
      if (isIntersecting) target.src = target.dataset.delaLazy;
      else target.removeAttribute('src');
  });
  for (const image of document.querySelectorAll('img[data-dela-lazy]')) {
    image.addEventListener('load', () => {
      if (image.naturalWidth) image.style.aspectRatio = image.naturalWidth + ' / ' + image.naturalHeight;
    });
    lazy.observe(image);
  }
  addEventListener('scroll', () => post({ source: 'dela-frame-scroll', top: scrollY }));
  addEventListener('message', (event) => {
    if (event.source === parent && event.data?.source === 'dela-frame-scroll-to') scrollTo(0, event.data.top);
  });
  const reportHeight = () => post({ source: 'dela-frame-height', height: document.body.scrollHeight });
  new ResizeObserver(reportHeight).observe(document.documentElement);
  reportHeight();
})();`;

const FRAME_SCRIPT_HASH = "'sha256-PfGxIRUvrV5qaB60zCEb7j5r4rnkp92XLHbCa0R7SqQ='";

const PAPER_STYLESHEET = `:root{color-scheme:light}body{margin:0;padding:1rem;padding-bottom:max(0.75rem,12px)!important;font-family:Arial,"Microsoft YaHei",sans-serif;font-size:0.875rem;line-height:1.6;color:#202124;background:#fff;overflow-wrap:break-word}img{max-width:100%;height:auto}a{text-decoration:underline!important;text-underline-offset:0.125rem}blockquote{margin:1rem 0;padding:.75rem 1rem;border-inline-start:0.1875rem solid #cbd5e1;border-radius:0 .5rem .5rem 0;background:#f8fafc;color:#475569}blockquote>:first-child{margin-top:0}blockquote>:last-child{margin-bottom:0}blockquote blockquote{margin:.75rem 0 0;border-color:#e2e8f0;background:#fff}code{padding:.125rem .375rem;border-radius:.25rem;background:#f1f5f9;color:#334155;font-family:ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace;font-size:.9em}pre{margin:1rem 0;padding:.875rem 1rem;overflow:auto;border:1px solid #1e293b;border-radius:.5rem;background:#0f172a;color:#e2e8f0;font-family:ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace;font-size:.875em;line-height:1.6;white-space:pre}pre code{padding:0;border:0;border-radius:0;background:transparent;color:inherit;font:inherit}hr{height:1px;margin:1.5rem 0;border:0;background:#e2e8f0}footer{margin-top:2rem;padding-top:1rem;border-top:1px solid #e2e8f0;color:#64748b;font-size:.8125em;line-height:1.55}figcaption{margin-top:.5rem;color:#64748b;font-size:.8125em;text-align:center}table{border-collapse:collapse}::-webkit-scrollbar{width:10px;height:10px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{border:3px solid transparent;border-radius:999px;background:rgba(0,0,0,.22);background-clip:padding-box}::-webkit-scrollbar-thumb:hover{background-color:rgba(0,0,0,.38)}`;

const FIT_WIDTH_STYLESHEET =
  'body{min-width:0!important}table{max-width:100%!important}img{max-width:100%!important;height:auto!important}';

/**
 * 外部网页统一的处理流水线：DOMPurify 消毒 → 地址只留 http(s) → 模块改写 → 加 CSP 与上报脚本。
 * iframe 不继承外层 rem，rootSize 注入根字号；fill 时内容在 iframe 内滚动，否则靠高度上报撑开。
 */
export function htmlFrameDocument(
  html: string,
  {
    baseUrl,
    remoteImages = true,
    localImages,
    fitWidth = true,
    stylesheet = PAPER_STYLESHEET,
    transform,
    rootSize,
    fill = false,
  }: HtmlFrameDocumentOptions & { rootSize: number; fill?: boolean },
): string {
  // DOMPurify 默认的地址白名单不认 dela-resource:，本地图片前缀要并进去。
  const localPattern = localImages?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const clean = DOMPurify.sanitize(html || '<p>此内容没有正文。</p>', {
    WHOLE_DOCUMENT: true,
    FORBID_TAGS: ['form', 'input', 'button', 'textarea', 'select'],
    ...(localPattern && {
      ALLOWED_URI_REGEXP: new RegExp(
        `^(?:${localPattern}|(?:https?|mailto|tel|cid):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))`,
        'i',
      ),
    }),
  });
  const doc = new DOMParser().parseFromString(clean, 'text/html');
  for (const element of doc.querySelectorAll('*'))
    for (const attribute of Array.from(element.attributes))
      if (attribute.name.startsWith('data-dela-')) element.removeAttribute(attribute.name);

  const httpUrl = (value: string) => {
    try {
      const url = new URL(value, baseUrl);
      return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
    } catch {
      return null;
    }
  };
  for (const link of doc.querySelectorAll('a[href], area[href]')) {
    const href = link.getAttribute('href')!;
    if (href.startsWith('#')) continue;
    const url = httpUrl(href);
    if (url) link.setAttribute('href', url);
    else link.removeAttribute('href');
  }
  for (const element of doc.querySelectorAll('[srcset]')) element.removeAttribute('srcset');
  for (const image of doc.querySelectorAll('img[src]')) {
    const src = image.getAttribute('src')!;
    if (src.startsWith('data:') || (localImages && src.startsWith(localImages))) continue;
    const url = httpUrl(src);
    if (url) image.setAttribute('src', url);
    else image.removeAttribute('src');
  }

  transform?.(doc);

  const remote = remoteImages ? ' https: http:' : '';
  const local = localImages ? ` ${new URL(localImages).protocol}` : '';
  const policy = doc.createElement('meta');
  policy.httpEquiv = 'Content-Security-Policy';
  policy.content = `default-src 'none'; style-src 'unsafe-inline'; img-src data:${remote}${local}; font-src ${remoteImages ? 'https:' : "'none'"}; form-action 'none'; base-uri 'none'; script-src ${FRAME_SCRIPT_HASH}`;
  const referrer = doc.createElement('meta');
  referrer.name = 'referrer';
  referrer.content = 'no-referrer';
  const base = doc.createElement('style');
  base.textContent = `:root{font-size:${rootSize}px}html{overflow-x:auto;overflow-y:${fill ? 'auto' : 'hidden'}}`;
  const look = doc.createElement('style');
  look.textContent = stylesheet;
  doc.head.prepend(policy, referrer, base, look);
  if (fitWidth) {
    const fit = doc.createElement('style');
    fit.textContent = FIT_WIDTH_STYLESHEET;
    doc.head.append(fit);
  }
  const script = doc.createElement('script');
  script.textContent = FRAME_SCRIPT;
  doc.body.append(script);
  return '<!doctype html>' + doc.documentElement.outerHTML;
}
