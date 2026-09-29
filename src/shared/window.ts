export interface WindowState {
  readonly maximized: boolean;
}

export type TrayAction = 'new-chat' | 'new-project';

export interface WindowApi {
  minimize(): void;
  toggleMaximize(): void;
  close(): void;
  getState(): Promise<WindowState>;
  onStateChange(listener: (state: WindowState) => void): () => void;
  onTrayAction(listener: (action: TrayAction) => void): () => void;
}
