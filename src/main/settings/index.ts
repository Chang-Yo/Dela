// 设置域组装入口：main/index.ts 只经此处取得设置通道注册与启动期偏好读取。
export { registerSettingsIpc } from './ipc';
export { readSetting, savedTheme, savedIcon, savedZoom } from './prefs';
export { applyTheme } from './ipc';
