// Canvas：课程资料、作业（注册为待办来源）与课程公告；课程目录登记为通用会话的辅助目录。
import { defineModule } from '../../app/module';
import { registerCommandDomain } from '../../core/capabilities/commands';
import { registerContextDirectory } from '../../core/agent/context-directories';
import { registerSecretLabel } from '../../core/ports';
import { implement } from '../../core/protocol/contract';
import { registerNoticeSource } from '../../modules/notifications';
import { registerPreviewHost, registerWorkspaceSource } from '../../modules/workspace';
import { registerSearchProvider } from '../../modules/search';
import { registerTaskSource } from '../../modules/todo';
import { canvasContract } from './contract';
import {
  connectCanvas,
  disconnectCanvas,
  downloadSource,
  exportCourseFiles,
  openCanvasLink,
  refreshCanvasTrees,
  revealSource,
} from './main/actions';
import { canvasDomain } from './main/agent';
import {
  archiveCanvasCourse,
  cachedCourseFiles,
  coursesDirectory,
  getCanvasState,
  syncCanvasCourse,
  syncCanvasCourses,
} from './main/api';
import { canvasNoticeSource } from './main/notice-source';
import { canvasWorkspaceSource, handleCanvasPreviewRequest } from './main/resources';
import { courseFileSearch } from './main/search';
import { canvasTaskSource } from './main/todo-source';

// 课件目录树只拉清单不下载文件，每小时同步一次足够。
const TREE_REFRESH_MS = 60 * 60_000;

function syncTrees() {
  void refreshCanvasTrees().catch((error: unknown) =>
    console.error('Canvas tree sync failed', error),
  );
}

export const canvasModule = defineModule({
  id: 'canvas',
  ipc: implement(canvasContract, {
    state: getCanvasState,
    connect: connectCanvas,
    disconnect: disconnectCanvas,
    syncCourses: syncCanvasCourses,
    syncCourse: syncCanvasCourse,
    archiveCourse: ({ id, archived }) => archiveCanvasCourse(id, archived),
    download: downloadSource,
    reveal: revealSource,
    cachedFiles: cachedCourseFiles,
    exportCourseFiles,
  }),
  register() {
    registerSecretLabel('canvas-token', 'Canvas 凭据');
    registerCommandDomain(canvasDomain);
    registerContextDirectory({ id: 'canvas', label: 'Canvas 课件', directory: coursesDirectory });
    registerSearchProvider(courseFileSearch);
    registerTaskSource(canvasTaskSource);
    registerNoticeSource(canvasNoticeSource);
    registerWorkspaceSource(canvasWorkspaceSource);
    registerPreviewHost('canvas', handleCanvasPreviewRequest);
  },
  start() {
    syncTrees();
    const timer = setInterval(syncTrees, TREE_REFRESH_MS);
    return () => clearInterval(timer);
  },
  openLink: openCanvasLink,
});

export { classroomLoginUrl } from './main/api';
export { loadCanvasToken } from './main/credentials';
