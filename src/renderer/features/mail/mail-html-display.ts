const readerDefaults = `:root{color-scheme:light}body{margin:0;padding:1rem;font-family:Arial,"Microsoft YaHei",sans-serif;font-size:14px;line-height:1.6;color:#202124;background:#fff;overflow-wrap:break-word}img{max-width:100%;height:auto}a{text-decoration:underline!important;text-underline-offset:2px}blockquote{margin:1rem 0;padding:.75rem 1rem;border-inline-start:3px solid #cbd5e1;border-radius:0 .5rem .5rem 0;background:#f8fafc;color:#475569}blockquote>:first-child{margin-top:0}blockquote>:last-child{margin-bottom:0}blockquote blockquote{margin:.75rem 0 0;border-color:#e2e8f0;background:#fff}code{padding:.125rem .375rem;border-radius:.25rem;background:#f1f5f9;color:#334155;font-family:ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace;font-size:.9em}pre{margin:1rem 0;padding:.875rem 1rem;overflow:auto;border:1px solid #1e293b;border-radius:.5rem;background:#0f172a;color:#e2e8f0;font-family:ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace;font-size:.875em;line-height:1.6;white-space:pre}pre code{padding:0;border:0;border-radius:0;background:transparent;color:inherit;font:inherit}hr{height:1px;margin:1.5rem 0;border:0;background:#e2e8f0}footer{margin-top:2rem;padding-top:1rem;border-top:1px solid #e2e8f0;color:#64748b;font-size:.8125em;line-height:1.55}figcaption{margin-top:.5rem;color:#64748b;font-size:.8125em;text-align:center}table{border-collapse:collapse}html{overflow:auto}`;

/** Add only fallback reader styles; source styles added later in the head take precedence. */
export function renderMailHtml(doc: Document, fitWidth: boolean): string {
  const defaults = doc.createElement('style');
  defaults.textContent = readerDefaults;
  doc.head.prepend(defaults);
  if (fitWidth) {
    const fit = doc.createElement('style');
    fit.textContent =
      'body{min-width:0!important}table{max-width:100%!important}img{max-width:100%!important;height:auto!important}';
    doc.head.append(fit);
  }
  return '<!doctype html>' + doc.documentElement.outerHTML;
}
