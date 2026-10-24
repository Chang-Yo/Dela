import { useEffect, useState } from 'react';
import { ExternalLink, MessageSquare } from 'lucide-react';
import type { DocumentContent, ShuiyuanSourceRef } from '../../../shared/api';
import { Button } from '../../components/ui/button';
import { ShuiyuanIcon } from '../../components/ui/shuiyuan-icon';
import { ShuiyuanHtmlBody } from './ShuiyuanHtmlBody';
import { ShuiyuanTitle } from './shuiyuan-emoji';
import { formatListDate } from './shuiyuan-format';

/**
 * 项目工作区中的水源来源视图：主题引用卡 + 楼层正文（readSource 实时拉取，
 * 断网时 content 回退为引用行摘要文本）。
 */
export function ShuiyuanSourceDoc({
  topicId,
  content,
  text,
  onOpenInShuiyuan,
}: {
  topicId: number;
  content: DocumentContent;
  text: string;
  onOpenInShuiyuan: (topicId: number, postNumber?: number) => void;
}) {
  const [ref, setRef] = useState<ShuiyuanSourceRef | null>(null);
  useEffect(() => {
    let active = true;
    void window.dela?.shuiyuan
      .getSourceRef(topicId)
      .then((value) => {
        if (active) setRef(value);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [topicId]);

  const meta = [
    ref?.author ? `作者 ${ref.author}` : null,
    ref?.postsCount !== null && ref?.postsCount !== undefined ? `${ref.postsCount} 楼` : null,
    content.updatedAt ? `最后活动 ${formatListDate(content.updatedAt)}` : null,
  ].filter(Boolean);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 max-md:p-3">
      <div className="mx-auto grid w-full max-w-3xl gap-4">
        <section
          aria-label="水源来源"
          className="flex flex-wrap items-start gap-3 rounded-card border border-line bg-surface p-4"
        >
          <ShuiyuanIcon className="size-10 shrink-0 rounded-card" />
          <div className="grid min-w-0 flex-1 gap-1">
            <p className="flex items-center gap-1.5 text-2xs text-ink-3">
              <span className="font-medium">水源社区</span>
              {ref?.categoryName ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{ref.categoryName}</span>
                </>
              ) : null}
            </p>
            <p className="line-clamp-2 text-13 font-semibold leading-snug">
              <ShuiyuanTitle text={ref?.title ?? content.title} />
            </p>
            <p className="text-2xs text-ink-3">{meta.join(' · ') || '来自水源社区的帖子'}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              disabled={!window.dela?.shuiyuan}
              onClick={() => onOpenInShuiyuan(topicId)}
              size="sm"
              variant="outline"
            >
              <MessageSquare className="size-3.5" />
              在水源页打开
            </Button>
            {content.url ? (
              <Button
                onClick={() => void window.dela?.shuiyuan.openInBrowser(topicId)}
                size="sm"
                variant="ghost"
              >
                <ExternalLink className="size-3.5" />
                打开原帖
              </Button>
            ) : null}
          </div>
        </section>
        {content.format === 'html' ? (
          <ShuiyuanHtmlBody html={text} onOpenTopic={onOpenInShuiyuan} title="帖子内容" />
        ) : (
          <pre className="whitespace-pre-wrap break-words rounded-control border border-line bg-inset p-4 text-13 leading-relaxed">
            {text}
          </pre>
        )}
      </div>
    </div>
  );
}
