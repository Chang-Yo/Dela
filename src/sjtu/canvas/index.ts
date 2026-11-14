// Canvas：课程资料、作业（注册为待办来源）与课程公告；资料库会话共用课程目录。
import { defineModule } from '../../app/module';
import { registerCommandDomain } from '../../core/capabilities/commands';
import { registerResourceResolver } from '../../core/capabilities/resources';
import { registerSessionScope } from '../../core/agent/scopes';
import { registerSecretLabel } from '../../core/ports';
import { registerNoticeSource } from '../../main/notifications';
import { registerPreviewHost } from '../../main/workspace/preview';
import { registerWorkspaceSource } from '../../main/workspace/sources';
import { registerSearchProvider } from '../../modules/search';
import { registerTaskSource } from '../../modules/todo';
import { canvasDomain } from './main/agent';
import { coursesDirectory } from './main/api';
import { refreshCanvasTrees, registerCanvasIpc } from './main/ipc';
import { canvasNoticeSource } from './main/notice-source';
import {
  canvasResourceResolver,
  canvasWorkspaceSource,
  handleCanvasPreviewRequest,
} from './main/resources';
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
  register() {
    registerSecretLabel('canvas-token', 'Canvas 凭据');
    registerCanvasIpc();
    registerCommandDomain(canvasDomain);
    registerSessionScope({ id: 'library', directory: coursesDirectory });
    registerSearchProvider(courseFileSearch);
    registerTaskSource(canvasTaskSource);
    registerNoticeSource(canvasNoticeSource);
    registerWorkspaceSource(canvasWorkspaceSource);
    registerResourceResolver('canvas', canvasResourceResolver);
    registerPreviewHost('canvas', handleCanvasPreviewRequest);
  },
  start() {
    syncTrees();
    const timer = setInterval(syncTrees, TREE_REFRESH_MS);
    return () => clearInterval(timer);
  },
});
