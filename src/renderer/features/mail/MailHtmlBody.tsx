import { useEffect, useMemo, useRef, useState } from 'react';
import { Ellipsis } from 'lucide-react';
import { renderMailHtml } from './mail-html-display';
import { sanitizeMailHtml } from './mail-html';
import { cn } from '../../lib/utils';
import { frameHeightFromEvent, injectFrameHeightReport } from '../../components/ui/frame-height';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';

const toolbarToggle = cn(
  'h-7 rounded-full px-3 text-xs transition-colors',
  'aria-pressed:bg-secondary aria-pressed:font-medium aria-pressed:text-secondary-foreground',
  'aria-[pressed=false]:text-muted-foreground aria-[pressed=false]:hover:bg-muted',
);

/** 未收到高度上报前的初始正文高度(px),收到上报后替换为真实高度。 */
const INITIAL_BODY_HEIGHT = 240;

export function MailHtmlBody({ html, text }: { html: string; text: string | null }) {
  // 远程图片默认不加载:是跟踪像素的标准载体,主流客户端均默认阻止;每封邮件一键放行。
  const [remoteImages, setRemoteImages] = useState(false);
  const [plain, setPlain] = useState(false);
  const [fitWidth, setFitWidth] = useState(false);
  const [bodyHeight, setBodyHeight] = useState(INITIAL_BODY_HEIGHT);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const document = useMemo(() => {
    const doc = sanitizeMailHtml(html, remoteImages);
    injectFrameHeightReport(doc);
    return renderMailHtml(doc, fitWidth);
  }, [html, remoteImages, fitWidth]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const height = frameHeightFromEvent(event, iframeRef.current);
      if (height !== null) setBodyHeight(height);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <div className="mt-3 flex flex-col">
      {/* 常驻只留两个高频开关；低频的「适应宽度」收进显示选项菜单。 */}
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
          aria-pressed={remoteImages}
          className={toolbarToggle}
          onClick={() => setRemoteImages(!remoteImages)}
          type="button"
        >
          {remoteImages ? '隐藏远程图片' : '加载远程图片'}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label="显示选项"
              className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="显示选项"
              type="button"
            >
              <Ellipsis className="size-4" strokeWidth={1.8} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuCheckboxItem
              checked={fitWidth}
              onCheckedChange={(value) => setFitWidth(value === true)}
            >
              适应宽度
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {plain ? (
        <div className="mt-3 rounded-t-lg border-x border-t p-4 text-sm leading-relaxed whitespace-pre-wrap break-words">
          {text ?? new DOMParser().parseFromString(html, 'text/html').body.textContent}
        </div>
      ) : (
        <iframe
          className="mt-3 w-full rounded-t-lg border-x border-t bg-white"
          ref={iframeRef}
          referrerPolicy="no-referrer"
          sandbox="allow-popups allow-scripts"
          srcDoc={document}
          style={{ height: bodyHeight }}
          title="邮件正文"
        />
      )}
    </div>
  );
}
