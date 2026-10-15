import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { SectionHeader } from '../SectionHeader';

/**
 * 设置 › 条款页（隐私条款 / 使用条款）的共用版式。
 * 正文是仓库根目录 docs 下的 Markdown，构建时以 ?raw 内联：改条款只改那个文件，
 * 官网发布同一份文本，组件里不另抄一遍。两页映射完全一致，限宽 42rem 保证可读行宽，
 * 正文 text-13；小节一律「序号 + 标题」，段落、枚举与表格共用同一组类名。
 * 正文里最需要读者记住的一句加粗（`font-semibold text-ink`）。
 */
const articleClass = 'max-w-[42rem] text-13 leading-relaxed text-ink-2';
const headingClass = 'text-base font-semibold text-ink';
const paragraphClass = 'mt-3';
const listClass = 'mt-3 grid list-disc gap-1.5 pl-4';
const tableWrapperClass = 'mt-3 w-full overflow-x-auto';
const tableClass = 'w-full border-collapse text-xs';
const tableHeadClass = 'border border-line px-2 py-1 text-left font-medium text-ink';
const tableCellClass = 'border border-line px-2 py-1 align-top';

/**
 * 小节间距落在标题自己身上：Markdown 的块是平级兄弟节点，容器给不了 grid 间距。
 * h1 与页面标题重复，不渲染。`first:mt-0` 兜底文档若直接从 h2 开头。
 */
const components: Components = {
  h1: () => null,
  h2: ({ children }) => <h2 className={`mt-10 first:mt-0 ${headingClass}`}>{children}</h2>,
  p: ({ children }) => <p className={paragraphClass}>{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
  ul: ({ children }) => <ul className={listClass}>{children}</ul>,
  // 开头的接受声明做成卡片，段落的 mt-3 在这里要压掉。
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
    <div className={tableWrapperClass}>
      <table className={tableClass}>{children}</table>
    </div>
  ),
  th: ({ children }) => <th className={tableHeadClass}>{children}</th>,
  td: ({ children }) => <td className={tableCellClass}>{children}</td>,
};

export function LegalDocument({
  markdown,
  settingId,
  title,
}: {
  markdown: string;
  settingId: string;
  title: string;
}) {
  return (
    <div className="grid gap-10" data-setting-id={settingId}>
      <SectionHeader title={title} />
      <article className={articleClass}>
        <ReactMarkdown components={components} remarkPlugins={[remarkGfm]}>
          {markdown}
        </ReactMarkdown>
      </article>
    </div>
  );
}
