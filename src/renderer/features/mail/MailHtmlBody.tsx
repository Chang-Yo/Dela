import { useMemo, useState } from 'react';
import { prepareMailHtml, mailLinks } from './mail-html';
import { cn } from '../../lib/utils';

const toolbarToggle = cn(
  'h-7 rounded-full px-3 text-xs transition-colors',
  'aria-pressed:bg-secondary aria-pressed:font-medium aria-pressed:text-secondary-foreground',
  'aria-[pressed=false]:text-muted-foreground aria-[pressed=false]:hover:bg-muted',
);

export function MailHtmlBody({ html, text }: { html: string; text: string | null }) {
  const [remoteImages, setRemoteImages] = useState(true);
  const [plain, setPlain] = useState(false);
  const [fitWidth, setFitWidth] = useState(true);
  const [linkError, setLinkError] = useState<string | null>(null);
  const document = useMemo(
    () => prepareMailHtml(html, remoteImages, fitWidth),
    [html, remoteImages, fitWidth],
  );
  const links = useMemo(() => mailLinks(html), [html]);
  return (
    <>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <button
          aria-pressed={fitWidth}
          className={toolbarToggle}
          onClick={() => setFitWidth(!fitWidth)}
          type="button"
        >
          {fitWidth ? '适应宽度' : '原始布局'}
        </button>
        <button
          aria-pressed={plain}
          className={toolbarToggle}
          onClick={() => setPlain(!plain)}
          type="button"
        >
          纯文本
        </button>
        <button
          aria-pressed={remoteImages}
          className={toolbarToggle}
          onClick={() => setRemoteImages(!remoteImages)}
          type="button"
        >
          远程图片：{remoteImages ? '显示' : '隐藏'}
        </button>
        {links.length > 0 && (
          <details className="w-full">
            <summary className="inline-flex h-7 cursor-pointer items-center rounded-full px-3 text-xs text-muted-foreground transition-colors hover:bg-muted">
              正文链接（{links.length}）
            </summary>
            <ul className="mt-1 grid gap-1 rounded-lg bg-muted/60 p-3">
              {links.map(({ label, url }) => (
                <li key={url}>
                  <a
                    className="text-xs underline-offset-2 hover:underline"
                    href={url}
                    onClick={(event) => {
                      event.preventDefault();
                      setLinkError(null);
                      void window.dela?.mail
                        .openLink(url)
                        .catch(() => setLinkError('无法打开链接，请重试'));
                    }}
                  >
                    {label}
                    <small className="block text-[11px] text-muted-foreground break-all">
                      {url}
                    </small>
                  </a>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
      {linkError && (
        <p className="mt-2 text-xs text-destructive" role="alert">
          {linkError}
        </p>
      )}
      {plain ? (
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-xl border p-4 text-[13px] leading-relaxed whitespace-pre-wrap break-words">
          {text ?? new DOMParser().parseFromString(html, 'text/html').body.textContent}
        </div>
      ) : (
        <iframe
          className="mt-3 w-full min-h-[240px] flex-[1_0_50%] rounded-xl border bg-white"
          referrerPolicy="no-referrer"
          sandbox=""
          srcDoc={document}
          title="邮件正文"
        />
      )}
    </>
  );
}
