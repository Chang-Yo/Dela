// 新建 / 编辑 SSH 连接的表单：「新建远程项目」面板与「设置 › 远程」共用这一份。
// Dela 只存目的地、端口与私钥路径；密码与密钥内容都交给 ssh 自己读取。
import { useState, type FormEvent } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import type { RemoteConnection, RemoteDraft } from '../../../shared/api';
import { errorText, useWorkspaceStore } from '../store';
import { useNavigationStore } from '../../navigation/view';
import { purgeRemovedEntries } from '../../workbench/removed-cleanup';

/** 端口上限与 ssh 自身一致；空串表示交给 ssh 按 config 解析。 */
const MAX_PORT = 65535;

export function ConnectionForm({
  connection,
  initial,
  onBack,
  onSaved,
  onRemoved,
}: {
  /** 编辑已有连接；缺省为新建。 */
  connection?: RemoteConnection;
  /** 新建时的预填（如从 ssh config 候选来）。 */
  initial?: RemoteDraft;
  onBack: () => void;
  onSaved: (connection: RemoteConnection) => void;
  onRemoved?: (id: string) => void;
}) {
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
  // 名下项目随连接一并移除：这里列出它们是删除后果的预告，也方便删除前跳进去看一眼。
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
    const remotes = window.dela?.remotes;
    if (!remotes || busy) return;
    const invalid = problem();
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onSaved(
        await remotes.save({
          id: connection?.id ?? null,
          label: label.trim() || undefined,
          host: host.trim(),
          port: port.trim() ? Number(port) : null,
          keyPath: keyPath.trim() || null,
        }),
      );
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const remotes = window.dela?.remotes;
    if (!remotes || !connection || busy) return;
    setBusy(true);
    setError(null);
    try {
      await remotes.remove(connection.id);
      // 名下项目随连接被级联移除，主进程不单推工作区变更：拉一次镜像后做与
      // 资料树移除同一份的清场（关死标签、退出死项目、清后退栈里的死路由）。
      if (projects.length) {
        await useWorkspaceStore.getState().refresh();
        purgeRemovedEntries(
          new Set(useWorkspaceStore.getState().workspace.entries.map((entry) => entry.id)),
        );
      }
      onRemoved?.(connection.id);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const pickKey = async () => {
    const remotes = window.dela?.remotes;
    if (!remotes || busy) return;
    try {
      const picked = await remotes.pickKey();
      if (picked) setKeyPath(picked);
    } catch (cause) {
      setError(errorText(cause));
    }
  };

  return (
    <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
      <button
        className="flex w-fit items-center gap-1.5 text-13 font-medium text-ink-2 transition-colors duration-150 hover:text-ink"
        onClick={onBack}
        type="button"
      >
        <ArrowLeft className="size-4" />
        {connection ? `编辑 ${connection.label}` : '新建连接'}
      </button>
      <label className="grid gap-1.5 text-xs text-ink-2">
        名称
        <Input
          aria-label="连接名称"
          autoComplete="off"
          onChange={(event) => setLabel(event.target.value)}
          placeholder="可选，默认用目的地"
          value={label}
        />
      </label>
      <label className="grid gap-1.5 text-xs text-ink-2">
        SSH 目的地
        <Input
          aria-label="SSH 目的地"
          autoComplete="off"
          autoFocus={!connection}
          onChange={(event) => setHost(event.target.value)}
          placeholder="user@10.0.0.5 或 ~/.ssh/config 里的别名"
          value={host}
        />
      </label>
      <div className="grid grid-cols-[6rem_1fr] gap-3">
        <label className="grid gap-1.5 text-xs text-ink-2">
          端口
          <Input
            aria-label="SSH 端口"
            autoComplete="off"
            inputMode="numeric"
            onChange={(event) => setPort(event.target.value)}
            placeholder="22"
            value={port}
          />
        </label>
        <label className="grid gap-1.5 text-xs text-ink-2">
          私钥文件
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
        </label>
      </div>
      {/* 不提供密码输入：Dela 只支持密钥与 ssh agent，放一个点了没用的控件更糟。 */}
      <p className="text-xs leading-relaxed text-ink-3">
        暂不支持密码登录：请使用密钥或 ssh agent，或在 ~/.ssh/config 中为该主机配置好认证。
      </p>
      {projects.length > 0 && (
        <div className="grid gap-1 rounded-card bg-inset px-4 py-2">
          <h3 className="text-13 font-semibold text-ink-2">使用此连接的项目</h3>
          <ul className="grid">
            {projects.map((project) => (
              <li
                className="flex items-center justify-between gap-3 border-b border-line py-2.5 last:border-0"
                key={project.id}
              >
                <div className="flex min-w-0 items-baseline gap-3">
                  <span className="shrink-0 text-13" title={project.name}>
                    {project.name}
                  </span>
                  <span className="truncate text-xs text-ink-3" title={project.path}>
                    {project.path}
                  </span>
                </div>
                <Button
                  disabled={busy}
                  onClick={() => useNavigationStore.getState().openProject(project.id)}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  打开项目
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && (
        <p className="text-xs [overflow-wrap:anywhere] text-red" role="alert">
          {error}
        </p>
      )}
      {connection && onRemoved && removeConfirm && (
        <div className="flex flex-wrap items-center gap-2 rounded-card border border-line border-destructive/40 bg-red-tint p-3">
          <span className="text-xs">
            {projects.length
              ? `删除连接将同时移除 ${projects.length} 个项目并删除其全部聊天记录；远端目录与文件保留。`
              : '删除连接？需要时重新添加即可。'}
          </span>
          <div className="ml-auto flex items-center gap-2">
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
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {connection && onRemoved && !removeConfirm && (
            <Button
              className="text-ink-3 hover:text-red"
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
            {busy && <Loader2 className="animate-spin" />}
            {connection ? '保存' : '保存并连接'}
          </Button>
        </div>
      </div>
    </form>
  );
}
