// 模块与 app 之间唯一的中立文件：模块用它声明自己，app 读取这些声明。
import type { Implementation } from '../core/protocol/contract';

/**
 * 可跳转的页面及其参数。页面所属的模块用接口合并登记自己的一项，例如
 * `declare module '../../app/module' { interface NavTargets { mail: { messageId: number } } }`。
 */
export interface NavTargets {}

export type NavTarget = {
  [Page in keyof NavTargets]: { page: Page } & NavTargets[Page];
}[keyof NavTargets];

export interface ModuleDefinition {
  id: string;
  /** 模块内部契约的主进程实现，由 app 注册到 IPC。 */
  ipc?: Implementation;
}

export function defineModule(definition: ModuleDefinition): ModuleDefinition {
  return definition;
}
