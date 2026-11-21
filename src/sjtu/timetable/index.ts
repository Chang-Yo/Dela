// 课表：从教学信息网同步个人课表，只读；个人安排归待办（ADR 0024）。
import type { WebContents } from 'electron';
import { defineModule } from '../../app/module';
import { registerCommandDomain } from '../../core/capabilities/commands';
import { hostPorts } from '../../core/ports';
import { implement } from '../../core/protocol/contract';
import { registerSettingsSearch } from '../../modules/settings';
import { timetableContract } from './contract';
import { timetableDomain } from './main/agent';
import {
  currentSemester,
  getTimetableState,
  listLessons,
  openLoginWindow,
  setSemesterStart,
  syncTimetable,
} from './main/api';

export const timetableModule = defineModule({
  id: 'timetable',
  ipc: implement(timetableContract, {
    state: getTimetableState,
    lessons: (semester = currentSemester()) => listLessons(semester),
    setSemesterStart: ({ semester, value }) => setSemesterStart(semester, value),
    sync: (semester = currentSemester()) => syncTimetable(semester),
    // 契约调用只来自工作区窗口，登录窗以它为父窗口。
    connect: () => openLoginWindow(hostPorts().workspaceClient() as WebContents),
  }),
  register() {
    registerSettingsSearch({
      id: 'timetable',
      section: 'connections',
      title: '教学信息服务网',
      keywords: ['连接', '教务', '课表', 'timetable', '课程表', 'jaccount'],
    });
    registerCommandDomain(timetableDomain);
  },
});
