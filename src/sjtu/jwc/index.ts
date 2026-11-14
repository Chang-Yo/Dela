// 教务处通知：抓取学生通知列表，附件下载需经验证码。
import { defineModule } from '../../app/module';
import { implement } from '../../core/protocol/contract';
import { registerNoticeSource } from '../../modules/notifications';
import { jwcContract } from './contract';
import { downloadJwcAttachment, getJwcCaptcha, getJwcNotice, jwcNoticeSource } from './main/jwc';

export const jwcModule = defineModule({
  id: 'jwc',
  ipc: implement(jwcContract, {
    notice: getJwcNotice,
    captcha: ({ noticeId, attachmentId }) => getJwcCaptcha(noticeId, attachmentId),
    download: ({ token, code }) => downloadJwcAttachment(token, code),
  }),
  register() {
    registerNoticeSource(jwcNoticeSource);
  },
});
