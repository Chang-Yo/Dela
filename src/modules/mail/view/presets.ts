import type { MailServerConfig } from '../contract';

/** 常用邮箱的服务器预设：连接表单据此免填服务器，并核对地址后缀。 */
export interface MailPreset {
  readonly label: string;
  readonly domain: string;
  readonly server: MailServerConfig;
  readonly passwordHint: string;
}

const presets: MailPreset[] = [];

/** 在渲染端启动时（视图的 start）登记，表单首次渲染前已就绪。 */
export function registerMailPreset(preset: MailPreset): void {
  presets.push(preset);
}

export function mailPresets(): readonly MailPreset[] {
  return presets;
}
