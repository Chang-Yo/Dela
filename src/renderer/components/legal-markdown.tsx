import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * 条款正文（仓库根目录 docs 下的 Markdown）到界面的映射：隐私页、使用条款页与首次启动的
 * 接受页三处共用，改这里三处一起变，正文只改 docs 里的文件。
 *
 * 只映射元素级样式，行宽、字号与颜色由各处的容器给。小节间距落在标题自己身上：
 * Markdown 的块是平级兄弟节点，容器给不了 grid 间距；h1 与各处页面标题重复，不渲染，
 * `first:mt-0` 兜底文档直接从 h2 开头的情况。
 */
const components: Components = {
  h1: () => null,
  h2: ({ children }) => (
    <h2 className="mt-10 text-base font-semibold text-ink first:mt-0">{children}</h2>
  ),
  p: ({ children }) => <p className="mt-3">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
  ul: ({ children }) => <ul className="mt-3 grid list-disc gap-1.5 pl-4">{children}</ul>,
  // 使用条款开头的接受声明做成卡片，段落的 mt-3 在这里要压掉。
  blockquote: ({ children }) => (
    <blockquote className="rounded-card bg-inset px-4 py-3 text-ink [&_p]:mt-0">
      {children}
    </blockquote>
  ),
  // 站外链接由主进程的 will-navigate / setWindowOpenHandler 交给系统浏览器。
  a: ({ children, href }) => (
    <a
      className="rounded-chip text-ink underline underline-offset-4 transition-colors ease-out-strong hover:text-ink-2"
      href={href}
      rel="noreferrer"
      target="_blank"
    >
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="mt-3 w-full overflow-x-auto">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-line px-2 py-1 text-left font-medium text-ink">{children}</th>
  ),
  td: ({ children }) => <td className="border border-line px-2 py-1 align-top">{children}</td>,
};

export function LegalMarkdown({ markdown }: { markdown: string }) {
  return (
    <ReactMarkdown components={components} remarkPlugins={[remarkGfm]}>
      {markdown}
    </ReactMarkdown>
  );
}
