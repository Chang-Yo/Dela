import { renderMailHtml } from '../features/mail/mail-html-display';

/**
 * 清洗 Canvas 网页正文，供沙箱 iframe 的 srcDoc 使用；资料详情与 TODO 详情共用。
 * rootSize 为当前根字号：iframe 是独立文档，rem 不继承外层，不注入就不随字号设置缩放。
 */
export function sanitizeHtml(
  text: string | null | undefined,
  baseUrl: string,
  rootSize: number,
): string {
  const doc = new DOMParser().parseFromString(text || '<p>此内容没有正文。</p>', 'text/html');
  doc
    .querySelectorAll('script,iframe,object,embed,form,base,meta,link')
    .forEach((el) => el.remove());
  doc.querySelectorAll('*').forEach((el) => {
    for (const a of Array.from(el.attributes))
      if (a.name.startsWith('on') || a.name === 'srcdoc') el.removeAttribute(a.name);
  });
  doc.querySelectorAll('a[href],img[src]').forEach((el) => {
    const attr = el.tagName === 'A' ? 'href' : 'src';
    try {
      const url = new URL(el.getAttribute(attr)!, baseUrl);
      if (['https:', 'http:'].includes(url.protocol)) el.setAttribute(attr, url.href);
      else el.removeAttribute(attr);
    } catch {
      el.removeAttribute(attr);
    }
  });
  const csp = doc.createElement('meta');
  csp.httpEquiv = 'Content-Security-Policy';
  csp.content =
    "default-src 'none'; style-src 'unsafe-inline'; img-src data: https: http:; script-src 'none'; form-action 'none'";
  doc.head.prepend(csp);
  return renderMailHtml(doc, true, rootSize);
}
