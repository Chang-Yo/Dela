// 回答末尾的「本轮改动」卡片：数据取自主进程冻结的轮次 diff（目录前后快照比较，
// 覆盖 bash 等一切写文件的途径）；默认折叠防大轮次刷屏。
import { useQuery } from '@tanstack/react-query';
import { CodeXml, FolderOpen } from 'lucide-react';
import type { FileChangeSummary } from '../../../core/protocol/agent';
import { ChangedFile, ChangesCard } from '../../../ui/agent/changes';
import { showToast } from '../../../ui/toast';
import { agentClient, chatClient } from './client';
import { errorMessage } from '../../../core/protocol/contract';
import { useChatTabSource } from './chat-source';
import { reviewTabId } from './review/tab-id';
import { basenameOf, dirnameOf } from './review/view-utils';

const fileManagerName = window.dela?.platform === 'darwin' ? 'Finder' : '资源管理器';

function TurnFileRow({
  sessionId,
  turnId,
  file,
  reviewEnabled,
}: {
  sessionId: string;
  turnId: string;
  file: FileChangeSummary;
  reviewEnabled: boolean;
}) {
  const { workbench } = useChatTabSource();
  const fail = (cause: unknown) =>
    showToast({ variant: 'error', title: '打开失败', description: errorMessage(cause) });
  return (
    <ChangedFile
      counts={reviewEnabled ? (file.stat ?? undefined) : undefined}
      deleted={file.status === 'deleted'}
      directory={dirnameOf(file.path)}
      name={basenameOf(file.path)}
      onOpen={() => {
        void chatClient
          .locateFile({ sessionId, path: file.path })
          .then((absolute) => workbench.openDocument(absolute, { aside: true }))
          .catch(fail);
      }}
      onReview={
        reviewEnabled
          ? () =>
              workbench.open(reviewTabId({ kind: 'turn', sessionId, turnId, path: file.path }), {
                aside: true,
              })
          : undefined
      }
      openWith={[
        {
          key: 'vscode',
          icon: <CodeXml className="text-accent" />,
          label: 'VS Code',
          onSelect: () => void chatClient.openInVsCode({ sessionId, path: file.path }).catch(fail),
        },
        {
          key: 'reveal',
          icon: <FolderOpen />,
          label: fileManagerName,
          onSelect: () => void chatClient.revealFile({ sessionId, path: file.path }).catch(fail),
        },
      ]}
      path={file.path}
    />
  );
}

export function TurnChangesCard({
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
  // 冻结记录写后不变：永不过期，卡片随展开/收起与切标签重挂载时不重复走 IPC。
  const { data: record } = useQuery({
    queryKey: ['chat', 'turn-changes', sessionId, turnId, reviewEnabled],
    queryFn: () =>
      agentClient['read-turn-changes']({ sessionId, turnId, includeStats: reviewEnabled }),
    staleTime: Infinity,
  });

  // 无文件的记录不渲染：远程轮次、轮前快照缺失都落在这里——不把「没有记录」伪装成空改动。
  if (!record || record.files.length === 0) return null;

  const total = record.files.reduce(
    (sum, file) => ({
      added: sum.added + (file.stat?.added ?? 0),
      deleted: sum.deleted + (file.stat?.deleted ?? 0),
    }),
    { added: 0, deleted: 0 },
  );
  return (
    <ChangesCard
      counts={reviewEnabled ? total : undefined}
      fileCount={record.files.length}
      warning={
        record.state === 'partial' && record.warnings.length > 0
          ? `部分内容未能记录：${record.warnings[0]}${
              record.warnings.length > 1 ? ` 等 ${record.warnings.length} 项` : ''
            }`
          : undefined
      }
    >
      {record.files.map((file) => (
        <TurnFileRow
          file={file}
          key={file.path}
          reviewEnabled={reviewEnabled}
          sessionId={sessionId}
          turnId={turnId}
        />
      ))}
    </ChangesCard>
  );
}
