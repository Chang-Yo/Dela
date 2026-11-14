import { useQuery } from '@tanstack/react-query';
import { createClient } from '../../../core/protocol/contract';
import { mailContract, type MailState } from '../contract';

export const mailClient = createClient(mailContract, window.dela?.bridge);

export function useMailState(): MailState | undefined {
  return useQuery({ queryKey: ['mail', 'state'], queryFn: () => mailClient.state() }).data;
}
