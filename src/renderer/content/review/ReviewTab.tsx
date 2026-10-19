// 改动审阅标签的分发：轮次单文件 diff（数据冻结，读一次）与未提交改动聚合审阅
// （按请求时点重算，手动刷新）共用一个标签类型，载荷由 tab-id 区分。
import { useEffect, useState, type ReactNode } from 'react';
import { FileCode2, TriangleAlert } from 'lucide-react';
import type { FileChangeDetail } from '../../../shared/api';
import type { TabId } from '../../../shared/layout';
import { diffStatOf } from '../../../shared/diff';
import { parseReviewTabId } from './tab-id';
import { UncommittedReview } from './UncommittedReview';
import { Centered, STATUS_TEXT, basenameOf, dirnameOf } from './view-utils';
import { DiffView } from './DiffView';
import { errorText } from '../../workspace/store';

export function ReviewTab({ tabId }: { tabId: TabId; groupId: string }) {
  const target = parseReviewTabId(tabId);
  if (target?.kind === 'uncommitted') return <UncommittedReview sessionId={target.sessionId} />;
  return (
    <TurnFileReview path={target?.path} sessionId={target?.sessionId} turnId={target?.turnId} />
  );
}

/** 轮次单文件审阅：冻结记录写后不变，整个标签周期只需读取一次；
 *  记录被清理或轮次无此文件时给出原因，不做假动作入口。 */
function TurnFileReview({
  sessionId,
  turnId,
  path,
}: {
  sessionId?: string;
  turnId?: string;
  path?: string;
}) {
  const [detail, setDetail] = useState<FileChangeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId || !turnId || !path) return;
    let active = true;
    setDetail(null);
    setError(null);
    void window.dela?.chat
      .readTurnFileChange(sessionId, turnId, path)
      .then((value) => {
        if (active) setDetail(value);
      })
      .catch((cause: unknown) => {
        if (active) setError(errorText(cause));
      });
    return () => {
      active = false;
    };
  }, [sessionId, turnId, path]);

  if (!sessionId || !turnId || !path)
    return (
      <Shell>
        <Centered>无效的审阅标签</Centered>
      </Shell>
    );
  if (error)
    return (
      <Shell>
        <Centered>
          <TriangleAlert aria-hidden className="size-4 text-ink-3" />
          {error}
        </Centered>
      </Shell>
    );
  if (!detail)
    return (
      <Shell>
        <Centered role="status">正在读取变更…</Centered>
      </Shell>
    );

  const stat = diffStatOf(detail.patch);
  return (
    <Shell>
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
        <FileCode2 aria-hidden className="size-4 shrink-0 text-ink-3" />
        <span className="shrink-0 text-13 font-medium">{basenameOf(detail.path)}</span>
        <span className="min-w-0 truncate text-xs text-ink-3" title={detail.path}>
          {dirnameOf(detail.path)}
        </span>
        <span className="shrink-0 text-xs text-ink-3">· {STATUS_TEXT[detail.status]}</span>
        <span className="ml-auto flex shrink-0 gap-1.5 font-mono text-xs">
          {stat && stat.added > 0 && <span className="text-green">+{stat.added}</span>}
          {stat && stat.deleted > 0 && <span className="text-red">-{stat.deleted}</span>}
        </span>
      </header>
      {detail.note && (
        <p className="flex shrink-0 items-start gap-1.5 border-b border-line px-3 py-1.5 text-xs leading-5 text-ink-3">
          <TriangleAlert aria-hidden className="mt-0.5 size-3 shrink-0" />
          {detail.note}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-auto py-2">
        {detail.patch ? (
          <DiffView patch={detail.patch} />
        ) : (
          <Centered>此文件没有可展示的文本差异</Centered>
        )}
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <section aria-label="改动审阅" className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface">
      {children}
    </section>
  );
}
