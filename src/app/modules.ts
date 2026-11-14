// 模块清单：主进程据此注册各模块的 IPC 与后台任务。
import type { ModuleDefinition } from './module';
import { searchModule } from '../modules/search';
import { todoModule } from '../modules/todo';
import { canvasModule } from '../sjtu/canvas';
import { classroomModule } from '../sjtu/classroom';
import { jwcModule } from '../sjtu/jwc';
import { shuiyuanModule } from '../sjtu/shuiyuan';
import { timetableModule } from '../sjtu/timetable';

export const modules: ModuleDefinition[] = [
  searchModule,
  todoModule,
  canvasModule,
  shuiyuanModule,
  classroomModule,
  timetableModule,
  jwcModule,
];
