// 教务处通知：抓取学生通知列表，附件下载需经验证码。
import { defineModule } from '../../app/module';
import { registerNoticeSource } from '../../main/notifications';
import { registerJwcIpc } from './main/ipc';
import { jwcNoticeSource } from './main/jwc';

export const jwcModule = defineModule({
  id: 'jwc',
  register() {
    registerJwcIpc();
    registerNoticeSource(jwcNoticeSource);
  },
});
