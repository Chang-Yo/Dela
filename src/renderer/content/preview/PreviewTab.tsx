import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import hljs from 'highlight.js/lib/common';
import { LoaderCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '../../components/ui/button';
import { closeLightbox, openLightbox } from '../../components/ui/lightbox';
import { ShuiyuanSourceDoc } from '../../features/shuiyuan/SourceRefCard';
import { useRootFontSize } from '../../lib/root-font-size';
import { sanitizeHtml } from '../../lib/sanitize-html';
import { showToast } from '../../app/toasts';
import { errorText } from '../../workspace/store';
import type { TabId } from '../../../shared/layout';
import { CodeViewer } from './CodeViewer';
import { useContentLoader, type LoadedDocument } from './loader';
import { OfficeExportBanner, OfficePromptCard } from './OfficePrompt';
import { parsePreviewTabId } from './tab-id';

const PdfReader = lazy(() =>
  import('./PdfReader').then((module) => ({ default: module.PdfReader })),
);
const DocxPreview = lazy(() =>
  import('./DocxPreview').then((module) => ({ default: module.DocxPreview })),
);
const SheetPreview = lazy(() =>
  import('./SheetPreview').then((module) => ({ default: module.SheetPreview })),
);

/** 分流决策（纯函数）：水源来源优先于格式；本地文本/代码文件用语法高亮查看器。 */
export type PreviewBranch =
  | 'shuiyuan'
  | 'code'
  | 'html'
  | 'pdf'
  | 'image'
  | 'docx'
  | 'xlsx'
  | 'pptx'
  | 'markdown'
  | 'text'
  | 'unsupported';

export function previewBranchOf(doc: LoadedDocument): PreviewBranch {
  if (doc.shuiyuanTopicId !== undefined) return 'shuiyuan';
  const { format } = doc.content;
  if (format === 'text' && doc.watchesDisk) return 'code';
  if (
    format === 'html' ||
    format === 'pdf' ||
    format === 'image' ||
    format === 'docx' ||
    format === 'xlsx' ||
    format === 'pptx' ||
    format === 'markdown' ||
    format === 'unsupported'
  )
    return format;
  return 'text';
}

/* 阅读位置按 标签+组 在会话内记忆，切换标签不丢。 */
const scrollMemory = new Map<string, number>();

/** 文件预览标签内容：按 DocumentContent.format 分流到各预览器。文档加载经注入的
 *  ContentLoader，本域不感知条目树与读取 IPC。 */
export function PreviewTab({ tabId, groupId }: { tabId: TabId; groupId: string }) {
  const loader = useContentLoader();
  const [doc, setDoc] = useState<LoadedDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const scrollContainer = useRef<HTMLDivElement>(null);
  const docRef = useRef<LoadedDocument | null>(null);
  docRef.current = doc;
  const scrollKey = `${tabId}:${groupId}`;
  const scroll = scrollMemory.get(scrollKey) ?? 0;
  const onScroll = (top: number) => scrollMemory.set(scrollKey, top);

  const load = () => {
    // 首次加载失败用占位错误（带重试）；已加载后的重读失败走浮窗，不打断当前内容。
    const initial = docRef.current === null;
    void loader.loadDocument(tabId).then(
      (result) => {
        setDoc(result);
        setError(null);
      },
      (cause) => {
        if (initial) setError(errorText(cause));
        else
          showToast({
            variant: 'error',
            title: '重新读取文件失败',
            description: errorText(cause),
          });
      },
    );
  };

  useEffect(() => {
    if (!parsePreviewTabId(tabId)) return;
    load();
    // 本地磁盘文件可能被外部编辑：窗口聚焦时强制重读（只读预览无草稿，直接重读）。
    const onFocus = () => {
      if (docRef.current?.watchesDisk) load();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [tabId, loader]);

  const content = doc?.content;
  useEffect(() => {
    if (scrollContainer.current) scrollContainer.current.scrollTop = scroll;
  }, [content]);
  useEffect(() => {
    if (!content?.bytes) {
      setBlobUrl(null);
      return;
    }
    const url = URL.createObjectURL(
      new Blob([new Uint8Array(content.bytes)], { type: content.mime }),
    );
    setBlobUrl(url);
    // 重读与卸载都会撤销 blobUrl，放大的图不能继续指着已释放的地址。
    return () => {
      closeLightbox(url);
      URL.revokeObjectURL(url);
    };
  }, [content?.bytes, content?.mime]);
  /* HTML 消毒基址：Canvas 来源的相对地址补全到 Canvas 域；本地/导入条目（watchesDisk，
     Loader 接线里即 entry kind local/imported 的近似标记）不补外域 base——空 base 下
     绝对 http(s) 链接保留、相对地址剥除，避免相对地址被补到 Canvas 域造成跨域请求泄露。 */
  const rootSize = useRootFontSize();
  const html = useMemo(
    () =>
      content?.format === 'html'
        ? sanitizeHtml(content.text, doc?.watchesDisk ? '' : 'https://oc.sjtu.edu.cn', rootSize)
        : '',
    [content, doc?.watchesDisk, rootSize],
  );

  if (!parsePreviewTabId(tabId))
    return (
      <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center p-6 text-13 text-ink-3">
        无效的预览标签：{tabId}
      </div>
    );
  if (!doc || !content)
    return (
      <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center p-6 text-13 text-ink-3">
        {error ? (
          <div role="alert" className="min-w-0">
            <p className="break-words">{error}</p>
            <Button variant="ghost" onClick={() => load()}>
              重试
            </Button>
          </div>
        ) : (
          <>
            <LoaderCircle className="mr-2 size-4 animate-spin" />
            正在打开…
          </>
        )}
      </div>
    );

  const branch = previewBranchOf(doc);
  const exported = content.office?.export;
  const openLink = (url: string) => loader.openLink(url);
  const onOfficeRefresh = () => {
    load();
    loader.onExported?.(tabId);
  };

  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      aria-label={`文档：${content.title}`}
    >
      {branch === 'shuiyuan' && doc.shuiyuanTopicId !== undefined && (
        <ShuiyuanSourceDoc
          content={content}
          text={content.text ?? ''}
          topicId={doc.shuiyuanTopicId}
          onOpenInShuiyuan={(topicId, postNumber) => loader.openShuiyuanTopic(topicId, postNumber)}
          onOpenUrl={openLink}
        />
      )}
      {/* 白底文档以圆角卡片呈现：暗色模式下避免白色大块与深色界面生硬相接。 */}
      {branch === 'html' && (
        <div className="min-h-0 flex-1 overflow-hidden rounded-card border border-line">
          <iframe
            title={content.title}
            className="size-full border-0 bg-white"
            sandbox="allow-same-origin"
            referrerPolicy="no-referrer"
            srcDoc={html}
            onLoad={(event) => {
              const frame = event.currentTarget;
              const frameDoc = frame.contentDocument;
              if (!frameDoc) return;
              frame.contentWindow?.scrollTo(0, scroll);
              frameDoc.addEventListener('click', (e) => {
                const target = (e.target as Element).closest?.('a[href]');
                if (target) {
                  e.preventDefault();
                  openLink(target.getAttribute('href')!);
                }
              });
              frame.contentWindow?.addEventListener('scroll', () =>
                onScroll(frame.contentWindow?.scrollY ?? 0),
              );
            }}
          />
        </div>
      )}
      {branch === 'pdf' &&
        (content.previewUrl ? (
          <Suspense fallback={<p className="p-4 text-13 text-ink-3">正在加载阅读器…</p>}>
            <PdfReader
              key={content.previewUrl}
              url={content.previewUrl}
              scroll={scroll}
              onScroll={onScroll}
            />
          </Suspense>
        ) : (
          <p className="p-4 text-13 text-ink-3">正在准备预览…</p>
        ))}
      {branch === 'image' && (
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {blobUrl && (
            <img
              alt={content.title}
              className="max-w-full cursor-zoom-in"
              onClick={() => openLightbox(blobUrl, content.title)}
              src={blobUrl}
            />
          )}
        </div>
      )}
      {(branch === 'docx' || branch === 'xlsx') &&
        (content.previewUrl ? (
          <Suspense fallback={<p className="p-4 text-13 text-ink-3">正在加载预览…</p>}>
            {branch === 'docx' ? (
              <DocxPreview key={content.previewUrl} url={content.previewUrl} />
            ) : (
              <SheetPreview key={content.previewUrl} url={content.previewUrl} />
            )}
          </Suspense>
        ) : (
          <p className="p-4 text-13 text-ink-3">正在准备预览…</p>
        ))}
      {branch === 'pptx' && (
        <div className="flex min-h-0 flex-1 flex-col">
          {exported && (
            <OfficeExportBanner
              exported={exported}
              officeRef={doc.officeRef}
              onExported={onOfficeRefresh}
            />
          )}
          {exported?.previewUrl ? (
            <Suspense fallback={<p className="p-4 text-13 text-ink-3">正在加载阅读器…</p>}>
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
              officeRef={doc.officeRef}
              onExported={onOfficeRefresh}
            />
          )}
        </div>
      )}
      {branch === 'unsupported' && (
        <p className="p-6 text-13 text-ink-3">此格式暂不支持内嵌预览，请下载文件或打开原文。</p>
      )}
      {(branch === 'code' || branch === 'text') && (
        <CodeViewer
          value={content.text ?? ''}
          filename={content.title}
          scroll={scroll}
          onScroll={onScroll}
        />
      )}
      {branch === 'markdown' && (
        <div
          className="min-h-0 flex-1 overflow-auto p-6 text-13 leading-relaxed [&_h1]:mb-4 [&_h1]:text-2xl [&_h2]:my-4 [&_h2]:text-xl [&_h3]:my-3 [&_p]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_pre]:overflow-auto [&_pre]:rounded-card [&_pre]:bg-inset [&_pre]:p-4 [&_blockquote]:border-l-2 [&_blockquote]:pl-4 [&_table]:border-collapse [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:p-2"
          ref={scrollContainer}
          onScroll={(event) => onScroll(event.currentTarget.scrollTop)}
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ href, children }) => (
                <button className="text-ink underline" onClick={() => href && openLink(href)}>
                  {children}
                </button>
              ),
              img: ({ src, alt }) => {
                if (!src) return null;
                const resolved = doc.resolveImage?.(src) ?? src;
                return (
                  <img
                    alt={alt ?? ''}
                    className="mx-auto max-w-full cursor-zoom-in rounded-card"
                    loading="lazy"
                    onClick={(event) => {
                      // 图片常包在链接里：放大时不要顺带打开链接。
                      event.preventDefault();
                      event.stopPropagation();
                      openLightbox(resolved, alt ?? '');
                    }}
                    src={resolved}
                  />
                );
              },
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
            {content.text ?? ''}
          </ReactMarkdown>
        </div>
      )}
    </section>
  );
}
