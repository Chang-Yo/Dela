import { useMemo, useState } from 'react';
import { renderMailHtml } from './mail-html-display';
import { sanitizeMailHtml } from './mail-html';
import { cn } from '../../lib/utils';

const toolbarToggle = cn(
  'h-7 rounded-full px-3 text-xs transition-colors',
  'aria-pressed:bg-secondary aria-pressed:font-medium aria-pressed:text-secondary-foreground',
  'aria-[pressed=false]:text-muted-foreground aria-[pressed=false]:hover:bg-muted',
);

export function MailHtmlBody({ html, text }: { html: string; text: string | null }) {
  const [remoteImages, setRemoteImages] = useState(true);
  const [plain, setPlain] = useState(false);
  const [fitWidth, setFitWidth] = useState(false);
  const document = useMemo(
    () => renderMailHtml(sanitizeMailHtml(html, remoteImages), fitWidth),
    [html, remoteImages, fitWidth],
  );
  return (
    <div className="mt-3 flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
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
      </div>
      {plain ? (
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-t-lg border-x border-t p-4 text-[13px] leading-relaxed whitespace-pre-wrap break-words">
          {text ?? new DOMParser().parseFromString(html, 'text/html').body.textContent}
        </div>
      ) : (
        <iframe
          className="mt-3 min-h-0 w-full flex-1 rounded-t-lg border-x border-t bg-white"
          referrerPolicy="no-referrer"
          sandbox="allow-popups"
          srcDoc={document}
          title="邮件正文"
        />
      )}
    </div>
  );
}
