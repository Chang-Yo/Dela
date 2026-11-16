// 连接悬浮提示的内容；触发与定位由调用方包住，这里只管内容，保证两处说法一致。
import type { WorkspaceEntry } from '../../../modules/workspace/contract';
import type { RemoteConnection } from '../../../modules/remotes/contract';
import type { RemoteActivity } from './remote-activity';
import { remoteDestination } from './remote-connections';

export function RemoteConnectionTip({
  project,
  connection,
  activity,
}: {
  project: WorkspaceEntry;
  connection?: RemoteConnection;
  activity?: RemoteActivity;
}) {
  return (
    <div className="grid gap-0.5 text-left font-normal">
      <span className="font-medium">{project.name}</span>
      <span>
        {remoteDestination(connection) ?? '远程项目'}
        {project.path ? ` · ${project.path}` : ''}
      </span>
      {activity?.phase === 'connecting' && <span>正在连接…</span>}
      {/* 失败原因本身带「读取失败」前缀，原样给。 */}
      {activity?.phase === 'failed' && <span>{activity.reason}</span>}
    </div>
  );
}
