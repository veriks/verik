import { z } from 'zod';

export const PolicyResultSchema = z.object({
  mode: z.enum(['shadow', 'advisory', 'blocking']),
  decision: z.enum(['allow', 'warn', 'deny']),
  exitCode: z.number(),
  reason: z.string(),
  overrideAvailable: z.boolean(),
});
export type PolicyResult = z.infer<typeof PolicyResultSchema>;
