// 模块与 app 之间唯一的中立文件：模块用它声明主进程与界面两侧，app 读取这些声明。
import type { Implementation } from '../core/protocol/contract';
import type { QueryClient } from '@tanstack/react-query';
import type { ComponentType } from 'react';
import type { DocumentContent, TabId } from '../modules/workspace/contract';

export type { TabId };

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

/** 唯一的跳转动作；被拦下（例如写信未保存）或页面未启用时返回 false。 */
export type Navigate = (target: NavTarget) => boolean;

/** 工作台端口（0020）：标签落在哪个组、是否预览由外壳的 open-target 决定。 */
export interface Workbench {
  /** aside 放到焦点组右侧，必要时分屏。 */
  open(tab: TabId, options?: { aside?: boolean }): void;
  /** 文档 key（条目、来源、远端节点、绝对路径）由外壳换成笔记或预览标签。 */
  openDocument(key: string, options?: { aside?: boolean }): void;
  /** 在所有组里关闭该标签，例如会话归档后。 */
  close(tab: TabId): void;
}

/** 窄屏页面抽屉：容器由外壳提供，页面往里渲染内容，选定后调用 close 收起。 */
export interface PageDrawer {
  container: HTMLElement;
  close(): void;
}

/** 模块的一个页面：组件收到跳转参数 target，每次跳转都是新对象，可据此重置本地状态。 */
export interface PageDefinition<Page extends keyof NavTargets> {
  component: ComponentType<{
    target: NavTargets[Page];
    navigate: Navigate;
    drawer: PageDrawer | null;
  }>;
  /** 窄屏下本页有自己的抽屉，由外壳在主导航位置渲染挂载点。 */
  drawer?: boolean;
  /** 侧栏入口，顺序为清单顺序；带入口的页面须能不带参数打开。 */
  nav?: { label: string; icon: ComponentType<{ className?: string; strokeWidth?: number }> };
  /** navigate 跳到此页时调用，承载随跳转发生的副作用，例如标记已读；后退与前进不调用。 */
  open?(target: NavTargets[Page]): void;
}

/** 模块的界面侧定义，由 app/views.ts 列入渲染端清单。 */
export interface ViewDefinition {
  pages: { [Page in keyof NavTargets]?: PageDefinition<Page> };
  /** 本模块通知来源的名称与图标，键为来源 id。 */
  notices?: Record<string, NoticeKind>;
  /** 渲染端启动时调用一次，承载常驻的订阅，例如系统通知被点击后的跳转。 */
  start?(navigate: Navigate): void;
  /** 设置页各分区里属于本模块的行，按清单顺序汇总。 */
  settings?: {
    credentials?: ComponentType<{ navigate: Navigate }>;
    storage?: ComponentType;
  };
  /** 首启向导中本模块的一步，完成或跳过后调用 onDone。 */
  onboarding?: ComponentType<{ onDone: () => void }>;
  /** 本模块的资料。 */
  sources?: SourceDefinition;
  /** 每次跳转前调用；要先确认（例如写信未保存）时返回 false，确认后由本模块调用 proceed 重试。 */
  leaveGuard?(proceed: () => void): boolean;
  /** 本模块会在应用内打开的链接，聊天里点击时免去外链确认。 */
  opensLink?(url: string): boolean;
}

export interface LibraryProps {
  archived: boolean;
  query: string;
  expanded: string[];
  onExpand(id: string, open: boolean): void;
  /** 当前标签的 key（source:<sourceId>）。 */
  selected: string | null;
  onOpen(key: string): void;
  onOpenToSide(key: string): void;
  onLink(key: string): void;
  /** 有资料移入归档后调用，展开归档区。 */
  onArchive(): void;
}

/** sourceId 以 prefix 开头的资料都归本模块；前缀与主进程登记的相同，不同模块之间不能重叠。 */
export interface SourceDefinition {
  prefix: string;
  /** 项目快捷方式在文件树里的图标与角标。 */
  icon?: ComponentType<{ className?: string; strokeWidth?: number }>;
  badge?: ComponentType<{ sourceId: string }>;
  /** 预览标签里的正文；不提供时按内容格式通用预览。 */
  document?: ComponentType<SourceDocumentProps>;
  /** 标签页与「添加到项目」用的资料名；资料尚未同步时返回 undefined。 */
  title?(sourceId: string, client: QueryClient): string | undefined;
  /** 预览正文里的链接若指向已同步的资料，返回它的 sourceId，改在标签页打开。 */
  fromLink?(url: string, client: QueryClient): string | undefined;
  /** 资料页（通用工作台）里本模块的一组资料；归档区以 archived 再渲染一次。 */
  library?: ComponentType<LibraryProps>;
  /** 通用池会话的 @ 引用候选：path 为本地绝对路径，title 为展示路径。 */
  references?: {
    queryKey: readonly unknown[];
    queryFn: () => Promise<Array<{ path: string; title: string }>>;
  };
}

export interface SourceDocumentProps {
  sourceId: string;
  content: DocumentContent;
  navigate: Navigate;
  onReload: () => void;
}

export interface NoticeKind {
  label: string;
  icon: ComponentType<{ className?: string }>;
}

export function defineView(definition: ViewDefinition): ViewDefinition {
  return definition;
}
