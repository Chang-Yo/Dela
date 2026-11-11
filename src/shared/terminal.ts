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

export interface TerminalApi {
  list(projectId: string): Promise<TerminalSession[]>;
  create(projectId: string, id: string): Promise<TerminalSession>;
  write(id: string, data: string): Promise<void>;
  resize(id: string, cols: number, rows: number): Promise<void>;
  close(id: string): Promise<void>;
  closeProject(projectId: string): Promise<void>;
  onEvent(listener: (event: TerminalEvent) => void): () => void;
}
