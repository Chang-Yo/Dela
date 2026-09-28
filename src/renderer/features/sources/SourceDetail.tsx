import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import hljs from 'highlight.js/lib/common';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { DocumentContent } from '../../../shared/api';
import type { ResourceRef } from '../../../shared/resources';
import { sanitizeHtml } from '../../lib/sanitize-html';
import { OfficeExportBanner, OfficePromptCard } from './OfficePrompt';

const PdfReader = lazy(() =>
  import('./PdfReader').then((module) => ({ default: module.PdfReader })),
);
const DocxPreview = lazy(() =>
  import('./DocxPreview').then((module) => ({ default: module.DocxPreview })),
);
const SheetPreview = lazy(() =>
  import('./SheetPreview').then((module) => ({ default: module.SheetPreview })),
);

export function SourceDetail({
  content,
  text,
  onLink,
  onScroll,
  scroll = 0,
  resolveImage,
  officeRef,
  onOfficeRefresh,
}: {
  content: DocumentContent;
  text?: string;
  onLink: (url: string) => void;
  onScroll?: (top: number) => void;
  scroll?: number;
  /** 本地 Markdown 的相对图片地址改写为受限资源协议；不传则按原样输出。 */
  resolveImage?: (src: string) => string;
  /** pptx 导出/快速预览的定位引用；仅 pptx 格式使用。 */
  officeRef?: ResourceRef;
  /** pptx 导出完成后触发重读，进入关联渲染分支。 */
  onOfficeRefresh?: () => void;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const scrollContainer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollContainer.current) scrollContainer.current.scrollTop = scroll;
  }, [content]);
  useEffect(() => {
    if (!content.bytes) {
      setBlobUrl(null);
      return;
    }
    const url = URL.createObjectURL(
      new Blob([new Uint8Array(content.bytes)], { type: content.mime }),
    );
    setBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [content.bytes, content.mime]);
  const html = useMemo(
    () => (content.format === 'html' ? sanitizeHtml(content.text, 'https://oc.sjtu.edu.cn') : ''),
    [content.format, content.text],
  );
  if (content.format === 'html')
    return (
      <iframe
        title={content.title}
        className="min-h-0 w-full flex-1 border-0 bg-white"
        sandbox="allow-same-origin"
        referrerPolicy="no-referrer"
        srcDoc={html}
        onLoad={(event) => {
          const frame = event.currentTarget;
          const doc = frame.contentDocument;
          if (!doc) return;
          frame.contentWindow?.scrollTo(0, scroll);
          doc.addEventListener('click', (e) => {
            const target = (e.target as Element).closest?.('a[href]');
            if (target) {
              e.preventDefault();
              onLink(target.getAttribute('href')!);
            }
          });
          frame.contentWindow?.addEventListener('scroll', () =>
            onScroll?.(frame.contentWindow?.scrollY ?? 0),
          );
        }}
      />
    );
  if (content.format === 'pdf')
    return content.previewUrl ? (
      <Suspense fallback={<p className="p-4 text-sm text-muted-foreground">正在加载阅读器…</p>}>
        <PdfReader
          key={content.previewUrl}
          url={content.previewUrl}
          scroll={scroll}
          onScroll={onScroll}
        />
      </Suspense>
    ) : (
      <p className="p-4 text-sm text-muted-foreground">正在准备预览…</p>
    );
  if (content.format === 'image')
    return (
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {blobUrl && <img src={blobUrl} alt={content.title} className="mx-auto max-w-full" />}
      </div>
    );
  if (content.format === 'docx' || content.format === 'xlsx')
    return content.previewUrl ? (
      <Suspense fallback={<p className="p-4 text-sm text-muted-foreground">正在加载预览…</p>}>
        {content.format === 'docx' ? (
          <DocxPreview key={content.previewUrl} url={content.previewUrl} />
        ) : (
          <SheetPreview key={content.previewUrl} url={content.previewUrl} />
        )}
      </Suspense>
    ) : (
      <p className="p-4 text-sm text-muted-foreground">正在准备预览…</p>
    );
  if (content.format === 'pptx') {
    const exported = content.office?.export;
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {exported && (
          <OfficeExportBanner
            exported={exported}
            officeRef={officeRef}
            onExported={onOfficeRefresh}
          />
        )}
        {exported?.previewUrl ? (
          <Suspense fallback={<p className="p-4 text-sm text-muted-foreground">正在加载阅读器…</p>}>
            <PdfReader
              key={exported.previewUrl}
              url={exported.previewUrl}
              scroll={scroll}
              onScroll={onScroll}
            />
          </Suspense>
        ) : (
          <OfficePromptCard
            title={content.title}
            officeRef={officeRef}
            onExported={onOfficeRefresh}
          />
        )}
      </div>
    );
  }
  if (content.format === 'unsupported')
    return (
      <p className="p-6 text-sm text-muted-foreground">
        此格式暂不支持内嵌预览，请下载文件或打开原文。
      </p>
    );
  return (
    <div
      className="min-h-0 flex-1 overflow-auto p-6 text-sm leading-relaxed [&_h1]:mb-4 [&_h1]:text-2xl [&_h2]:my-4 [&_h2]:text-xl [&_h3]:my-3 [&_p]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_pre]:overflow-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-4 [&_blockquote]:border-l-2 [&_blockquote]:pl-4 [&_table]:border-collapse [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:p-2"
      ref={scrollContainer}
      onScroll={(event) => onScroll?.(event.currentTarget.scrollTop)}
    >
      {content.format === 'markdown' ? (
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ href, children }) => (
              <button className="text-primary underline" onClick={() => href && onLink(href)}>
                {children}
              </button>
            ),
            img: ({ src, alt }) =>
              src ? (
                <img
                  src={resolveImage?.(src) ?? src}
                  alt={alt ?? ''}
                  className="mx-auto max-w-full rounded-lg"
                  loading="lazy"
                />
              ) : null,
            code: ({ className, children }) => {
              const language = /language-([\w+.-]+)/.exec(className ?? '')?.[1];
              if (!language || !hljs.getLanguage(language))
                return <code className={className}>{children}</code>;
              return (
                <code
                  className={className}
                  dangerouslySetInnerHTML={{
                    __html: hljs.highlight(String(children), { language }).value,
                  }}
                />
              );
            },
          }}
        >
          {text ?? content.text ?? ''}
        </ReactMarkdown>
      ) : (
        <pre className="whitespace-pre-wrap font-mono">{content.text}</pre>
      )}
    </div>
  );
}
