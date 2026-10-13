export interface TerminalSession {
  id: string;
  title: string;
  buffer: string;
  sequence: number;
  exitCode: number | null;
}

export type TerminalEvent =
  | { type: 'data'; projectId: string; id: string; sequence: number; data: string }
  | { type: 'exit'; projectId: string; id: string; sequence: number; exitCode: number };

/** MinGit 一键安装的阶段。渲染层只做「阶段 → 文案 + 可用动作」的映射。 */
export type BashInstallPhase = 'idle' | 'downloading' | 'extracting' | 'done' | 'error';

export interface BashInstallSnapshot {
  phase: BashInstallPhase;
  /** 已下载字节数与总量；只有 downloading 阶段有意义。 */
  received: number;
  total: number;
  /** 失败原因；只有 error 阶段非空。 */
  error: string | null;
}

export interface BashStatus {
  found: boolean;
  install: BashInstallSnapshot;
}

export interface TerminalApi {
  list(projectId: string): Promise<TerminalSession[]>;
  create(projectId: string, id: string): Promise<TerminalSession>;
  write(id: string, data: string): Promise<void>;
  resize(id: string, cols: number, rows: number): Promise<void>;
  close(id: string): Promise<void>;
  closeProject(projectId: string): Promise<void>;
  /** 系统 Git Bash 与 MinGit 运行时的探测结果，附最近一次安装状态。 */
  bashStatus(): Promise<BashStatus>;
  /** 一键安装 MinGit 运行时；进度经 onBashInstall 推送，失败时 reject。 */
  installBash(): Promise<BashStatus>;
  cancelBashInstall(): Promise<void>;
  onBashInstall(listener: (snapshot: BashInstallSnapshot) => void): () => void;
  onEvent(listener: (event: TerminalEvent) => void): () => void;
}
