import { z } from 'zod';
import { getShuiyuanState } from '../../../shuiyuan/api';
import { tool } from '../shared';

export const shuiyuanStatusTool = tool(
  '查询水源社区绑定状态（只读，不联网）：是否已绑定（本地凭据存在，未在线验证）、用户名与绑定时间。未绑定时其余水源工具返回 NOT_CONFIGURED。',
  z.object({}).strict(),
  () => getShuiyuanState(),
);
