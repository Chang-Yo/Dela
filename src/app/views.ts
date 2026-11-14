// 渲染端清单：外壳据此渲染模块的页面（docs/adr/0019）；去掉一行，对应页面随之消失。
import type { ComponentType } from 'react';
import type { NavTarget, ViewDefinition } from './module';
import { todoView } from '../modules/todo/view';

export const views: ViewDefinition[] = [todoView];

/** 页面的参数类型因页而异，按 target.page 取出的定义与 target 必然匹配，这里统一放宽。 */
interface AnyPage {
  component: ComponentType<{ target: NavTarget }>;
  open?(target: NavTarget): void;
}

const pages = new Map(
  views.flatMap((view) => Object.entries(view.pages) as Array<[string, AnyPage]>),
);

export function pageOf(page: string): AnyPage | undefined {
  return pages.get(page);
}
