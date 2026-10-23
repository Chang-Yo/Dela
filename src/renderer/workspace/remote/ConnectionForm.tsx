// 新建 / 编辑 SSH 连接的表单：「新建远程项目」面板与「设置 › 远程」共用这一份。
// Dela 只存目的地、端口与私钥路径；密码与密钥内容都交给 ssh 自己读取。
import { useState, type FormEvent } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import type { RemoteConnection, RemoteDraft } from '../../../shared/api';
import { errorText } from '../store';

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
      onRemoved?.(connection.id);
    } catch (cause) {
      // main 的拒绝原因（如「该连接下还有项目，请先移除项目」）原样显示。
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
      {error && (
        <p className="text-xs [overflow-wrap:anywhere] text-red" role="alert">
          {error}
        </p>
      )}
      <div className="flex items-center justify-between gap-2">
        <div>
          {connection && onRemoved && (
            <Button
              className="text-ink-3 hover:text-red"
              disabled={busy}
              onClick={() => void remove()}
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
