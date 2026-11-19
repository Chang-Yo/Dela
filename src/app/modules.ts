// 模块清单：主进程据此注册各模块的 IPC 与后台任务。
import type { ModuleDefinition } from './module';
import { chatModule } from '../modules/chat';
import { mailModule } from '../modules/mail';
import { notificationsModule } from '../modules/notifications';
import { onboardingModule } from '../modules/onboarding';
import { previewModule } from '../modules/preview';
import { remotesModule } from '../modules/remotes';
import { searchModule } from '../modules/search';
import { settingsModule } from '../modules/settings';
import { terminalModule } from '../modules/terminal';
import { todoModule } from '../modules/todo';
import { updateModule } from '../modules/update';
import { workspaceModule } from '../modules/workspace';
import { canvasModule } from '../sjtu/canvas';
import { classroomModule } from '../sjtu/classroom';
import { jwcModule } from '../sjtu/jwc';
import { shuiyuanModule } from '../sjtu/shuiyuan';
import { timetableModule } from '../sjtu/timetable';

export const modules: ModuleDefinition[] = [
  workspaceModule,
  previewModule,
  remotesModule,
  terminalModule,
  chatModule,
  mailModule,
  settingsModule,
  updateModule,
  onboardingModule,
  searchModule,
  todoModule,
  notificationsModule,
  canvasModule,
  shuiyuanModule,
  classroomModule,
  timetableModule,
  jwcModule,
];
