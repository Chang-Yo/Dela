// 设置 › 远程：已保存的 SSH 连接与它们的实时通道状态。编辑与新建用「新建远程项目」面板里同一份表单，
// 状态点读 helper 通道的推送，不再是一次性的「测试连接」结果。
// Dela 不保存密码与密钥，凭据由 ssh 从 ~/.ssh 与 agent 读取。
import { useState, type ComponentType } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Cloud, Plus } from 'lucide-react';
import type { RemoteConnection } from '../contract';
import { Button } from '../../../ui/button';
import { cn } from '../../../ui/cn';
import { remoteAccent } from './remote-color';
import { ConnectionForm } from './ConnectionForm';
import { channelDot, remoteConnectionsQuery, useRemoteChannels } from './remote-state';
import { SectionHeader, SettingRow, SettingsGroup } from '../../settings/view';

type Editing = { connection?: RemoteConnection } | null;

export function RemoteSection({
  NewProjectDialog,
  onOpenProject,
  onProjectsRemoved,
}: {
  /** 「新建远程项目」面板属于工作区外壳，由设置页传入。 */
  NewProjectDialog: ComponentType<{
    initialConnectionId?: string;
    onClose: () => void;
    onImported: () => void;
    open: boolean;
  }>;
  onOpenProject: (projectId: string) => void;
  onProjectsRemoved: (liveIds: Set<string>) => void;
}) {
  const connections = useQuery(remoteConnectionsQuery).data ?? null;
  const channels = useRemoteChannels();
  const [editing, setEditing] = useState<Editing>(null);
  const [projectFor, setProjectFor] = useState<string | null>(null);

  if (editing)
    return (
      <div className="mx-auto grid w-full max-w-lg gap-6">
        <ConnectionForm
          connection={editing.connection}
          onBack={() => setEditing(null)}
          onOpenProject={onOpenProject}
          onProjectsRemoved={onProjectsRemoved}
          onRemoved={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      </div>
    );

  return (
    <div className="grid gap-10">
      <SectionHeader
        action={
          <Button onClick={() => setEditing({})} size="sm" variant="secondary">
            <Plus />
            新建连接
          </Button>
        }
        description="经 SSH 使用远端主机上的目录；Dela 只保存目的地与私钥路径，凭据由 ssh 自己读取。~/.ssh/config 里的主机会出现在「新建远程项目」的服务器列表里。"
        title="远程"
      />
      {connections !== null && connections.length === 0 && (
        <SettingsGroup>
          <div className="grid gap-1 py-3.5">
            <span className="text-sm font-medium text-ink">还没有 SSH 连接</span>
            <span className="text-xs leading-relaxed text-ink-3">
              点「新建连接」填一个目的地，或在新建远程项目时直接选 ~/.ssh/config 里的主机。
            </span>
          </div>
        </SettingsGroup>
      )}
      {connections !== null && connections.length > 0 && (
        <SettingsGroup>
          {connections.map((connection) => {
            const channel = channels[connection.host];
            const dot = channelDot(channel);
            const target = `${connection.host}${connection.port === null ? '' : `:${connection.port}`}`;
            return (
              <SettingRow
                description={
                  <>
                    <span className="block truncate" title={target}>
                      {target} · {connection.keyPath ?? 'ssh 默认'}
                    </span>
                    {channel?.state === 'unavailable' && (
                      <span className="block [overflow-wrap:anywhere] text-danger" role="alert">
                        {channel.reason}
                      </span>
                    )}
                  </>
                }
                key={connection.id}
                leading={
                  <span
                    aria-hidden="true"
                    className="grid size-8 shrink-0 place-items-center rounded-card"
                    style={{ background: remoteAccent(connection.id, 'bg') }}
                  >
                    <Cloud
                      className="size-4"
                      strokeWidth={1.8}
                      style={{ color: remoteAccent(connection.id, 'text') }}
                    />
                  </span>
                }
                settingId={`remote-${connection.id}`}
                title={connection.label}
              >
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <span className="flex items-center gap-1.5 text-xs text-ink-2">
                    <span
                      aria-hidden="true"
                      className={cn('size-1.5 shrink-0 rounded-full', dot.className)}
                    />
                    {dot.label}
                  </span>
                  <Button
                    onClick={() => setProjectFor(connection.id)}
                    size="sm"
                    variant="secondary"
                  >
                    新建项目
                  </Button>
                  <Button
                    className="text-ink-3 hover:text-ink"
                    onClick={() => setEditing({ connection })}
                    size="sm"
                    variant="ghost"
                  >
                    编辑
                  </Button>
                </div>
              </SettingRow>
            );
          })}
        </SettingsGroup>
      )}
      <NewProjectDialog
        initialConnectionId={projectFor ?? undefined}
        onClose={() => setProjectFor(null)}
        onImported={() => setProjectFor(null)}
        open={projectFor !== null}
      />
    </div>
  );
}
