import { LegalMarkdown } from '../../../components/legal-markdown';
import { SectionHeader } from '../SectionHeader';

/**
 * 设置 › 条款页骨架：正文是仓库根目录 docs 下的 Markdown，构建时以 ?raw 内联，官网发布同一份文本。
 * 限宽 42rem 保证可读行宽；元素级版式与首次启动的接受页共用 legal-markdown.tsx。
 */
const articleClass = 'max-w-[42rem] text-13 leading-relaxed text-ink-2';

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
        <LegalMarkdown markdown={markdown} />
      </article>
    </div>
  );
}
