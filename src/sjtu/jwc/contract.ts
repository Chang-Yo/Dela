import { z } from 'zod';
import { defineContract } from '../../core/protocol/contract';

export interface JwcNotice {
  id: string;
  title: string;
  publishedAt: string;
  url: string;
  html: string;
  attachments: { id: string; name: string; url: string }[];
}

const noticeId = z.string().regex(/^jwc:\d+$/);

export const jwcContract = defineContract('jwc', {
  notice: { input: noticeId, output: z.custom<JwcNotice>() },
  captcha: {
    input: z.object({ noticeId, attachmentId: z.string().min(1) }),
    output: z.custom<{ token: string; image: string }>(),
  },
  download: {
    input: z.object({
      token: z.string().uuid(),
      code: z
        .string()
        .trim()
        .regex(/^\d{4}$/, '请输入四位验证码'),
    }),
    output: z.custom<{ status: 'saved' | 'canceled' | 'invalid-code' }>(),
  },
});

declare module '../../app/module' {
  interface NavTargets {
    jwc: { noticeId: string };
  }
}
