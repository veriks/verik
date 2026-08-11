import { z } from 'zod';
import { SeveritySchema, VerdictSchema } from '../../shared/schemas.js';

export const StoredFindingSchema = z.object({
  id: z.string(),
  runId: z.string(),
  repositoryPath: z.string(),
  repositoryRemote: z.string().optional(),
  branch: z.string(),
  commitSha: z.string(),
  timestamp: z.string(),

  // Finding content
  ruleId: z.string().optional(), // deterministic rule ID if applicable
  title: z.string(),
  category: z.string(),
  severity: SeveritySchema,
  confidence: z.number(),
  filePath: z.string().optional(),
  startLine: z.number().optional(),
  summary: z.string(),
  recommendation: z.string(),

  // What happened to this finding
  judgeVerdict: VerdictSchema,
  judgeDisposed: z.enum(['confirmed', 'dismissed']),
  dismissReason: z.string().optional(),

  // Whether it escaped into production
  escaped: z.boolean().default(false),
  escapeNote: z.string().optional(),
});

export type StoredFinding = z.infer<typeof StoredFindingSchema>;

export const OverrideSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  repositoryPath: z.string(),

  // What this override suppresses
  ruleId: z.string().optional(),
  filePath: z.string().optional(),
  titlePattern: z.string().optional(), // regex match against finding title

  reason: z.string(),
  expiresAt: z.string().optional(), // ISO date — overrides can expire
  createdBy: z.string().optional(),
});

export type Override = z.infer<typeof OverrideSchema>;

export const RunSummarySchema = z.object({
  runId: z.string(),
  repositoryPath: z.string(),
  repositoryRemote: z.string().optional(),
  branch: z.string(),
  baselineCommitSha: z.string(),
  timestamp: z.string(),
  wrappedCommand: z.array(z.string()),
  verdict: VerdictSchema.optional(),
  confidence: z.number().optional(),
  findingCount: z.number(),
  highSeverityCount: z.number(),
  builderStatus: z.string().optional(),
  durationMs: z.number().optional(),
});

export type RunSummary = z.infer<typeof RunSummarySchema>;

export const MemoryIndexSchema = z.object({
  version: z.literal(1),
  runs: z.array(RunSummarySchema),
  findings: z.array(StoredFindingSchema),
  overrides: z.array(OverrideSchema),
  lastUpdated: z.string(),
});

export type MemoryIndex = z.infer<typeof MemoryIndexSchema>;
