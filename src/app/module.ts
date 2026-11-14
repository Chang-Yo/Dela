// 模块与 app 之间唯一的中立文件：模块用它声明主进程与界面两侧，app 读取这些声明。
import type { Implementation } from '../core/protocol/contract';
import type { ComponentType } from 'react';

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
  /** 应用就绪后、窗口创建前调用：登记 IPC、命令域与各类注册口。冒烟测试同样调用。 */
  register?(): void;
  /** 应用就绪后调用：启动后台同步；返回值在退出时调用。冒烟测试不调用。 */
  start?(): (() => void) | void;
  /** 主窗口要打开外部链接时依次询问；返回 true 表示模块已在应用内处理。 */
  openLink?(url: string): boolean;
}

export function defineModule(definition: ModuleDefinition): ModuleDefinition {
  return definition;
}

/** 模块的一个页面：组件收到跳转参数 target，每次跳转都是新对象，可据此重置本地状态。 */
export interface PageDefinition<Page extends keyof NavTargets> {
  component: ComponentType<{ target: NavTargets[Page] }>;
  /** navigate 跳到此页时调用，承载随跳转发生的副作用，例如标记已读；后退与前进不调用。 */
  open?(target: NavTargets[Page]): void;
}

/** 模块的界面侧定义，由 app/views.ts 列入渲染端清单。 */
export interface ViewDefinition {
  pages: { [Page in keyof NavTargets]?: PageDefinition<Page> };
}

export function defineView(definition: ViewDefinition): ViewDefinition {
  return definition;
}
