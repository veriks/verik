import type { PipelineResult } from '../../core/pipeline/verification-pipeline.js';
import type { RunContext } from '../../core/run/run-context.js';
import type { RunRecord } from '../../core/run/run-state.js';
import { VerikConfigSchema, PolicyConfigSchema } from '../../config/config-schema.js';
import { VerificationCache } from '../../core/cache/verification-cache.js';
import { asRawPatch } from '../../core/privacy/patch-types.js';
import { prepareSafePatch } from '../../core/privacy/diff-sanitizer.js';
import { createProgress } from './progress.js';

const FAKE_RUN_ID = 'vk_DEMO0000000000000001';

const FAKE_TREE = 'd0000000000000000000000000000000000demo0';

const FAKE_PATCH = asRawPatch(`diff --git a/src/auth/reset.ts b/src/auth/reset.ts
new file mode 100644
--- /dev/null
+++ b/src/auth/reset.ts
@@ -0,0 +1,110 @@
+import crypto from 'node:crypto'
+import bcrypt from 'bcrypt'
+import { db } from '../db/client.js'
+
+export async function requestReset(email: string) {
+  const user = await db.users.findByEmail(email)
+  if (!user) return res.status(404).json({ error: 'Email not found' })
+  const token = crypto.randomBytes(32).toString('hex')
+  const expiresAt = new Date(Date.now() + 3600_000)
+  await db.reset_tokens.create({ userId: user.id, token, expiresAt })
+  await sendResetEmail(user.email, token)
+}
+
+export async function confirmReset(token: string, newPassword: string) {
+  const record = await db.reset_tokens.findByToken(token)
+  if (!record || record.expiresAt < new Date()) throw new Error('Invalid token')
+  const hashed = await bcrypt.hash(newPassword, 12)
+  await db.users.update({ id: record.userId, password: hashed })
+  // token not deleted or marked used
+}`);

// Through the real sanitiser rather than a hand-written constant, so the demo
// shows what a user would actually see.
const FAKE_SAFE = prepareSafePatch(FAKE_PATCH, [], 500_000);

export function buildFakeRecord(): RunRecord {
  return {
    runId: FAKE_RUN_ID,
    repoId: 'repo_demo0000000000000',
    repositoryPath: process.cwd(),
    repositoryRemote: 'https://github.com/acme/api',
    branch: 'feat/password-reset',
    baselineCommitSha: 'a3f8c12',
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    wrappedCommand: ['claude', '-p', 'Add password reset support'],
    wrappedCommandExitCode: 0,
    repositoryDirtyBefore: false,
    repositoryDirtyAfter: true,
    baselineSnapshotHash: 'abc123',
    finalSnapshotHash: 'def456',
    changedFiles: [
      'src/auth/reset.ts',
      'src/auth/reset.test.ts',
      'src/routes/auth.ts',
      'src/email/templates/reset.html',
      'src/db/migrations/20260801_add_reset_tokens.sql',
      'src/db/schema.ts',
      'package.json',
    ],
    preExistingChangedPaths: [],
    commandIntroducedPaths: [
      'src/auth/reset.ts',
      'src/auth/reset.test.ts',
      'src/routes/auth.ts',
      'src/email/templates/reset.html',
      'src/db/migrations/20260801_add_reset_tokens.sql',
      'src/db/schema.ts',
      'package.json',
    ],
    status: 'completed',
    stageStatuses: {
      scout: 'completed',
      builder: 'completed',
      reviewer: 'completed',
      judge: 'completed',
    },
    policyMode: 'advisory',
    errors: [],
  };
}

