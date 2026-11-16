import DOMPurify from 'dompurify';
import { renderMailHtml } from './mail-html-display';

/**
 * 清洗 Canvas 网页正文供沙箱 iframe 使用。rootSize：iframe 不继承外层 rem，需注入才随字号缩放；
 * htmlScrollY：'hidden' 用于随内容增高的详情，'auto' 用于固定高度、内层自滚的预览。
 */
export function sanitizeHtml(
  text: string | null | undefined,
  baseUrl: string,
  rootSize: number,
  htmlScrollY: 'hidden' | 'auto' = 'hidden',
): string {
  const clean = DOMPurify.sanitize(text || '<p>此内容没有正文。</p>', {
    WHOLE_DOCUMENT: true,
    FORBID_TAGS: ['form'],
  });
  const doc = new DOMParser().parseFromString(clean, 'text/html');
  doc.querySelectorAll('a[href],img[src]').forEach((el) => {
    const attr = el.localName === 'a' ? 'href' : 'src';
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
  return renderMailHtml(doc, true, rootSize, htmlScrollY);
}
