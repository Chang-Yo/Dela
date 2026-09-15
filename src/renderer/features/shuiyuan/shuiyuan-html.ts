import { SHUIYUAN_ORIGIN } from './shuiyuan-format';

/**
 * 水源楼层 HTML（Discourse cooked，服务端已消毒）在本应用的二次消毒：
 * 相对链接/图片按水源域名补全，其余策略与邮件正文一致（剥主动内容、
 * 只留 http(s) 链接、no-referrer、CSP 限定图片与内联样式）。
 */
export function sanitizeShuiyuanHtml(html: string): Document {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc
    .querySelectorAll(
      'script, iframe, frame, frameset, object, embed, base, meta, link, input, button, textarea, select, form',
    )
    .forEach((node) => node.remove());
  for (const element of doc.querySelectorAll('*')) {
    for (const attribute of Array.from(element.attributes)) {
      if (
        /^on/i.test(attribute.name) ||
        ['srcdoc', 'autofocus', 'ping', 'action', 'formaction'].includes(attribute.name)
      )
        element.removeAttribute(attribute.name);
    }
  }
  const absolute = (value: string | null): string | null => {
    if (!value) return null;
    if (value.startsWith('#')) return value;
    if (/^https?:\/\//i.test(value)) return value;
    if (value.startsWith('/')) return `${SHUIYUAN_ORIGIN}${value}`;
    return null;
  };
  for (const anchor of doc.querySelectorAll('a, area')) {
    const href = absolute(anchor.getAttribute('href'));
    if (!href || (!href.startsWith('#') && !/^https?:\/\//i.test(href))) {
      anchor.removeAttribute('href');
      anchor.removeAttribute('target');
      continue;
    }
    if (/^https?:\/\//i.test(href)) {
      anchor.setAttribute('href', href);
      anchor.setAttribute('target', '_blank');
      anchor.setAttribute('rel', 'noopener noreferrer');
    }
  }
  for (const img of doc.querySelectorAll('img')) {
    const src = absolute(img.getAttribute('src'));
    img.referrerPolicy = 'no-referrer';
    img.loading = 'lazy';
    if (src) img.setAttribute('src', src);
    else {
      img.removeAttribute('src');
      img.alt = img.alt || '图片不可用';
    }
  }
  const policy = doc.createElement('meta');
  policy.httpEquiv = 'Content-Security-Policy';
  policy.content =
    "default-src 'none'; style-src 'unsafe-inline'; img-src data: https: http:; font-src https:; form-action 'none'; base-uri 'none'";
  const referrer = doc.createElement('meta');
  referrer.name = 'referrer';
  referrer.content = 'no-referrer';
  doc.head.prepend(policy, referrer);
  return doc;
}

/** 楼层文档的阅读样式：浅色阅读面、图片限宽、Discourse 风格的引用块与代码块。 */
export function renderShuiyuanHtml(doc: Document): string {
  const style = doc.createElement('style');
  style.textContent = `
    :root { color-scheme: light; }
    body { margin: 0; padding: 0 2px; background: #fff; color: #1f2328;
      font: 15px/1.75 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
      overflow-wrap: break-word; }
    img, video { max-width: 100%; height: auto; border-radius: 6px; }
    a { color: #0969da; }
    p { margin: 0 0 0.75em; }
    blockquote { margin: 0.5em 0; padding: 0.1em 0 0.1em 0.9em; border-left: 3px solid #d0d7de;
      color: #57606a; }
    pre { margin: 0.5em 0; padding: 10px 12px; background: #f6f8fa; border-radius: 8px;
      overflow-x: auto; font-size: 13px; line-height: 1.6; }
    code { font-family: Consolas, "Courier New", monospace; background: #f6f8fa;
      border-radius: 4px; padding: 1px 4px; font-size: 0.92em; }
    pre code { background: none; padding: 0; }
    table { border-collapse: collapse; margin: 0.5em 0; }
    th, td { border: 1px solid #d0d7de; padding: 4px 8px; }
    aside.onebox { margin: 0.5em 0; padding: 10px 12px; border: 1px solid #d0d7de;
      border-radius: 8px; background: #f6f8fa; }
    aside.onebox h3 { margin: 0 0 4px; font-size: 14px; }
    aside.onebox .onebox-body { color: #57606a; font-size: 13px; }
    .dela-post-head { color: #57606a; font-size: 13px; margin: 0 0 2px; }
    .dela-post-head b { color: #1f2328; }
  `;
  doc.head.append(style);
  return doc.documentElement.outerHTML;
}
