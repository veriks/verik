import { z } from 'zod';
import { SeveritySchema } from '../../shared/schemas.js';

export const FindingCategorySchema = z.enum([
  'correctness',
  'security',
  'authorization',
  'authentication',
  'data-integrity',
  'reliability',
  'concurrency',
  'performance',
  'compatibility',
  'testing',
  'maintainability',
  'dependency',
  'configuration',
  'privacy',
]);

export const EvidenceItemSchema = z.object({
  path: z.string(),
  startLine: z.number().optional(),
  endLine: z.number().optional(),
  excerpt: z.string(),
  explanation: z.string(),
});

export const FindingSchema = z.object({
  id: z.string(),
  title: z.string(),
  category: FindingCategorySchema,
  severity: SeveritySchema,
  confidence: z.number().min(0).max(1),
  summary: z.string(),
  impact: z.string(),
  evidence: z.array(EvidenceItemSchema),
  builderEvidenceRefs: z.array(z.string()),
  recommendation: z.string(),
  blockingCandidate: z.boolean(),
});

export const ReviewerOutputSchema = z.object({
  summary: z.string(),
  findings: z.array(FindingSchema),
  positiveEvidence: z.array(z.string()),
  unresolvedQuestions: z.array(z.string()),
  analysisLimitations: z.array(z.string()),
  recommendedVerdict: z.enum(['pass', 'warn', 'block']),
});

export type Finding = z.infer<typeof FindingSchema>;
export type ReviewerOutput = z.infer<typeof ReviewerOutputSchema>;
