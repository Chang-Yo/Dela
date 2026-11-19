// 通用会话的辅助目录：模块登记自己的资料目录，系统提示把它们列给 Agent。
export interface ContextDirectory {
  id: string;
  label: string;
  directory(): string;
}

const directories = new Map<string, ContextDirectory>();

export function registerContextDirectory(directory: ContextDirectory): void {
  directories.set(directory.id, directory);
}

export function contextDirectories(): ContextDirectory[] {
  return [...directories.values()];
}
