import { useQuery } from '@tanstack/react-query';
import { createClient } from '../../../core/protocol/contract';
import { mailContract, type MailState } from '../contract';

export const mailClient = createClient(mailContract, window.dela?.bridge);

export const mailStateKey = ['mail', 'state'];
/** 邮箱页的读取都在这一前缀下，退出登录时一并清掉。 */
export const mailBoxKey = ['mail', 'box'];
export const draftsKey = [...mailBoxKey, 'drafts'];

export function useMailState(): MailState | undefined {
  return useQuery({ queryKey: mailStateKey, queryFn: () => mailClient.state() }).data;
}
