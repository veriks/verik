import { z } from 'zod';

export const BuilderCommandStatusSchema = z.enum([
  'passed', 'failed', 'skipped', 'timed_out', 'unavailable', 'errored',
]);

export const BuilderCommandResultSchema = z.object({
  name: z.string(),
  command: z.string(),
  status: BuilderCommandStatusSchema,
  exitCode: z.number(),
  durationMs: z.number(),
  stdoutTail: z.string(),
  stderrTail: z.string(),
});

export const BuilderEvidenceSchema = z.object({
  kind: z.string(),
  summary: z.string(),
  command: z.string(),
  reference: z.string(),
});

export const BuilderOutputSchema = z.object({
  projectTypes: z.array(z.string()),
  packageManager: z.string().optional(),
  commands: z.array(BuilderCommandResultSchema),
  overallStatus: BuilderCommandStatusSchema,
  evidence: z.array(BuilderEvidenceSchema),
  limitations: z.array(z.string()),
});

export type BuilderOutput = z.infer<typeof BuilderOutputSchema>;
export type BuilderCommandResult = z.infer<typeof BuilderCommandResultSchema>;
export type BuilderEvidence = z.infer<typeof BuilderEvidenceSchema>;
