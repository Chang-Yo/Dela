// 渲染端清单：外壳据此渲染模块的页面（docs/adr/0019）；去掉一行，对应页面随之消失。
import type { ComponentType } from 'react';
import { Mail, Megaphone } from 'lucide-react';
import type {
  NavTarget,
  NavTargets,
  Navigate,
  NoticeKind,
  PageDefinition,
  SourceDefinition,
  ViewDefinition,
} from './module';
import { notificationsView } from '../modules/notifications/view';
import { todoView } from '../modules/todo/view';
import { classroomView } from '../sjtu/classroom/view';
import { jwcView } from '../sjtu/jwc/view';
import { shuiyuanView } from '../sjtu/shuiyuan/view';
import { timetableView } from '../sjtu/timetable/view';

// 邮件与 Canvas 迁入模块后，改由各自的 notices 声明。
const legacyNoticeKinds: Record<string, NoticeKind> = {
  mail: { label: '邮件', icon: Mail },
  canvas: { label: 'Canvas', icon: Megaphone },
};

const moduleViews = [todoView, timetableView, classroomView, shuiyuanView, jwcView];

export const views: ViewDefinition[] = [
  ...moduleViews,
  notificationsView(
    Object.assign({}, legacyNoticeKinds, ...moduleViews.map((view) => view.notices)),
  ),
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
