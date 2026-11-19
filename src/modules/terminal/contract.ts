import { z } from 'zod';
import { defineContract } from '../../core/protocol/contract';

export interface TerminalSession {
  id: string;
  title: string;
  buffer: string;
  sequence: number;
  exitCode: number | null;
}

export type TerminalEvent =
  | { type: 'data'; projectId: string; id: string; sequence: number; data: string }
  | { type: 'exit'; projectId: string; id: string; sequence: number; exitCode: number };

const id = z.uuid();
const size = z.number().int().min(1).max(1000);

export const terminalContract = defineContract(
  'terminal',
  {
    list: { input: id, output: z.custom<TerminalSession[]>() },
    create: { input: z.object({ projectId: id, id }), output: z.custom<TerminalSession>() },
    write: { input: z.object({ id, data: z.string().max(2_000_000) }), output: z.void() },
    resize: { input: z.object({ id, cols: size, rows: size }), output: z.void() },
    close: { input: id, output: z.void() },
    closeProject: { input: id, output: z.void() },
  },
  { event: z.custom<TerminalEvent>() },
);
