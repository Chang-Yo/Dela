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
