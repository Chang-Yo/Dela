// 「新建远程项目」面板与「设置 › 远程」共用的 SSH 连接表单；密码与密钥内容都交给 ssh 自己读取。
import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { Button } from '../../../ui/button';
import { Card } from '../../../ui/card';
import { Input } from '../../../ui/input';
import type { RemoteConnection, RemoteDraft } from '../contract';
import { useWorkspaceStore } from '../../workspace/view';
import { remotesClient } from './client';
import { refreshRemoteConnections } from './remote-state';
import { Alert } from '../../../ui/alert';
import { ErrorText } from '../../../ui/error-text';
import { Spinner } from '../../../ui/spinner';
import { Field } from '../../../ui/field';
import { errorMessage } from '../../../core/protocol/contract';

const MAX_PORT = 65535;

export function ConnectionForm({
  connection,
  initial,
  onBack,
  onSaved,
  onRemoved,
  onOpenProject,
  onProjectsRemoved,
}: {
  connection?: RemoteConnection;
  initial?: RemoteDraft;
  onBack: () => void;
  onSaved: (connection: RemoteConnection) => void;
  onRemoved?: (id: string) => void;
  onOpenProject: (projectId: string) => void;
  onProjectsRemoved: (liveIds: Set<string>) => void;
}) {
  const queryClient = useQueryClient();
  const start = connection ?? initial;
  const [label, setLabel] = useState(start?.label ?? '');
  const [host, setHost] = useState(start?.host ?? '');
  const [port, setPort] = useState(start?.port == null ? '' : String(start.port));
  const [keyPath, setKeyPath] = useState(start?.keyPath ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removeConfirm, setRemoveConfirm] = useState(false);
  // 选择器必须返回稳定引用（useSyncExternalStore 的 getSnapshot 缓存要求），过滤放渲染期。
  const entries = useWorkspaceStore((state) => state.workspace.entries);
  const projects = connection
    ? entries.filter((entry) => entry.kind === 'project' && entry.remoteId === connection.id)
    : [];

  const problem = () => {
    if (!host.trim()) return '请输入 SSH 目的地';
    const value = port.trim();
    if (value) {
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_PORT)
        return `端口需为 1–${MAX_PORT} 的整数`;
    }
    return null;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!window.dela || busy) return;
    const invalid = problem();
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError(null);
    const input = {
      id: connection?.id ?? null,
      label: label.trim() || undefined,
      host: host.trim(),
      port: port.trim() ? Number(port) : null,
      keyPath: keyPath.trim() || null,
    };
    try {
      const saved = await remotesClient.save(input);
      await refreshRemoteConnections(queryClient);
      onSaved(saved);
    } catch (cause) {
      setError(errorMessage(cause));
    }
    setBusy(false);
  };

  const remove = async () => {
    if (!window.dela || !connection || busy) return;
    setBusy(true);
    setError(null);
    try {
      await remotesClient.remove(connection.id);
      await refreshRemoteConnections(queryClient);
      // 名下项目随连接被级联移除，主进程不单推工作区变更：拉一次镜像后交外壳清场。
      if (projects.length) {
        await useWorkspaceStore.getState().refresh();
        onProjectsRemoved(
          new Set(useWorkspaceStore.getState().workspace.entries.map((entry) => entry.id)),
        );
      }
      if (onRemoved) onRemoved(connection.id);
    } catch (cause) {
      setError(errorMessage(cause));
    }
    setBusy(false);
  };

  const pickKey = async () => {
    if (!window.dela || busy) return;
    try {
      const picked = await remotesClient.pickKey();
      if (picked) setKeyPath(picked);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  return (
    <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
      <Button className="-ml-2.5 w-fit" onClick={onBack} variant="ghost">
        <ArrowLeft />
        {connection ? `编辑 ${connection.label}` : '新建连接'}
      </Button>
      <Field label="名称">
        <Input
          aria-label="连接名称"
          autoComplete="off"
          onChange={(event) => setLabel(event.target.value)}
          placeholder="可选，默认用目的地"
          value={label}
        />
      </Field>
      <Field label="SSH 目的地">
        <Input
          aria-label="SSH 目的地"
          autoComplete="off"
          autoFocus={!connection}
          onChange={(event) => setHost(event.target.value)}
          placeholder="user@10.0.0.5 或 ~/.ssh/config 里的别名"
          value={host}
        />
      </Field>
      <div className="grid grid-cols-[6rem_1fr] gap-3">
        <Field label="端口">
          <Input
            aria-label="SSH 端口"
            autoComplete="off"
            inputMode="numeric"
            onChange={(event) => setPort(event.target.value)}
            placeholder="22"
            value={port}
          />
        </Field>
        <Field label="私钥文件">
          <div className="flex items-center gap-2">
            <Input
              aria-label="私钥文件"
              autoComplete="off"
              onChange={(event) => setKeyPath(event.target.value)}
              placeholder="留空由 ssh 按 config 与 agent 解析"
              value={keyPath}
            />
            <Button onClick={() => void pickKey()} size="sm" type="button" variant="secondary">
              选择…
            </Button>
          </div>
        </Field>
      </div>
      {/* 不提供密码输入：Dela 只支持密钥与 ssh agent，放一个点了没用的控件更糟。 */}
      <p className="text-xs leading-relaxed text-ink-3">
        暂不支持密码登录：请使用密钥或 ssh agent，或在 ~/.ssh/config 中为该主机配置好认证。
      </p>
      {projects.length > 0 && (
        <Card className="grid gap-1" variant="inset">
          <h3 className="text-sm font-semibold text-ink-2">使用此连接的项目</h3>
          <ul className="grid">
            {projects.map((project) => (
              <li
                className="flex items-center justify-between gap-3 border-b border-line py-2.5 last:border-0"
                key={project.id}
              >
                <div className="flex min-w-0 items-baseline gap-3">
                  <span className="shrink-0 text-sm" title={project.name}>
                    {project.name}
                  </span>
                  <span className="truncate text-xs text-ink-3" title={project.path}>
                    {project.path}
                  </span>
                </div>
                <Button
                  disabled={busy}
                  onClick={() => onOpenProject(project.id)}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  打开项目
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {error && <ErrorText>{error}</ErrorText>}
      {connection && onRemoved && removeConfirm && (
        <Alert
          action={
            <div className="flex items-center gap-2">
              <Button
                disabled={busy}
                onClick={() => void remove()}
                size="sm"
                type="button"
                variant="destructive"
              >
                确认删除
              </Button>
              <Button
                disabled={busy}
                onClick={() => setRemoveConfirm(false)}
                size="sm"
                type="button"
                variant="ghost"
              >
                取消
              </Button>
            </div>
          }
        >
          {projects.length
            ? `删除连接将同时移除 ${projects.length} 个项目并删除其全部聊天记录；远端目录与文件保留。`
            : '删除连接？需要时重新添加即可。'}
        </Alert>
      )}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {connection && onRemoved && !removeConfirm && (
            <Button
              className="text-ink-3 hover:text-danger"
              disabled={busy}
              onClick={() => setRemoveConfirm(true)}
              type="button"
              variant="ghost"
            >
              删除连接
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button disabled={busy} onClick={onBack} type="button" variant="ghost">
            取消
          </Button>
          <Button disabled={busy} type="submit">
            {busy && <Spinner />}
            {connection ? '保存' : '保存并连接'}
          </Button>
        </div>
      </div>
    </form>
  );
}
