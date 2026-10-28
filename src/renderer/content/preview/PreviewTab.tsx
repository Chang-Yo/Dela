import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import hljs from 'highlight.js/lib/common';
import { LoaderCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '../../components/ui/button';
import { ShuiyuanSourceDoc } from '../../features/shuiyuan/SourceRefCard';
import { useRootFontSize } from '../../lib/root-font-size';
import { sanitizeHtml } from '../../lib/sanitize-html';
import { showToast } from '../../app/toasts';
import { errorText } from '../../workspace/store';
import { openStudyChat } from '../../lib/study-context';
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

/** 分流决策（纯函数）：水源来源优先于格式。预览里的文本都是只读的（远端、资料）：
 *  本地文本文件走 note: 编辑标签，不进这里。 */
export type PreviewBranch =
  'shuiyuan' | 'html' | 'pdf' | 'image' | 'docx' | 'xlsx' | 'pptx' | 'markdown' | 'text' | 'binary';

export function previewBranchOf(doc: LoadedDocument): PreviewBranch {
  if (doc.shuiyuanTopicId !== undefined) return 'shuiyuan';
  const { format } = doc.content;
  if (
    format === 'html' ||
    format === 'pdf' ||
    format === 'image' ||
    format === 'docx' ||
    format === 'xlsx' ||
    format === 'pptx' ||
    format === 'markdown' ||
    format === 'binary'
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
    return () => URL.revokeObjectURL(url);
  }, [content?.bytes, content?.mime]);
  /* HTML 消毒基址：Canvas 来源的相对地址补全到 Canvas 域；本地/导入条目（watchesDisk，
     Loader 接线里即 entry kind local/imported 的近似标记）不补外域 base——空 base 下
     绝对 http(s) 链接保留、相对地址剥除，避免相对地址被补到 Canvas 域造成跨域请求泄露。
     iframe 固定为可视高度、无高度上报，内层文档自己滚（'auto'），阅读位置才记得住。 */
  const rootSize = useRootFontSize();
  const html = useMemo(
    () =>
      content?.format === 'html'
        ? sanitizeHtml(
            content.text,
            doc?.watchesDisk ? '' : 'https://oc.sjtu.edu.cn',
            rootSize,
            'auto',
          )
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
  const askPdfPage = async (title: string, page: number, bytes: ArrayBuffer, text: string) => {
    await openStudyChat({
      prompt: [
        `请阅读并讲解这份 PDF 的第 ${page} 页。`,
        `资料：${title}`,
        `本次只附上第 ${page} 页图片；没有附上其他页。`,
        text
          ? `该页 PDF 文字层（只作为辅助核对，页面图片优先）：\n${text}`
          : '该页没有可用文字层，请完全依据页面图片理解。',
        `请优先解释页面上的公式、图表、关键概念和容易误解的地方，并在回答中明确引用第 ${page} 页。`,
      ].join('\n'),
      sessionKey: `pdf:${title}`,
      images: [{ name: `${title} · 第 ${page} 页.png`, bytes }],
    });
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
              onAskPage={(page, bytes, text) => askPdfPage(content.title, page, bytes, text)}
            />
          </Suspense>
        ) : (
          <p className="p-4 text-13 text-ink-3">正在准备预览…</p>
        ))}
      {branch === 'image' && (
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {blobUrl && <img src={blobUrl} alt={content.title} className="max-w-full" />}
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
                onAskPage={(page, bytes, text) => askPdfPage(content.title, page, bytes, text)}
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
      {branch === 'binary' && (
        <p className="p-6 text-13 text-ink-3">
          这个文件不是 UTF-8 文本或体积过大，无法内嵌预览，请下载文件或用默认程序打开。
        </p>
      )}
      {content.truncated && (branch === 'text' || branch === 'markdown') && (
        <p className="shrink-0 border-b px-4 py-2 text-xs text-ink-3">
          文件超过 1 MB，这里只显示开头部分。
        </p>
      )}
      {branch === 'text' && (
        <CodeViewer
          value={content.text ?? ''}
          filename={content.title}
          scroll={scroll}
          onScroll={onScroll}
        />
      )}
      {branch === 'markdown' && (
        <div
          className="min-h-0 flex-1 overflow-auto p-6 text-13 leading-relaxed [&_h1]:mb-4 [&_h1]:text-2xl [&_h2]:my-4 [&_h2]:text-xl [&_h3]:my-3 [&_p]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_pre]:overflow-auto [&_pre]:rounded-card [&_pre]:bg-code [&_pre]:p-4 [&_pre]:text-(--syntax-fg) [&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-code [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:text-(--syntax-operator) [&_blockquote]:border-l-2 [&_blockquote]:pl-4 [&_table]:border-collapse [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:p-2"
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
              img: ({ src, alt }) =>
                src ? (
                  <img
                    src={doc.resolveImage?.(src) ?? src}
                    alt={alt ?? ''}
                    className="mx-auto max-w-full rounded-card"
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
            {content.text ?? ''}
          </ReactMarkdown>
        </div>
      )}
    </section>
  );
}