export function buildFakePipeline(): PipelineResult {
  const now = new Date();
  const ts = (offsetMs: number) => new Date(now.getTime() - offsetMs).toISOString();
  return {
    deterministicFindings: [],
    suppressedFindings: [],
    stageStatuses: {
      scout: 'completed',
      builder: 'completed',
      reviewer: 'completed',
      judge: 'completed',
    },
    stageMetadata: {
      scout: {
        startedAt: ts(11624),
        completedAt: ts(11203),
        durationMs: 421,
        status: 'completed',
        model: 'claude-sonnet-4-6',
        provider: 'anthropic',
        promptVersion: '0.1.0',
      },
      builder: {
        startedAt: ts(10800),
        completedAt: ts(5588),
        durationMs: 5212,
        status: 'completed',
        fromCache: false,
      },
      reviewer: {
        startedAt: ts(5500),
        completedAt: ts(2396),
        durationMs: 3104,
        status: 'completed',
        model: 'claude-sonnet-4-6',
        provider: 'anthropic',
        promptVersion: '0.1.0',
      },
      judge: {
        startedAt: ts(2200),
        completedAt: ts(1313),
        durationMs: 887,
        status: 'completed',
        model: 'claude-sonnet-4-6',
        provider: 'anthropic',
        promptVersion: '0.1.0',
      },
    },
    scout: {
      changeSummary:
        'Adds password reset endpoints, a database migration for reset tokens, and an email template. The reset token is persisted in a new `reset_tokens` table and consumed on use.',
      apparentIntent: 'Implement password reset support.',
      changeType: 'feature',
      languages: ['TypeScript', 'SQL', 'HTML'],
      frameworks: ['Express', 'PostgreSQL'],
      affectedAreas: ['authentication', 'database', 'email'],
      riskLevel: 'high',
      riskReasons: [
        'Authentication logic introduced',
        'Database migration added',
        'Token lifecycle handling present',
      ],
      files: [
        {
          path: 'src/auth/reset.ts',
          role: 'Password reset request and validation logic',
          importance: 'critical',
        },
        {
          path: 'src/db/migrations/20260801_add_reset_tokens.sql',
          role: 'Schema migration for reset_tokens table',
          importance: 'high',
        },
        {
          path: 'src/routes/auth.ts',
          role: 'Express route handlers for reset flow',
          importance: 'high',
        },
      ],
      builderRecommendations: [
        'TypeScript compilation should be checked',
        'Unit tests should run — auth changes warrant test verification',
      ],
      reviewFocus: [
        'Token expiry and validity window',
        'Token reuse after successful reset',
        'Account enumeration via response differences',
        'Rate limiting on reset endpoint',
      ],
      uncertainties: [],
    },
    builder: {
      projectTypes: ['node'],
      packageManager: 'pnpm',
      commands: [
        {
          name: 'typecheck',
          command: 'pnpm run typecheck',
          status: 'passed',
          exitCode: 0,
          durationMs: 1834,
          stdoutTail: '',
          stderrTail: '',
        },
        {
          name: 'test',
          command: 'pnpm run test',
          status: 'failed',
          exitCode: 1,
          durationMs: 5212,
          stdoutTail:
            'PASS src/auth/login.test.ts\nFAIL src/auth/reset.test.ts\n  ● rejects reuse of reset token\n    Expected: 401\n    Received: 200',
          stderrTail: '',
        },
        {
          name: 'build',
          command: 'pnpm run build',
          status: 'passed',
          exitCode: 0,
          durationMs: 3109,
          stdoutTail: '',
          stderrTail: '',
        },
      ],
      overallStatus: 'failed',
      evidence: [
        {
          kind: 'test-failure',
          summary: 'test failed: "rejects reuse of reset token" — Expected 401, Received 200',
          command: 'pnpm run test',
          reference: 'builder-command-1',
        },
      ],
      limitations: [],
    },
    reviewer: {
      summary:
        'The reset flow has a critical token reuse vulnerability confirmed by a failing test. Two additional findings around rate limiting and account enumeration are present but lower severity.',
      findings: [
        {
          id: 'finding-001',
          title: 'Reset token remains valid after successful password change',
          category: 'security',
          severity: 'high',
          confidence: 0.94,
          summary:
            'The reset handler updates the password but does not invalidate the token. A second request with the same token succeeds.',
          impact:
            'An attacker who intercepts or observes a reset token can replay it after the user has already reset their password.',
          evidence: [
            {
              path: 'src/auth/reset.ts',
              startLine: 82,
              endLine: 104,
              excerpt:
                'await db.users.update({ password: hashed })\n// token not deleted or marked used',
              explanation:
                'The successful path updates the password but does not consume or expire the token.',
            },
          ],
          builderEvidenceRefs: ['builder-command-1'],
          recommendation:
            'Delete or mark the token as used within the same database transaction as the password update.',
          blockingCandidate: true,
        },
        {
          id: 'finding-002',
          title: 'No rate limiting on password reset endpoint',
          category: 'security',
          severity: 'medium',
          confidence: 0.82,
          summary:
            'The `/auth/reset/request` route applies no rate limiting middleware. An attacker can enumerate accounts or flood email delivery.',
          impact: 'Account enumeration and email flooding.',
          evidence: [
            {
              path: 'src/routes/auth.ts',
              startLine: 34,
              endLine: 41,
              excerpt: "router.post('/reset/request', resetController.request)",
              explanation: 'No rate-limit middleware present on this route.',
            },
          ],
          builderEvidenceRefs: [],
          recommendation:
            'Apply rate limiting (e.g. `express-rate-limit`) to the reset request endpoint.',
          blockingCandidate: false,
        },
        {
          id: 'finding-003',
          title: 'Response distinguishes valid from invalid email addresses',
          category: 'security',
          severity: 'low',
          confidence: 0.71,
          summary:
            'The reset request handler returns distinct messages for registered and unregistered email addresses, enabling account enumeration.',
          impact: 'An attacker can determine which email addresses have accounts.',
          evidence: [
            {
              path: 'src/auth/reset.ts',
              startLine: 22,
              endLine: 30,
              excerpt: "if (!user) return res.status(404).json({ error: 'Email not found' })",
              explanation: 'A 404 with a distinct message confirms the email is not registered.',
            },
          ],
          builderEvidenceRefs: [],
          recommendation: 'Return the same 200 response regardless of whether the email exists.',
          blockingCandidate: false,
        },
      ],
      positiveEvidence: [
        'Token is cryptographically random (crypto.randomBytes used)',
        'Token expiry of 1 hour is set at creation time',
        'Password is hashed with bcrypt before storage',
      ],
      unresolvedQuestions: [],
      analysisLimitations: [],
      recommendedVerdict: 'block',
    },
    judge: {
      verdict: 'block',
      confidence: 0.94,
      summary:
        'Block. The reset token reuse vulnerability is confirmed by both the diff and a failing test. The other findings are valid but not blocking at this threshold.',
      reasons: [
        {
          title: 'Reusable password reset token confirmed by failing test',
          severity: 'high',
          findingIds: ['finding-001'],
          builderEvidenceRefs: ['builder-command-1'],
        },
      ],
      dismissedFindings: [],
      requiredActions: [
        'Invalidate or delete the reset token atomically with the password update',
        'Add a test that confirms a used token is rejected',
      ],
      limitations: [],
    },
    policy: {
      mode: 'advisory',
      decision: 'warn',
      exitCode: 0,
      reason: 'Advisory mode: findings shown, exit code not affected.',
      overrideAvailable: true,
    },
    errors: [],
  };
}

