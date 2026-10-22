// 连接远程目录向导：事实来源全在主进程；向导不落凭据，只存目的地、端口与私钥路径，密码交给 ssh。
// 第 3 步「连接」真的上传并启动一遍 helper：远程项目的全部能力都经它，起不来就停在这一步，
// 而不是等到第一次调工具才失败（docs/DEVELOPMENT.md §4）。
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Dialog } from 'radix-ui';
import { ArrowLeft, ArrowUp, Check, Folder, House, Loader2, Plus, Server, X } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { dialogOverlay, dialogPanel } from '../components/ui/motion';
import { cn } from '../lib/utils';
import type {
  RemoteBrowseResult,
  RemoteConnection,
  RemoteDraft,
  RemotePrepare,
  RemoteSetupProgress,
  RemoteSetupStep,
  WorkspaceEntry,
} from '../../shared/api';
import { unhideProjectInNav } from '../navigation/store';
import { errorText, useWorkspaceStore } from './store';

const steps = ['选择方式', '填写连接', '连接', '选择目录'] as const;

/** 端口上限与 ssh 自身一致；空串表示交给 ssh 按 config 解析。 */
const MAX_PORT = 65535;

/** 进行中的动作：按钮文案与禁用范围据此区分，不用假进度条。 */
type WizardWork = 'connect' | 'browse' | 'import';

/** 引导步骤的中文名：日志行只在这里翻成人话，事件里传的是稳定标识。 */
const stepLabels: Record<RemoteSetupStep, string> = {
  probe: '探测',
  upload: '上传',
  verify: '校验',
  start: '启动',
  tunnel: '隧道',
  handshake: '握手',
  ready: '就绪',
};

/** 一行引导日志：像终端输出而不是进度条。失败行（ok=false）用红色并挂 alert。 */
function SetupLine({ progress }: { progress: RemoteSetupProgress }) {
  const failed = progress.ok === false;
  return (
    <p
      className={cn('flex min-w-0 gap-2', failed && 'text-red')}
      role={failed ? 'alert' : undefined}
    >
      {progress.ok === true ? (
        <Check className="mt-1 size-3 shrink-0 text-green" aria-hidden="true" />
      ) : failed ? (
        <X className="mt-1 size-3 shrink-0 text-red" aria-hidden="true" />
      ) : (
        <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-ink-3" />
      )}
      <span className={cn('shrink-0', progress.ok === false ? undefined : 'text-ink-3')}>
        {stepLabels[progress.step]}
      </span>
      <span className={cn('min-w-0 [overflow-wrap:anywhere]', !failed && 'text-ink-2')}>
        {progress.detail}
      </span>
    </p>
  );
}

