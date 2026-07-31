import { z } from 'zod';
import { VerdictSchema, SeveritySchema } from '../../shared/schemas.js';

export const JudgeReasonSchema = z.object({
  title: z.string(),
  severity: SeveritySchema,
  findingIds: z.array(z.string()),
  builderEvidenceRefs: z.array(z.string()),
});

export const DismissedFindingSchema = z.object({
  findingId: z.string(),
  reason: z.string(),
});

export const JudgeOutputSchema = z.object({
  verdict: VerdictSchema,
  confidence: z.number().min(0).max(1),
  summary: z.string(),
  reasons: z.array(JudgeReasonSchema),
  dismissedFindings: z.array(DismissedFindingSchema),
  requiredActions: z.array(z.string()),
  limitations: z.array(z.string()),
});

export type JudgeOutput = z.infer<typeof JudgeOutputSchema>;
