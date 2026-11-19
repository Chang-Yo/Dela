import { LegalMarkdown } from './legal-markdown';
import { SectionHeader } from './SectionHeader';

/** 设置 › 条款页骨架：正文是 docs 下的 Markdown（?raw 内联），元素级版式见 legal-markdown.tsx。 */
const articleClass = 'max-w-168 text-sm leading-relaxed text-ink-2';

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
