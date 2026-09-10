export interface WindowState {
  readonly maximized: boolean;
}

export interface WindowApi {
  minimize(): void;
  toggleMaximize(): void;
  close(): void;
  getState(): Promise<WindowState>;
  onStateChange(listener: (state: WindowState) => void): () => void;
}

export interface DelaApi {
  readonly version: string;
  readonly window: WindowApi;
}
