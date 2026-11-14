/** Isolate untrusted mail markup while preserving its structural and inline presentation. */
export function sanitizeMailHtml(html: string, remoteImages: boolean): Document {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc
    .querySelectorAll(
      'script, iframe, frame, frameset, object, embed, base, meta, link, input, button, textarea, select',
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
  for (const anchor of doc.querySelectorAll('a, area')) {
    const href = anchor.getAttribute('href') ?? '';
    if (!href.startsWith('#') && !/^https?:\/\//i.test(href)) anchor.removeAttribute('href');
    if (/^https?:\/\//i.test(href)) {
      anchor.setAttribute('target', '_blank');
      anchor.setAttribute('rel', 'noopener noreferrer');
    } else {
      anchor.removeAttribute('target');
    }
  }
  for (const img of doc.querySelectorAll('img')) {
    img.referrerPolicy = 'no-referrer';
    if (img.getAttribute('src')?.startsWith('cid:')) {
      img.removeAttribute('src');
      img.alt = img.alt || '内嵌图片暂不可用';
    }
  }
  const policy = doc.createElement('meta');
  policy.httpEquiv = 'Content-Security-Policy';
  policy.content = `default-src 'none'; style-src 'unsafe-inline'; img-src data:${remoteImages ? ' https: http:' : ''}; font-src 'none'; form-action 'none'; base-uri 'none'`;
  const referrer = doc.createElement('meta');
  referrer.name = 'referrer';
  referrer.content = 'no-referrer';
  doc.head.prepend(policy, referrer);
  return doc;
}
