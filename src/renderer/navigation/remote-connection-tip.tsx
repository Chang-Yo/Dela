// 连接悬浮提示的内容：这个项目连的是哪台机器、远端根目录在哪、此刻在不在连。
// 触发与定位由调用方用 components/ui/tooltip 包住（项目行、资源管理器标题各一处），
// 这里只管内容，保证两处说法一致。
import type { WorkspaceEntry } from '../../shared/api';
import type { RemoteConnection } from '../../shared/remotes';
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
      {/* 失败原因本身就是「读取失败 <路径>：<原因>」，这里原样给，不再套一层前缀。 */}
      {activity?.phase === 'failed' && <span>{activity.reason}</span>}
    </div>
  );
}
