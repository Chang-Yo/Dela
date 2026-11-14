// 课表：从教学信息网同步个人课表；日历事件的读写暂时也在这里。
import { defineModule } from '../../app/module';
import { registerCommandDomain } from '../../core/capabilities/commands';
import { implement } from '../../core/protocol/contract';
import { workspaceWindow } from '../../main/ipc';
import { timetableContract } from './contract';
import { timetableDomain } from './main/agent';
import {
  createCalendarEvent,
  currentSemester,
  deleteCalendarEvent,
  getTimetableState,
  listCalendarEvents,
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
    events: ({ startAt, endAt }) => listCalendarEvents(startAt, endAt),
    createEvent: createCalendarEvent,
    deleteEvent: deleteCalendarEvent,
    setSemesterStart: ({ semester, value }) => setSemesterStart(semester, value),
    sync: (semester = currentSemester()) => syncTimetable(semester),
    // 契约调用只来自工作区窗口，登录窗以它为父窗口。
    connect: () => openLoginWindow(workspaceWindow()!.webContents),
  }),
  register() {
    registerCommandDomain(timetableDomain);
  },
});
