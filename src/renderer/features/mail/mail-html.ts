/** Preserve email styles inside an opaque, script-free iframe. */
export function prepareMailHtml(html: string, remoteImages: boolean, fitWidth = true): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc
    .querySelectorAll(
      'script, iframe, frame, frameset, object, embed, base, meta, link, input, button, textarea, select',
    )
    .forEach((node) => node.remove());
  for (const element of doc.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      if (
        /^on/i.test(attribute.name) ||
        ['srcdoc', 'autofocus', 'ping', 'action', 'formaction'].includes(attribute.name)
      )
        element.removeAttribute(attribute.name);
    }
  }
  for (const anchor of doc.querySelectorAll('a, area')) {
    const href = anchor.getAttribute('href') ?? '';
    // External links are listed outside the sandbox; fragment navigation stays local.
    if (!href.startsWith('#')) anchor.removeAttribute('href');
    anchor.removeAttribute('target');
  }
  for (const img of doc.querySelectorAll('img')) {
    img.referrerPolicy = 'no-referrer';
    if (img.getAttribute('src')?.startsWith('cid:')) {
      img.removeAttribute('src');
      img.alt = img.alt || '内嵌图片暂不可用';
    }
  }
  const defaults = doc.createElement('style');
  defaults.textContent = `:root{color-scheme:light}body{margin:0;padding:1rem;font-family:Arial,"Microsoft YaHei",sans-serif;font-size:14px;line-height:1.6;color:#202124;background:#fff;overflow-wrap:break-word}img{max-width:100%;height:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere}blockquote{margin-inline:1em;padding-inline-start:1em;border-inline-start:2px solid #c9ced6}a{color:#356154}table{border-collapse:collapse}html{overflow:auto}`;
  doc.head.prepend(defaults);
  if (fitWidth) {
    const fit = doc.createElement('style');
    fit.textContent =
      'body{min-width:0!important}table{max-width:100%!important}img{max-width:100%!important;height:auto!important}';
    doc.head.append(fit);
  }
  const policy = doc.createElement('meta');
  policy.httpEquiv = 'Content-Security-Policy';
  policy.content = `default-src 'none'; style-src 'unsafe-inline'; img-src data:${remoteImages ? ' https: http:' : ''}; font-src 'none'; form-action 'none'; base-uri 'none'`;
  const referrer = doc.createElement('meta');
  referrer.name = 'referrer';
  referrer.content = 'no-referrer';
  doc.head.prepend(policy, referrer);
  return '<!doctype html>' + doc.documentElement.outerHTML;
}

export function mailLinks(html: string): { label: string; url: string }[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const links = new Map<string, string>();
  for (const anchor of doc.querySelectorAll('a[href]')) {
    const url = anchor.getAttribute('href')?.trim() ?? '';
    if (/^https?:\/\//i.test(url)) links.set(url, anchor.textContent?.trim() || url);
  }
  return [...links].map(([url, label]) => ({ label, url }));
}
