import { z } from 'zod';
import { currentSemesterInfo, isConnected, listSyncedSemesters } from '../../../timetable/api';
import { tool } from '../shared';

export const getTimetableStatusTool = tool(
  '查询课表连接与同步状态（只读；「已连接」是真实在线试探教务接口的结果，与仅检查本地凭据的领域不同）。返回按本机时钟推断的当前学期（显式标注推断依据）、已同步学期列表（同步时间与学期开始日期）。',
  z.object({}).strict(),
  async () => {
    const connected = await isConnected();
    const semesters = listSyncedSemesters();
    const current = currentSemesterInfo();
    const warnings: string[] = [];
    if (!connected) warnings.push('未登录教学信息服务网，无法同步课表；请在应用的课表设置中登录');
    for (const semester of semesters)
      if (!semester.semesterStart)
        warnings.push(
          `学期 ${semester.semester} 缺少学期开始日期，课程无法展开为具体日期；请在课表设置中补设`,
        );
    return {
      connected,
      currentSemester: current,
      semesters: semesters.map((row) => ({
        ...row,
        isCurrent: row.semester === current.semester,
      })),
      ...(warnings.length ? { warnings } : {}),
    };
  },
);