export function RemoteConnectionWizard({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  /** 取消或登记成功后关闭。 */
  onClose: () => void;
  /** 已登记为项目：接线方负责关掉外层弹窗并打开项目。 */
  onImported: (entry: WorkspaceEntry) => void;
}) {
  const [step, setStep] = useState(0);
  const [connections, setConnections] = useState<RemoteConnection[] | null>(null);
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [keyPath, setKeyPath] = useState('');
  const [prepared, setPrepared] = useState<RemotePrepare | null>(null);
  const [setupLog, setSetupLog] = useState<RemoteSetupProgress[]>([]);
  const [browse, setBrowse] = useState<RemoteBrowseResult | null>(null);
  const [home, setHome] = useState<string | null>(null);
  const [work, setWork] = useState<WizardWork | null>(null);
  const [error, setError] = useState<string | null>(null);
  const working = work !== null;
  const logRef = useRef<HTMLDivElement | null>(null);

  // 每次打开都从第一步开始：上次的探测结果与目录位置不能带进来。
  useEffect(() => {
    if (!open) return;
    setStep(0);
    setConnections(null);
    setConnectionId(null);
    setLabel('');
    setHost('');
    setPort('');
    setKeyPath('');
    setPrepared(null);
    setSetupLog([]);
    setBrowse(null);
    setHome(null);
    setWork(null);
    setError(null);
    const remotes = window.dela?.remotes;
    if (!remotes) {
      setConnections([]);
      return;
    }
    let live = true;
    void remotes.list().then(
      (list) => {
        if (live) setConnections(list);
      },
      (cause) => {
        if (!live) return;
        setConnections([]);
        setError(errorText(cause));
      },
    );
    return () => {
      live = false;
    };
  }, [open]);

  // 引导进度由主进程推着走：订阅只在本向导打开期间有效。
  useEffect(() => {
    if (!open) return;
    const remotes = window.dela?.remotes;
    if (!remotes) return;
    return remotes.onSetupProgress((progress) => setSetupLog((prev) => [...prev, progress]));
  }, [open]);

  // 新行进来就贴底：日志区固定高度，阅读位置跟着输出往前走。
  useEffect(() => {
    const node = logRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [setupLog]);

  const draftOf = (): RemoteDraft => ({
    label: label.trim() || undefined,
    host: host.trim(),
    port: port.trim() ? Number(port) : null,
    keyPath: keyPath.trim() || null,
  });

  /** 端口可空；填了就必须是 1–65535 的整数，否则 ssh 会拿到一个它不认识的参数。 */
  const portValid = () => {
    const value = port.trim();
    if (!value) return true;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_PORT;
  };

  const hostProblem = () => {
    if (!host.trim()) return '请输入 SSH 目的地';
    if (!portValid()) return `端口需为 1–${MAX_PORT} 的整数`;
    return null;
  };

  const chooseConnection = (connection: RemoteConnection) => {
    setConnectionId(connection.id);
    setLabel(connection.label);
    setHost(connection.host);
    setPort(connection.port === null ? '' : String(connection.port));
    setKeyPath(connection.keyPath ?? '');
    setPrepared(null);
    setSetupLog([]);
    setError(null);
    setStep(2);
  };

  const startNewConnection = () => {
    setConnectionId(null);
    setLabel('');
    setHost('');
    setPort('');
    setKeyPath('');
    setPrepared(null);
    setSetupLog([]);
    setError(null);
    setStep(1);
  };

  /** 私钥选择器：取消返回 null，此时不动输入框里已有的内容。 */
  const pickKey = async () => {
    const remotes = window.dela?.remotes;
    if (!remotes || working) return;
    try {
      const picked = await remotes.pickKey();
      if (picked) setKeyPath(picked);
    } catch (cause) {
      setError(errorText(cause));
    }
  };

  const connect = async () => {
    const dela = window.dela;
    if (!dela || working) return;
    const problem = hostProblem();
    if (problem) {
      setError(problem);
      return;
    }
    setWork('connect');
    setError(null);
    setPrepared(null);
    setSetupLog([]);
    try {
      const draft = draftOf();
      const result = await dela.remotes.prepare(draft);
      setPrepared(result);
      // 探测成功才落库：已存在的连接不重复保存，新连接取回 id 供浏览与登记使用。
      if (result.ok && !connectionId) setConnectionId((await dela.remotes.save(draft)).id);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setWork(null);
    }
  };

  const loadDirectory = async (path: string | null) => {
    const dela = window.dela;
    if (!dela || working) return;
    setWork('browse');
    setError(null);
    try {
      const result = await dela.remotes.browse(draftOf(), path);
      setBrowse(result);
      // home 只在从主目录起步的那次返回；翻页沿用首次结果。
      if (result.home) setHome(result.home);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setWork(null);
    }
  };

  const openDirectoryPicker = () => {
    setStep(3);
    if (!browse) void loadDirectory(null);
  };

  const importProject = async () => {
    const dela = window.dela;
    if (!dela || working || !connectionId || !browse) return;
    setWork('import');
    setError(null);
    try {
      const created = await dela.workspace.importRemoteProject(connectionId, browse.path);
      await useWorkspaceStore.getState().refresh();
      // 同一远端目录重复导入会复用原来那条项目行，它可能还带着「移除项目入口」的隐藏偏好。
      unhideProjectInNav(created.id);
      onImported(created);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setWork(null);
    }
  };

  const submitStep = (event: FormEvent) => {
    event.preventDefault();
    if (working) return;
    if (step === 1) {
      const problem = hostProblem();
      if (problem) {
        setError(problem);
        return;
      }
      setError(null);
      setStep(2);
      return;
    }
    if (step === 2) {
      // 已连上且已拿到连接 id 才前进；否则本按钮就是「连接」。
      if (prepared?.ok && connectionId) openDirectoryPicker();
      else void connect();
      return;
    }
    if (step === 3) void importProject();
  };

  const primaryLabel =
    work === 'connect'
      ? '连接中…'
      : work === 'browse'
        ? '读取中…'
        : work === 'import'
          ? '添加中…'
          : step === 1
            ? '下一步'
            : step === 2
              ? prepared?.ok && connectionId
                ? '下一步：选择目录'
                : '连接'
              : '添加为项目';

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!value && !working) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlay} />
        <Dialog.Content
          className={cn(dialogPanel, 'max-w-2xl p-0 md:grid md:grid-cols-[10.5rem_1fr]')}
        >
          <div className="grid content-start gap-3 border-b border-line p-4 md:border-b-0 md:border-r">
            <div className="grid gap-1">
              <Dialog.Title className="text-13 font-semibold">连接远程目录</Dialog.Title>
              <Dialog.Description className="text-xs leading-relaxed text-ink-3">
                经 SSH 使用远端主机上的目录，文件不复制到本机。
              </Dialog.Description>
            </div>
            <ol className="grid gap-1">
              {steps.map((title, index) => (
                <li
                  aria-current={index === step ? 'step' : undefined}
                  className={cn(
                    'flex items-center gap-2 rounded-control px-2 py-1.5 text-xs',
                    index === step ? 'bg-hover-2 font-medium text-ink' : 'text-ink-3',
                  )}
                  key={title}
                >
                  {index < step ? (
                    <Check className="size-3.5 shrink-0" aria-hidden="true" />
                  ) : (
                    <span className="grid size-4 shrink-0 place-items-center rounded-full border border-line-strong text-10 tabular-nums">
                      {index + 1}
                    </span>
                  )}
                  <span className="truncate">{title}</span>
                </li>
              ))}
            </ol>
          </div>
          <form className="grid min-h-0 gap-4 p-5" onSubmit={submitStep}>
            <div className="grid min-h-0 content-start gap-3">
              {step === 0 &&
                (connections === null ? (
                  <p className="text-xs text-ink-3" role="status">
                    正在读取已保存的连接…
                  </p>
                ) : (
                  <>
                    {connections.length === 0 ? (
                      <p className="text-xs text-ink-3">还没有已保存的连接。</p>
                    ) : (
                      <ul className="grid gap-1">
                        {connections.map((connection) => (
                          <li key={connection.id}>
                            <button
                              className="flex w-full min-w-0 items-center gap-2.5 rounded-control border border-line px-3 py-2 text-left transition-colors duration-150 hover:bg-hover"
                              onClick={() => chooseConnection(connection)}
                              type="button"
                            >
                              <Server className="size-4 shrink-0 text-ink-3" strokeWidth={1.8} />
                              <span className="grid min-w-0">
                                <span className="truncate text-13 text-ink">
                                  {connection.label}
                                </span>
                                <span className="truncate text-xs text-ink-3">
                                  {connection.host}
                                  {connection.port === null ? '' : `:${connection.port}`}
                                </span>
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <Button onClick={startNewConnection} type="button" variant="secondary">
                      <Plus />
                      新建连接
                    </Button>
                  </>
                ))}
              {step === 1 && (
                <>
                  <label className="grid gap-2 text-13">
                    名称
                    <Input
                      aria-label="连接名称"
                      autoComplete="off"
                      autoFocus
                      onChange={(event) => setLabel(event.target.value)}
                      placeholder="可选，默认用目的地"
                      value={label}
                    />
                  </label>
                  <label className="grid gap-2 text-13">
                    SSH 目的地
                    <Input
                      aria-label="SSH 目的地"
                      autoComplete="off"
                      onChange={(event) => setHost(event.target.value)}
                      placeholder="user@10.0.0.5 或 ~/.ssh/config 里的别名"
                      value={host}
                    />
                  </label>
                  <label className="grid gap-2 text-13">
                    端口
                    <Input
                      aria-label="SSH 端口"
                      autoComplete="off"
                      inputMode="numeric"
                      onChange={(event) => setPort(event.target.value)}
                      placeholder="留空使用默认 22"
                      value={port}
                    />
                  </label>
                  <label className="grid gap-2 text-13">
                    私钥文件
                    <div className="flex items-center gap-2">
                      <Input
                        aria-label="私钥文件"
                        autoComplete="off"
                        onChange={(event) => setKeyPath(event.target.value)}
                        placeholder="留空由 ssh 按 config 与 agent 解析"
                        value={keyPath}
                      />
                      {/* 手输仍然保留：路径可能不在本机，或来自 ssh config 里的写法。 */}
                      <Button
                        onClick={() => void pickKey()}
                        size="sm"
                        type="button"
                        variant="secondary"
                      >
                        选择…
                      </Button>
                    </div>
                  </label>
                  {/* 不提供密码输入：Dela 只支持密钥与 ssh agent，放一个点了没用的控件更糟。 */}
                  <p className="text-xs leading-relaxed text-ink-3">
                    暂不支持密码登录：请使用密钥或 ssh agent，或在 ~/.ssh/config
                    中为该主机配置好认证。
                  </p>
                </>
              )}
              {step === 2 && (
                <>
                  <div className="flex min-w-0 items-baseline gap-2 text-xs">
                    <span className="shrink-0 text-ink-3">目的地</span>
                    <code
                      className="min-w-0 truncate font-mono text-ink-2"
                      title={`${host.trim()}${port.trim() ? `:${port.trim()}` : ''}`}
                    >
                      {host.trim()}
                      {port.trim() ? `:${port.trim()}` : ''}
                    </code>
                  </div>
                  <div
                    className="grid h-48 content-start gap-0.5 overflow-y-auto rounded-card border border-line bg-field px-3 py-2 font-mono text-xs leading-[1.7]"
                    ref={logRef}
                    role="log"
                  >
                    {setupLog.length === 0 ? (
                      <p className="text-ink-3">
                        点「连接」后在这里依次报告：探测 → 上传 → 校验 → 启动 → 隧道 →
                        握手。第一次连接会把远端工具服务传到服务器上，之后按校验和命中缓存跳过上传。
                      </p>
                    ) : (
                      setupLog.map((progress, index) => (
                        <SetupLine key={`${index}-${progress.step}`} progress={progress} />
                      ))
                    )}
                  </div>
                </>
              )}
              {step === 3 && (
                <>
                  <div className="flex items-center gap-2">
                    <Button
                      disabled={working || !browse?.parent}
                      onClick={() => void loadDirectory(browse?.parent ?? null)}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      <ArrowUp />
                      上一级
                    </Button>
                    <Button
                      disabled={working || !home}
                      onClick={() => void loadDirectory(home)}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      <House />
                      主目录
                    </Button>
                    <span
                      className="min-w-0 flex-1 truncate text-right text-xs text-ink-3"
                      title={browse?.path}
                    >
                      {browse?.path ?? '正在读取主目录…'}
                    </span>
                  </div>
                  <ul className="max-h-64 overflow-y-auto rounded-card border border-line">
                    {browse?.directories.map((entry) => (
                      <li key={entry.path}>
                        <button
                          className="flex h-8 w-full min-w-0 items-center gap-2 px-3 text-left text-13 text-ink-2 transition-colors duration-150 hover:bg-hover hover:text-ink disabled:opacity-50"
                          disabled={working}
                          onClick={() => void loadDirectory(entry.path)}
                          title={entry.path}
                          type="button"
                        >
                          <Folder className="size-4 shrink-0 text-ink-3" strokeWidth={1.8} />
                          <span className="truncate">{entry.name}</span>
                        </button>
                      </li>
                    ))}
                    {browse && browse.directories.length === 0 && (
                      <li className="px-3 py-2 text-xs text-ink-3">此目录下没有子目录。</li>
                    )}
                  </ul>
                  <p className="text-xs text-ink-3">项目目录为当前路径；远端文件不会复制到本机。</p>
                </>
              )}
              {error && (
                <p className="text-xs [overflow-wrap:anywhere] text-red" role="alert">
                  {error}
                </p>
              )}
            </div>
            <div className="flex items-center justify-between gap-2">
              <div>
                {step > 0 && (
                  <Button
                    disabled={working}
                    onClick={() => setStep(step - 1)}
                    type="button"
                    variant="ghost"
                  >
                    <ArrowLeft />
                    上一步
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button disabled={working} onClick={onClose} type="button" variant="ghost">
                  取消
                </Button>
                {step > 0 && (
                  <Button disabled={working} type="submit">
                    {working && <Loader2 className="animate-spin" />}
                    {primaryLabel}
                  </Button>
                )}
              </div>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
