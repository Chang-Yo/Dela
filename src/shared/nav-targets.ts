// 过渡期集中登记现有页面的跳转参数；页面迁入 modules/ 后，登记随页面搬进各自模块。
import type { SettingsSectionId } from './settings';

declare module '../app/module' {
  interface NavTargets {
    projects: { entryId: string };
    chat: { projectId: string | null; sessionId: string };
    mail: { messageId: number };
    sources: { sourceId: string };
    todo: { todoId: string };
    settings: { section: SettingsSectionId };
  }
}
