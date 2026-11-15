// 回答末尾的「本轮改动」卡片：数据取自主进程冻结的轮次 diff（目录前后快照比较，
// 覆盖 bash 等一切写文件的途径）；默认折叠防大轮次刷屏。
import { memo, useEffect, useState } from 'react';
import { ChevronDown, CodeXml, FolderOpen } from 'lucide-react';
import type { FileChangeSummary, TurnChanges } from '../../../shared/api';
import type { DiffStat } from '../../../core/protocol/diff';
import { Button } from '../../../ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../ui/dropdown-menu';
import { documentTabId } from '../../navigation/view';
import { openTarget } from '../../workbench/open-target';
import { reviewTabId } from '../review/tab-id';
import { FileIcon, basenameOf, dirnameOf } from '../review/view-utils';
import { fileManagerName } from '../../lib/platform';
import { showToast } from '../../app/toasts';
import { agentClient, chatClient } from '../../../modules/chat/view';
import { errorMessage } from '../../../core/protocol/contract';

// 冻结记录写后不变：按「会话:轮次」缓存读取，卡片随展开/收起与切标签重挂载时不重复走 IPC。
const turnCache = new Map<string, Promise<TurnChanges | null>>();

function loadTurn(
  sessionId: string,
  turnId: string,
  includeStats: boolean,
): Promise<TurnChanges | null> {
  const key = `${sessionId}:${turnId}:${includeStats}`;
  let pending = turnCache.get(key);
  if (!pending) {
    pending = window.dela
      ? agentClient['read-turn-changes']({ sessionId, turnId, includeStats }).catch(() => null)
      : Promise.resolve(null);
    turnCache.set(key, pending);
  }
  return pending;
}

const StatSpan = memo(function StatSpan({ stat }: { stat: DiffStat }) {
  return (
    <span className="flex shrink-0 gap-1.5 font-mono text-xs">
      {stat.added > 0 && <span className="text-success">+{stat.added}</span>}
      {stat.deleted > 0 && <span className="text-danger">-{stat.deleted}</span>}
    </span>
  );
});

const TurnFileRow = memo(function TurnFileRow({
  sessionId,
  turnId,
  file,
  stat,
  reviewEnabled,
}: {
  sessionId: string;
  turnId: string;
  file: FileChangeSummary;
  stat: DiffStat | null | undefined;
  reviewEnabled: boolean;
}) {
  const deleted = file.status === 'deleted';
  const fail = (cause: unknown) =>
    showToast({ variant: 'error', title: '打开失败', description: errorMessage(cause) });
  /** deleted 时必然解析失败，对应按钮已禁用。 */
  const openInDela = () => {
    void chatClient
      .locateFile({ sessionId, path: file.path })
      .then((absolute) => openTarget(documentTabId(absolute), { aside: true }))
      .catch(fail);
  };
  const review = () =>
    openTarget(reviewTabId({ kind: 'turn', sessionId, turnId, path: file.path }), { aside: true });
  return (
    <li className="flex min-w-0 items-center gap-2 px-3 py-1.5" data-turn-file={file.path}>
      <FileIcon path={file.path} />
      <span className="shrink-0 truncate text-sm" title={file.path}>
        {basenameOf(file.path)}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-ink-3" title={file.path}>
        {dirnameOf(file.path)}
      </span>
      {reviewEnabled && stat && <StatSpan stat={stat} />}
      {reviewEnabled && (
        <Button className="shrink-0" onClick={review} size="sm" type="button" variant="outline">
          审阅
        </Button>
      )}
      <div className="flex h-7 shrink-0 items-center rounded-control shadow-hairline">
        <button
          className="grid h-full place-items-center rounded-l-control px-2.5 text-xs font-medium text-ink-2 transition-colors duration-base hover:bg-hover hover:text-ink disabled:pointer-events-none disabled:opacity-50"
          disabled={deleted}
          onClick={openInDela}
          title={deleted ? '文件已删除' : '在 Dela 中打开'}
          type="button"
        >
          打开
        </button>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button
              aria-label="选择打开方式"
              className="grid h-full w-5 place-items-center rounded-r-control border-l border-line text-ink-3 transition-colors duration-base hover:bg-hover hover:text-ink disabled:pointer-events-none disabled:opacity-50"
              disabled={deleted}
              title="选择打开方式"
              type="button"
            >
              <ChevronDown className="size-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() =>
                void chatClient.openInVsCode({ sessionId, path: file.path }).catch(fail)
              }
            >
              <CodeXml className="text-accent" />
              VS Code
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                void chatClient.revealFile({ sessionId, path: file.path }).catch(fail)
              }
            >
              <FolderOpen />
              {fileManagerName}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
});

export const TurnChangesCard = memo(function TurnChangesCard({
  sessionId,
  turnId,
  reviewEnabled,
}: {
  sessionId: string;
  /** 消息上继承的轮次标识；无冻结记录（旧消息、落盘失败）时整卡不渲染。 */
  turnId: string;
  /** 仅项目会话提供差异审阅与行数统计。 */
  reviewEnabled: boolean;
}) {
  const [record, setRecord] = useState<TurnChanges | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let active = true;
    setRecord(null);
    void loadTurn(sessionId, turnId, reviewEnabled).then((value) => {
      if (!active) return;
      setRecord(value);
    });
    return () => {
      active = false;
    };
  }, [sessionId, turnId, reviewEnabled]);

  // 无文件的记录不渲染：远程轮次、轮前快照缺失都落在这里——不把「没有记录」伪装成空改动。
  if (!record || record.files.length === 0) return null;

  const total = (reviewEnabled ? record.files : []).reduce(
    (sum, file) => ({
      added: sum.added + (file.stat?.added ?? 0),
      deleted: sum.deleted + (file.stat?.deleted ?? 0),
    }),
    { added: 0, deleted: 0 },
  );
  return (
    <section
      aria-label="本轮改动"
      className="mt-3 overflow-hidden rounded-card border border-line text-sm"
    >
      <button
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left transition-colors duration-base hover:bg-hover"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <ChevronDown
          aria-hidden
          className={`size-3.5 shrink-0 text-ink-3 transition-transform duration-base ${open ? '' : '-rotate-90'}`}
        />
        <span className="shrink-0 text-xs text-ink-3">本轮改动 · {record.files.length} 个文件</span>
        <span className="flex min-w-0 gap-1.5 font-mono text-xs">
          {total.added > 0 && <span className="text-success">+{total.added}</span>}
          {total.deleted > 0 && <span className="text-danger">-{total.deleted}</span>}
        </span>
      </button>
      {open && (
        <>
          <ul className="grid border-t border-line">
            {record.files.map((file) => (
              <TurnFileRow
                file={file}
                key={file.path}
                reviewEnabled={reviewEnabled}
                sessionId={sessionId}
                stat={file.stat}
                turnId={turnId}
              />
            ))}
          </ul>
          {record.state === 'partial' && record.warnings.length > 0 && (
            <p className="border-t border-line px-3 py-2 text-xs leading-5 text-ink-3">
              部分内容未能记录：
              {record.warnings[0]}
              {record.warnings.length > 1 && ` 等 ${record.warnings.length} 项`}
            </p>
          )}
        </>
      )}
    </section>
  );
});
