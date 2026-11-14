// 课堂视频回看（v.sjtu.edu.cn）：复用校园登录会话，已连接 Canvas 时可免手动登录。
import { defineModule } from '../../app/module';
import { registerCommandDomain } from '../../core/capabilities/commands';
import { registerPreviewHost } from '../../main/workspace/preview';
import { classroomDomain } from './main/agent';
import { registerVsjtuIpc } from './main/ipc';
import { handleVsjtuMediaRequest } from './main/playback';

export const classroomModule = defineModule({
  id: 'classroom',
  register() {
    registerVsjtuIpc();
    registerCommandDomain(classroomDomain);
    registerPreviewHost('vsjtu', handleVsjtuMediaRequest);
  },
});
