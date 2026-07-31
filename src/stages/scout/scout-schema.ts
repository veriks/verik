import { z } from 'zod';

export const ChangeTypeSchema = z.enum([
  'feature', 'bugfix', 'refactor', 'test', 'documentation',
  'dependency', 'configuration', 'migration', 'mixed', 'unknown',
]);

export const RiskLevelSchema = z.enum(['low', 'medium', 'high', 'critical']);

export const ScoutFileSchema = z.object({
  path: z.string(),
  role: z.string(),
  importance: z.enum(['low', 'medium', 'high', 'critical']),
});

export const ScoutOutputSchema = z.object({
  changeSummary: z.string(),
  apparentIntent: z.string(),
  changeType: ChangeTypeSchema,
  languages: z.array(z.string()),
  frameworks: z.array(z.string()),
  affectedAreas: z.array(z.string()),
  riskLevel: RiskLevelSchema,
  riskReasons: z.array(z.string()),
  files: z.array(ScoutFileSchema),
  builderRecommendations: z.array(z.string()),
  reviewFocus: z.array(z.string()),
  uncertainties: z.array(z.string()),
});

export type ScoutOutput = z.infer<typeof ScoutOutputSchema>;
export type ScoutFile = z.infer<typeof ScoutFileSchema>;
