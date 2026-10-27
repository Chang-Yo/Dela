import { z } from 'zod';
import { workspaceEntryIdSchema } from './workspace';

// Workspace references accept real file paths and registered entry UUIDs; other resources retain domain IDs.
export const resourceRefSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('workspace'), id: workspaceEntryIdSchema }).strict(),
  z.object({ type: z.literal('canvas'), id: z.string().min(1).max(512) }).strict(),
  z.object({ type: z.literal('mail'), id: z.number().int().positive().safe() }).strict(),
  z
    .object({
      type: z.literal('attachment'),
      messageId: z.number().int().positive().safe(),
      part: z.string().regex(/^\d+(?:\.\d+)*$/),
    })
    .strict(),
  z.object({ type: z.literal('shuiyuan-topic'), id: z.number().int().positive() }).strict(),
]);

export type ResourceRef = z.infer<typeof resourceRefSchema>;
