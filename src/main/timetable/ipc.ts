import {
  setSemesterStart,
  getTimetableState,
  semesterSchema,
  currentSemester,
  openLoginWindow,
  syncTimetable,
  listLessons,
  listCalendarEvents,
  createCalendarEvent,
} from './api';
import { ipcMain } from 'electron';
import { clearCampusSession } from './session';
import { type TimetableResult } from '../../shared/api';

export function registerTimetableIpc(): void {
  ipcMain.handle('timetable:get-state', async (_event, requested?: unknown) =>
    getTimetableState(requested),
  );
  ipcMain.handle('timetable:connect', (event) => openLoginWindow(event.sender));
  ipcMain.handle('timetable:disconnect', async (): Promise<TimetableResult> => {
    await clearCampusSession();
    return { ok: true };
  });
  ipcMain.handle('timetable:list-lessons', (_event, requested?: unknown) => {
    const semester = requested === undefined ? currentSemester() : semesterSchema.parse(requested);
    return listLessons(semester);
  });
  ipcMain.handle('timetable:list-events', (_event, startValue: unknown, endValue: unknown) =>
    listCalendarEvents(startValue, endValue),
  );
  ipcMain.handle('timetable:create-event', (_event, input: unknown) => createCalendarEvent(input));
  ipcMain.handle('timetable:set-semester-start', (_event, requested?: unknown, value?: unknown) =>
    setSemesterStart(requested, value),
  );
  ipcMain.handle('timetable:sync', (_event, requested?: unknown) => {
    const semester = requested === undefined ? currentSemester() : semesterSchema.parse(requested);
    return syncTimetable(semester);
  });
}
