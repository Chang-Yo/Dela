// 由隔离的 preload 提供系统标识，窗口控件与键位提示共用。
export const platform = window.dela?.platform === 'darwin' ? 'mac' : 'other';
export const fileManagerName = platform === 'mac' ? 'Finder' : '资源管理器';
