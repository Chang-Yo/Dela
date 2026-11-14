// 课表：从教学信息网同步个人课表；日历事件的读写暂时也在这里。
import { defineModule } from '../../app/module';
import { registerCommandDomain } from '../../core/capabilities/commands';
import { timetableDomain } from './main/agent';
import { registerTimetableIpc } from './main/ipc';

export const timetableModule = defineModule({
  id: 'timetable',
  register() {
    registerTimetableIpc();
    registerCommandDomain(timetableDomain);
  },
});
