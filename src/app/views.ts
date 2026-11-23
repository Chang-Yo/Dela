// 渲染端清单：外壳据此渲染模块的页面；去掉一行，对应页面随之消失。
import type { QueryClient } from '@tanstack/react-query';
import type { ComponentType } from 'react';
import type {
  NavTarget,
  NavTargets,
  Navigate,
  PageDefinition,
  PageDrawer,
  SourceDefinition,
  ViewDefinition,
} from './module';
import { mailView } from '../modules/mail/view';
import { notificationsView } from '../modules/notifications/view';
import { todoView } from '../modules/todo/view';
import { updateView } from '../modules/update/view';
import { canvasView } from '../sjtu/canvas/view';
import { classroomView } from '../sjtu/classroom/view';
import { jwcView } from '../sjtu/jwc/view';
import { sjtuMailView } from '../sjtu/mail/view';
import { shuiyuanView } from '../sjtu/shuiyuan/view';
import { timetableView } from '../sjtu/timetable/view';

const moduleViews = [
  mailView,
  sjtuMailView,
  todoView,
  timetableView,
  classroomView,
  shuiyuanView,
  canvasView,
  jwcView,
];

export const views: ViewDefinition[] = [
  ...moduleViews,
  notificationsView(Object.assign({}, ...moduleViews.map((view) => view.notices))),
  updateView,
];

/** 页面的参数类型因页而异，按 target.page 取出的定义与 target 必然匹配，这里统一放宽。 */
interface AnyPage {
  component: ComponentType<{ target: NavTarget; navigate: Navigate; drawer: PageDrawer | null }>;
  drawer?: boolean;
  open?(target: NavTarget): void;
}

const pageEntries = views.flatMap(
  (view) =>
    Object.entries(view.pages) as Array<[keyof NavTargets, PageDefinition<keyof NavTargets>]>,
);
const pageById = new Map(pageEntries as Array<[string, AnyPage]>);

export const pages = {
  of: (page: string) => pageById.get(page),
  nav: pageEntries.flatMap(([id, page]) => (page.nav ? [{ id, ...page.nav }] : [])),
};

const sourceList = views.flatMap((view) => view.sources ?? []);
for (const a of sourceList) {
  const overlapping = sourceList.find((b) => a !== b && a.prefix.startsWith(b.prefix));
  if (overlapping)
    throw new Error(`资料前缀 ${a.prefix} 与 ${overlapping.prefix} 重叠，sourceId 无法确定归属`);
}

export const sources = {
  of: (sourceId: string): SourceDefinition | undefined =>
    sourceList.find((source) => sourceId.startsWith(source.prefix)),
  title: (sourceId: string, client: QueryClient) => sources.of(sourceId)?.title?.(sourceId, client),
  /** 预览正文里指向已同步资料的链接，换成它的 sourceId。 */
  fromLink: (url: string, client: QueryClient) =>
    sourceList.map((source) => source.fromLink?.(url, client)).find((id) => id !== undefined),
  libraries: sourceList.flatMap((source) => source.library ?? []),
  references: sourceList.flatMap((source) => source.references ?? []),
};

export const chatReplyActions = views.flatMap((view) => view.chatReplyActions ?? []);

export function opensInApp(url: string): boolean {
  return views.some((view) => view.opensLink?.(url));
}