export function buildFakeContext(record: RunRecord): RunContext {
  const config = VerikConfigSchema.parse({ version: 1 });
  const policy = PolicyConfigSchema.parse({ version: 1 });
  return {
    runId: FAKE_RUN_ID,
    repoRoot: process.cwd(),
    repoId: record.repoId,
    config,
    policy,
    wrappedCommand: record.wrappedCommand,
    intent: undefined,
    baselineSnapshot: {
      capturedAt: record.startedAt,
      commitSha: record.baselineCommitSha,
      branch: record.branch,
      tree: FAKE_TREE,
      headTree: FAKE_TREE,
      dirty: false,
      hash: record.baselineSnapshotHash,
    },
    diff: {
      patch: FAKE_PATCH,
      safePatch: FAKE_SAFE.patch,
      excludedFiles: FAKE_SAFE.excludedFiles,
      redactionCount: FAKE_SAFE.redactionCount,
      changedFiles: record.changedFiles!.map((p) => ({
        path: p,
        changeType: 'added' as const,
        additions: 40,
        deletions: 0,
        isBinary: false,
      })),
      additions: 284,
      deletions: 31,
      preExistingChangedPaths: [],
      commandIntroducedPaths: record.commandIntroducedPaths!,
      truncated: false,
      droppedFiles: [],
    },
    record,
    flags: {
      json: false,
      quiet: false,
      verbose: false,
      noBuilder: false,
    },
    selectedContext: {
      diff: FAKE_SAFE.patch,
      changedFiles: [],
      manifestFiles: [],
      tokenBudget: {
        totalTokens: 60_000,
        usedTokens: 0,
        remainingTokens: 60_000,
        truncated: false,
      },
      limitations: [],
    },
    cache: new VerificationCache(process.cwd()),
    progress: createProgress(true),
    abortSignal: new AbortController().signal,
  };
}
