// 表结构清单（0025）：宿主据此建表与迁移。只引用各模块的 data/schema.ts，测试与冒烟不必载入模块代码。
import type { Schema } from '../core/ports';
import { coreSchema } from '../core/data/schema';
import { mailSchema } from '../modules/mail/data/schema';
import { notificationsSchema } from '../modules/notifications/data/schema';
import { remotesSchema } from '../modules/remotes/data/schema';
import { settingsSchema } from '../modules/settings/data/schema';
import { todoSchema } from '../modules/todo/data/schema';
import { workspaceSchema } from '../modules/workspace/data/schema';
import { canvasSchema } from '../sjtu/canvas/data/schema';
import { shuiyuanSchema } from '../sjtu/shuiyuan/data/schema';
import { timetableSchema } from '../sjtu/timetable/data/schema';

export const schemas: Schema[] = [
  coreSchema,
  remotesSchema,
  workspaceSchema,
  mailSchema,
  notificationsSchema,
  todoSchema,
  settingsSchema,
  canvasSchema,
  shuiyuanSchema,
  timetableSchema,
];
