import type { Bridge } from '../core/protocol/contract';

export interface DelaApi {
  /** 已迁入 modules/ 的模块经契约客户端调用主进程，见 core/protocol/contract。 */
  readonly bridge: Bridge;
  readonly platform: string;
  /** 拖进窗口的文件在本机磁盘上的路径；没有本地路径时为空字符串。 */
  pathForFile(file: File): string;
  readonly version: string;
  /** NSIS 更新安装完成后启动，供界面提示实际运行的版本。 */
  readonly updatedOnLaunch: boolean;
  readonly window: WindowApi;
}

export interface WindowState {
  readonly maximized: boolean;
}

export type TrayAction = 'new-chat' | 'new-project' | 'open-settings';

export interface WindowApi {
  minimize(): void;
  toggleMaximize(): void;
  close(): void;
  /** 真正退出应用；close() 只是收进托盘，托盘常驻时后台任务照跑。 */
  quit(): void;
  getState(): Promise<WindowState>;
  onStateChange(listener: (state: WindowState) => void): () => void;
  onTrayAction(listener: (action: TrayAction) => void): () => void;
}
