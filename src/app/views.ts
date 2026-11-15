// 渲染端清单：外壳据此渲染模块的页面（docs/adr/0019）；去掉一行，对应页面随之消失。
import type { QueryClient } from '@tanstack/react-query';
import type { ComponentType } from 'react';
import type {
  NavTarget,
  NavTargets,
  Navigate,
  PageDefinition,
  SourceDefinition,
  ViewDefinition,
} from './module';
import type { ResourceRef } from '../modules/workspace/contract';
import { mailView } from '../modules/mail/view';
import { notificationsView } from '../modules/notifications/view';
import { todoView } from '../modules/todo/view';
import { updateView } from '../modules/update/view';
import { canvasView } from '../sjtu/canvas/view';
import { classroomView } from '../sjtu/classroom/view';
import { jwcView } from '../sjtu/jwc/view';
import { shuiyuanView } from '../sjtu/shuiyuan/view';
import { timetableView } from '../sjtu/timetable/view';

const moduleViews = [
  mailView,
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
  component: ComponentType<{ target: NavTarget; navigate: Navigate }>;
  open?(target: NavTarget): void;
}

const pages = new Map(
  views.flatMap((view) => Object.entries(view.pages) as Array<[string, AnyPage]>),
);

export const navPages = views.flatMap((view) =>
  (Object.entries(view.pages) as Array<[keyof NavTargets, PageDefinition<keyof NavTargets>]>)
    .filter(([, page]) => page.nav)
    .map(([id, page]) => ({ id, ...page.nav! })),
);

export function pageOf(page: string): AnyPage | undefined {
  return pages.get(page);
}

export function sourceOf(sourceId: string): SourceDefinition | undefined {
  return views.find((view) => view.sources && sourceId.startsWith(view.sources.prefix))?.sources;
}

export function opensInApp(url: string): boolean {
  return views.some((view) => view.opensLink?.(url));
}

export const libraries = views.flatMap((view) => (view.library ? [view.library] : []));

export const referenceQueries = views.flatMap((view) => (view.references ? [view.references] : []));

export function sourceTitle(sourceId: string, client: QueryClient): string | undefined {
  for (const view of views) {
    const title = view.sourceTitle?.(sourceId, client);
    if (title !== undefined) return title;
  }
  return undefined;
}

export function officeRefOf(sourceId: string): ResourceRef | undefined {
  for (const view of views) {
    const ref = view.officeRef?.(sourceId);
    if (ref !== undefined) return ref;
  }
  return undefined;
}

export function sourceOfLink(url: string, client: QueryClient): string | undefined {
  for (const view of views) {
    const sourceId = view.sourceOfLink?.(url, client);
    if (sourceId !== undefined) return sourceId;
  }
  return undefined;
}
