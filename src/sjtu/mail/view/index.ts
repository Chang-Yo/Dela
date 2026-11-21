// 交大邮箱：学生与教工同一套服务器，用 jAccount 账号密码登录；作为预设登记给通用邮件模块。
import { defineView } from '../../../app/module';
import { registerMailPreset } from '../../../modules/mail/view';

export const sjtuMailView = defineView({
  pages: {},
  start() {
    registerMailPreset({
      label: '交大邮箱',
      domain: 'sjtu.edu.cn',
      server: {
        imapHost: 'mail.sjtu.edu.cn',
        imapPort: 993,
        smtpHost: 'mail.sjtu.edu.cn',
        smtpPort: 465,
      },
      passwordHint: 'jAccount 密码',
    });
  },
});
