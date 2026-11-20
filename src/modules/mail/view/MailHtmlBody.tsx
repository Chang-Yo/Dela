import { useState } from 'react';
import { cn } from '../../../ui/lib/cn';
import { HtmlFrame } from '../../../ui/html-frame';

const toolbarToggle = cn(
  'h-7 rounded-full px-3 text-xs transition-colors',
  'aria-pressed:bg-selected aria-pressed:font-medium aria-pressed:text-ink',
  'aria-[pressed=false]:text-ink-3 aria-[pressed=false]:hover:bg-hover',
);

/** cid: 内嵌图片的地址已在消毒时剥除，留下说明文字代替破图。 */
const markInlineImages = (doc: Document) => {
  for (const image of doc.querySelectorAll('img:not([src])'))
    image.setAttribute('alt', image.getAttribute('alt') || '内嵌图片暂不可用');
};

export function MailHtmlBody({ html, text }: { html: string; text: string | null }) {
  // 远程图片默认加载（用户裁决）；担心跟踪像素时可按这封邮件一键隐藏，偏好不落盘。
  const [remoteImages, setRemoteImages] = useState(true);
  const [plain, setPlain] = useState(false);
  const [fitWidth, setFitWidth] = useState(false);

  return (
    <div className="mt-3 flex flex-col">
      <div className="flex items-center gap-1.5">
        <button
          aria-pressed={plain}
          className={toolbarToggle}
          onClick={() => setPlain(!plain)}
          type="button"
        >
          纯文本
        </button>
        <button
          aria-pressed={fitWidth}
          className={toolbarToggle}
          onClick={() => setFitWidth(!fitWidth)}
          type="button"
        >
          适应宽度
        </button>
        <button
          aria-pressed={remoteImages}
          className={toolbarToggle}
          onClick={() => setRemoteImages(!remoteImages)}
          type="button"
        >
          {remoteImages ? '隐藏远程图片' : '加载远程图片'}
        </button>
      </div>
      {plain ? (
        <div className="mt-3 rounded-t-card border-x border-t p-4 text-sm leading-relaxed whitespace-pre-wrap break-words">
          {text ?? new DOMParser().parseFromString(html, 'text/html').body.textContent}
        </div>
      ) : (
        <HtmlFrame
          className="mt-3 rounded-t-card border-x border-t bg-paper"
          fitWidth={fitWidth}
          html={html}
          remoteImages={remoteImages}
          title="邮件正文"
          transform={markInlineImages}
        />
      )}
    </div>
  );
}
