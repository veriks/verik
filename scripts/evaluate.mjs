#!/usr/bin/env node
/**
 * Evaluation harness: replays fixtures through the real pipeline and scores the
 * verdicts against expected.json.
 *
 * Each fixture is materialised as a throwaway git repository — `before/` is
 * committed to form the baseline, `after/` is copied over it uncommitted — so
 * the run exercises the same attribution path a user gets, not a shortcut.
 *
 * Requires ANTHROPIC_API_KEY. Without it every LLM stage fails and the run is
 * correctly inconclusive, which tells you nothing.
 *
 *   node scripts/evaluate.mjs [--fixtures <dir>] [--out <file>] [--filter <substr>]
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdtemp, mkdir, readdir, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const FIXTURES = resolve(arg('fixtures', join(ROOT, 'datasets/evaluation/fixtures')));
const FILTER = arg('filter', '');
const SEVERITY = ['info', 'low', 'medium', 'high', 'critical'];

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function loadFixtures() {
  if (!(await exists(FIXTURES))) return [];
  const entries = await readdir(FIXTURES, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (FILTER && !e.name.includes(FILTER)) continue;
    const dir = join(FIXTURES, e.name);
    const expectedPath = join(dir, 'expected.json');
    if (!(await exists(expectedPath))) {
      console.warn(`skip ${e.name}: no expected.json`);
      continue;
    }
    out.push({ id: e.name, dir, expected: JSON.parse(await readFile(expectedPath, 'utf8')) });
  }
  return out;
}

/** Builds a real repo: before/ committed, after/ laid over it uncommitted. */
async function materialise(fixture) {
  const repo = await mkdtemp(join(tmpdir(), `cc-eval-${fixture.id}-`));
  const git = (args) => run('git', args, { cwd: repo });

  await git(['init', '-q']);
  await git(['config', 'user.email', 'eval@crosscheck.invalid']);
  await git(['config', 'user.name', 'Crosscheck Eval']);

  const before = join(fixture.dir, 'before');
  if (await exists(before)) await cp(before, repo, { recursive: true });
  await git(['add', '-A']);
  await git(['commit', '-qm', 'baseline', '--allow-empty']);

  const after = join(fixture.dir, 'after');
  if (await exists(after)) await cp(after, repo, { recursive: true, force: true });

  return repo;
}

async function verify(repo) {
  const cli = join(ROOT, 'dist', 'index.js');
  try {
    const { stdout } = await run(process.execPath, [cli, 'verify', '--json'], {
      cwd: repo,
      env: process.env,
      maxBuffer: 64 * 1024 * 1024,
    });
    const line = stdout.trim().split('\n').filter(Boolean).at(-1);
    return JSON.parse(line);
  } catch (err) {
    // `verify` exits non-zero on block (2) and inconclusive (3); both are
    // results, not failures. Only an unparseable payload is a harness error.
    const line = String(err.stdout ?? '')
      .trim()
      .split('\n')
      .filter(Boolean)
      .at(-1);
    if (line) {
      try {
        return JSON.parse(line);
      } catch {
        /* fall through */
      }
    }
    return { error: String(err.shortMessage ?? err.message) };
  }
}

function score(expected, actual) {
  const failures = [];
  if (actual.error) return { pass: false, failures: [`harness: ${actual.error}`] };

  if (expected.expectedVerdict && actual.verdict !== expected.expectedVerdict) {
    failures.push(`verdict: expected ${expected.expectedVerdict}, got ${actual.verdict}`);
  }

  for (const want of expected.expectedFindings ?? []) {
    const hit = (actual.findings ?? []).find((f) => {
      const titleOk = !want.titleContains
        ? true
        : String(f.title ?? '')
            .toLowerCase()
            .includes(want.titleContains.toLowerCase());
      const sevOk =
        !want.minSeverity || SEVERITY.indexOf(f.severity) >= SEVERITY.indexOf(want.minSeverity);
      const confOk = !want.minConfidence || (f.confidence ?? 0) >= want.minConfidence;
      return titleOk && sevOk && confOk;
    });
    if (!hit) failures.push(`missing finding matching "${want.titleContains ?? '(any)'}"`);
  }

  return { pass: failures.length === 0, failures };
}

const fixtures = await loadFixtures();

if (fixtures.length === 0) {
  console.log(`No fixtures in ${FIXTURES}.`);
  console.log('Fixtures come from real labelled runs — see datasets/evaluation/README.md.');
  process.exit(0);
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY is not set. Every stage would fail and every');
  console.error('result would be inconclusive, which measures nothing. Refusing to run.');
  process.exit(1);
}

const results = [];
for (const f of fixtures) {
  const repo = await materialise(f);
  try {
    const actual = await verify(repo);
    const scored = score(f.expected, actual);
    results.push({ fixtureId: f.id, ...scored, expected: f.expected, actual });
    console.log(`${scored.pass ? 'PASS' : 'FAIL'}  ${f.id}`);
    for (const msg of scored.failures) console.log(`        ${msg}`);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
}

const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} fixtures passed`);

const outDir = join(ROOT, 'datasets/evaluation/results');
await mkdir(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outFile = arg('out', join(outDir, `${stamp}.jsonl`));
await writeFile(outFile, results.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log(`results: ${outFile}`);

process.exit(passed === results.length ? 0 : 1);
