import type { RunContext } from '../run/run-context.js';
import type { PipelineResult } from '../pipeline/verification-pipeline.js';
import type { Finding } from '../../stages/reviewer/reviewer-schema.js';
import type { BuilderCommandResult } from '../../stages/builder/builder-schema.js';

const STATUS = {
  block:        { color: '#ff4444', label: 'Block'        },
  warn:         { color: '#f59e0b', label: 'Warning'      },
  pass:         { color: '#22c55e', label: 'Pass'         },
  inconclusive: { color: '#737373', label: 'Inconclusive' },
} as const;

const SEV: Record<string, string> = {
  critical: '#ff4444', high: '#ff4444',
  medium: '#f59e0b', low: '#737373', info: '#3b82f6',
};

const e   = (s: string) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const pct = (n: number) => `${Math.round(n * 100)}`;
const dur = (ms: number) => ms >= 1000 ? `${(ms/1000).toFixed(1)}s` : `${ms}ms`;

function renderDiff(patch: string): string {
  const rows = patch.split('\n').slice(0, 500).map(line => {
    if (line.startsWith('+++') || line.startsWith('---')) return `<div class="dl-meta">${e(line)}</div>`;
    if (line.startsWith('@@'))  return `<div class="dl-hunk">${e(line)}</div>`;
    if (line.startsWith('+'))   return `<div class="dl-add"><span>+</span>${e(line.slice(1))}</div>`;
    if (line.startsWith('-'))   return `<div class="dl-del"><span>-</span>${e(line.slice(1))}</div>`;
    return `<div class="dl-ctx"><span> </span>${e(line.slice(1))}</div>`;
  }).join('');
  return `<div class="diff-view">${rows}</div>`;
}

function renderFinding(f: Finding, idx: number): string {
  const color  = SEV[f.severity] ?? '#737373';
  const isHigh = f.severity === 'critical' || f.severity === 'high';
  const evs = f.evidence.map(ev => {
    const loc = ev.startLine ? `:${ev.startLine}${ev.endLine && ev.endLine !== ev.startLine ? `–${ev.endLine}` : ''}` : '';
    return `<div class="ev"><div class="ev-file">${e(ev.path)}${loc}</div>${ev.excerpt ? `<pre class="ev-code">${e(ev.excerpt)}</pre>` : ''}<div class="ev-note">${e(ev.explanation)}</div></div>`;
  }).join('');
  return `
<details class="fi" ${isHigh && idx < 2 ? 'open' : ''}>
  <summary class="fi-row">
    <span class="fi-dot" style="background:${color}"></span>
    <span class="fi-sev" style="color:${color}">${e(f.severity)}</span>
    <span class="fi-title">${e(f.title)}</span>
    <span class="fi-meta"><span class="fi-cat">${e(f.category)}</span><span class="fi-pct">${pct(f.confidence)}%</span></span>
    <svg class="fi-arr" viewBox="0 0 16 16"><path d="M6.22 3.22a.75.75 0 011.06 0l4.25 4.25a.75.75 0 010 1.06l-4.25 4.25a.75.75 0 01-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 010-1.06z" fill="currentColor"/></svg>
  </summary>
  <div class="fi-body">
    <p class="fi-sum">${e(f.summary)}</p>
    <p class="fi-imp"><b>Impact</b> ${e(f.impact)}</p>
    ${evs}
    <div class="fi-rec"><span>&#8594;</span><span>${e(f.recommendation)}</span></div>
  </div>
</details>`;
}

function renderCmd(c: BuilderCommandResult): string {
  const ok   = c.status === 'passed';
  const fail = c.status !== 'passed' && c.status !== 'skipped';
  const col  = ok ? '#22c55e' : fail ? '#ff4444' : '#737373';
  const tail = (c.stderrTail || c.stdoutTail).slice(0, 400);
  return `<div class="cmd-row"><span style="color:${col};font-weight:700;width:12px">${ok?'✓':fail?'✗':'–'}</span><code class="cmd-c">${e(c.command)}</code><span class="cmd-d">${dur(c.durationMs)}</span></div>${fail && tail ? `<pre class="cmd-out">${e(tail)}</pre>` : ''}`;
}

function css(): string { return `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{font-size:13px;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
body{font-family:'Inter',system-ui,sans-serif;background:#0a0a0a;color:#ededed;line-height:1.5;min-height:100vh}

/* topbar */
.topbar{display:flex;align-items:center;justify-content:space-between;padding:0 24px;height:48px;border-bottom:1px solid rgba(255,255,255,.07)}
.topbar-logo{font-size:11px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:#525252}
.topbar-id{font-family:'JetBrains Mono',monospace;font-size:11px;color:#404040}

/* status */
.status{padding:40px 24px 32px;border-bottom:1px solid rgba(255,255,255,.07)}
.status-row{display:flex;align-items:center;gap:10px;margin-bottom:12px}
.status-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
.status-word{font-size:28px;font-weight:700;letter-spacing:-.5px;line-height:1}
.status-summary{font-size:14px;color:#a1a1a1;max-width:580px;line-height:1.6;margin-bottom:20px}
.status-chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;background:#111;border:1px solid rgba(255,255,255,.07);border-radius:5px}
.chip-k{font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#404040}
.chip-v{font-family:'JetBrains Mono',monospace;font-size:11px;color:#737373}

/* stats */
.stats{display:flex;padding:0 24px;border-bottom:1px solid rgba(255,255,255,.07)}
.stat{padding:20px 28px 20px 0;margin-right:28px;border-right:1px solid rgba(255,255,255,.07)}
.stat:last-child{border-right:none}
.stat-n{display:block;font-size:22px;font-weight:700;letter-spacing:-.5px;line-height:1;margin-bottom:4px}
.stat-l{font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#404040}

/* page */
.page{max-width:800px;margin:0 auto;padding:36px 24px 80px}
.sec{margin-bottom:36px}
.sec-label{font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#404040;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid rgba(255,255,255,.05)}

/* actions */
.actions{background:#111;border:1px solid rgba(255,255,255,.07);border-radius:7px;padding:16px 18px;margin-bottom:36px}
.actions-title{font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#525252;margin-bottom:12px}
.action{display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-top:1px solid rgba(255,255,255,.05)}
.action:first-of-type{border-top:none}
.action-arr{color:#525252;flex-shrink:0;margin-top:1px;font-size:12px}
.action-txt{font-size:13px;color:#a1a1a1}

/* findings */
.fi{border:1px solid rgba(255,255,255,.07);border-radius:7px;background:#111;margin-bottom:6px;overflow:hidden}
.fi-row{list-style:none;cursor:pointer;display:flex;align-items:center;gap:10px;padding:12px 16px;user-select:none}
.fi-row::-webkit-details-marker{display:none}
.fi-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
.fi-sev{font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;width:58px;flex-shrink:0}
.fi-title{font-size:13px;font-weight:500;color:#ededed;flex:1;line-height:1.4}
.fi-meta{display:flex;align-items:center;gap:10px;flex-shrink:0}
.fi-cat{font-size:10px;color:#404040;text-transform:capitalize}
.fi-pct{font-size:10px;font-family:'JetBrains Mono',monospace;color:#404040}
.fi-arr{width:14px;height:14px;color:#404040;flex-shrink:0;transition:transform .15s}
details[open] .fi-arr{transform:rotate(90deg)}

.fi-body{padding:14px 16px 16px 33px;border-top:1px solid rgba(255,255,255,.05);display:flex;flex-direction:column;gap:12px}
.fi-sum{font-size:13px;color:#a1a1a1;line-height:1.6}
.fi-imp{font-size:12px;color:#525252;line-height:1.5}
.fi-imp b{color:#737373;font-weight:500;margin-right:6px}

/* evidence */
.ev{border:1px solid rgba(255,255,255,.07);border-radius:5px;overflow:hidden;background:#0a0a0a}
.ev-file{padding:7px 12px;font-family:'JetBrains Mono',monospace;font-size:11px;color:#3b82f6;background:#111;border-bottom:1px solid rgba(255,255,255,.05)}
.ev-code{padding:12px;font-family:'JetBrains Mono',monospace;font-size:11.5px;color:#ededed;line-height:1.6;overflow-x:auto;white-space:pre}
.ev-note{padding:8px 12px;font-size:11px;color:#525252;border-top:1px solid rgba(255,255,255,.05)}

/* recommendation */
.fi-rec{display:flex;gap:8px;align-items:flex-start;padding:10px 12px;background:rgba(34,197,94,.04);border:1px solid rgba(34,197,94,.1);border-radius:5px;font-size:12px;color:#a1a1a1}
.fi-rec span:first-child{color:#22c55e;font-weight:700;flex-shrink:0;margin-top:1px}

/* accordion */
.acc{border:1px solid rgba(255,255,255,.07);border-radius:7px;background:#111;margin-bottom:8px;overflow:hidden}
.acc>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:8px;padding:12px 16px;font-size:12px;font-weight:500;user-select:none}
.acc>summary::-webkit-details-marker{display:none}
.acc-badge{font-size:10px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;padding:2px 7px;border-radius:3px;border:1px solid currentColor}
.acc-dur{font-size:10px;font-family:'JetBrains Mono',monospace;color:#404040;margin-left:4px}
.acc-arr{width:13px;height:13px;color:#404040;margin-left:auto;transition:transform .15s}
details[open] .acc-arr{transform:rotate(90deg)}
.acc-body{padding:14px 16px;border-top:1px solid rgba(255,255,255,.05)}
.acc-body p{font-size:12px;color:#a1a1a1;line-height:1.6;margin-bottom:8px}
.acc-tags{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}
.acc-tag{font-size:11px;padding:2px 8px;border-radius:3px;background:#1a1a1a;border:1px solid rgba(255,255,255,.07);color:#737373}
.acc-tag-blue{color:#60a5fa;border-color:rgba(96,165,250,.15);background:rgba(96,165,250,.04)}

/* builder */
.cmd-row{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.05)}
.cmd-row:last-of-type{border-bottom:none}
.cmd-c{font-family:'JetBrains Mono',monospace;font-size:11.5px;color:#ededed;flex:1}
.cmd-d{font-family:'JetBrains Mono',monospace;font-size:10px;color:#404040;flex-shrink:0}
.cmd-out{font-family:'JetBrains Mono',monospace;font-size:11px;color:#ff4444;padding:10px 12px;background:rgba(255,68,68,.04);border-top:1px solid rgba(255,68,68,.08);white-space:pre;overflow-x:auto}

/* diff */
.diff-view{font-family:'JetBrains Mono',monospace;font-size:11.5px;line-height:1.6;overflow-x:auto;padding:12px 0;background:#0a0a0a}
.dl-add,.dl-del,.dl-ctx,.dl-hunk,.dl-meta{display:flex;gap:0;white-space:pre}
.dl-add span,.dl-del span,.dl-ctx span,.dl-hunk span,.dl-meta span{display:inline-block;width:28px;text-align:center;flex-shrink:0;user-select:none;color:#404040;padding:0 6px}
.dl-add{background:rgba(34,197,94,.06);color:#4ade80}
.dl-add span{color:rgba(74,222,128,.5)}
.dl-del{background:rgba(255,68,68,.06);color:#f87171}
.dl-del span{color:rgba(248,113,113,.5)}
.dl-ctx{color:#525252}
.dl-hunk{color:#3b82f6;padding:4px 0}
.dl-meta{color:#333}

/* footer */
.footer{text-align:center;font-size:11px;color:#333;padding:24px 0;border-top:1px solid rgba(255,255,255,.04);margin-top:24px}
`; }

export function renderHtmlReport(context: RunContext, pipeline: PipelineResult): string {
  const { record, diff } = context;
  const { scout, builder, reviewer, judge, policy } = pipeline;
  const verdict  = (judge?.verdict ?? 'inconclusive') as keyof typeof STATUS;
  const tok      = STATUS[verdict] ?? STATUS.inconclusive;
  const findings = reviewer?.findings ?? [];
  const high     = findings.filter(f => f.severity === 'critical' || f.severity === 'high').length;
  const actions  = judge?.requiredActions ?? [];

  const chip = (k: string, v: string) =>
    `<div class="chip"><span class="chip-k">${k}</span><span class="chip-v">${e(v)}</span></div>`;

  const accArrow = `<svg class="acc-arr" viewBox="0 0 16 16"><path d="M6.22 3.22a.75.75 0 011.06 0l4.25 4.25a.75.75 0 010 1.06l-4.25 4.25a.75.75 0 01-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 010-1.06z" fill="currentColor"/></svg>`;

  const scoutSec = scout ? `
<details class="acc">
  <summary>
    Scout
    <span class="acc-badge" style="color:${SEV[scout.riskLevel]??'#737373'};border-color:${SEV[scout.riskLevel]??'#737373'}20">${e(scout.riskLevel)} risk</span>
    <span class="acc-dur">${dur(pipeline.stageMetadata.scout?.durationMs ?? 0)}</span>
    ${accArrow}
  </summary>
  <div class="acc-body">
    <p>${e(scout.changeSummary)}</p>
    ${scout.affectedAreas.length ? `<div class="acc-tags">${scout.affectedAreas.map(a=>`<span class="acc-tag">${e(a)}</span>`).join('')}</div>` : ''}
    ${scout.reviewFocus.length ? `<div class="acc-tags">${scout.reviewFocus.map(f=>`<span class="acc-tag acc-tag-blue">${e(f)}</span>`).join('')}</div>` : ''}
  </div>
</details>` : '';

  const bStatus = builder?.overallStatus ?? 'skipped';
  const bCol    = bStatus === 'passed' ? '#22c55e' : bStatus === 'failed' ? '#ff4444' : '#737373';
  const builderSec = builder ? `
<details class="acc">
  <summary>
    Builder
    <span class="acc-badge" style="color:${bCol};border-color:${bCol}20">${e(bStatus)}</span>
    <span class="acc-dur">${pipeline.stageMetadata.builder?.fromCache ? 'cached' : dur(pipeline.stageMetadata.builder?.durationMs ?? 0)}</span>
    ${accArrow}
  </summary>
  <div class="acc-body">
    ${builder.commands.length ? builder.commands.map(renderCmd).join('') : '<p style="color:#404040">No commands detected.</p>'}
  </div>
</details>` : '';

  const diffSec = diff?.patch ? `
<details class="acc">
  <summary>
    Diff
    <span class="acc-dur" style="margin-left:0">+${diff.additions} -${diff.deletions} · ${diff.changedFiles.length} files</span>
    ${accArrow}
  </summary>
  ${renderDiff(diff.patch)}
</details>` : '';

  const ts = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${e(tok.label)} — Crosscheck</title>
<style>${css()}</style>
</head>
<body>

<div class="topbar">
  <span class="topbar-logo">Crosscheck</span>
  <span class="topbar-id">${e(record.runId)}</span>
</div>

<div class="status">
  <div class="status-row">
    <span class="status-dot" style="background:${tok.color}"></span>
    <span class="status-word" style="color:${tok.color}">${tok.label}</span>
  </div>
  ${judge ? `<p class="status-summary">${e(judge.summary)}</p>` : ''}
  <div class="status-chips">
    ${chip('command', record.wrappedCommand.join(' '))}
    ${chip('branch', record.branch)}
    ${chip('commit', record.baselineCommitSha.slice(0, 8))}
    ${judge ? chip('confidence', pct(judge.confidence) + '%') : ''}
    ${chip('date', ts)}
  </div>
</div>

<div class="stats">
  <div class="stat"><span class="stat-n">${diff?.changedFiles.length ?? 0}</span><span class="stat-l">Files</span></div>
  <div class="stat"><span class="stat-n" style="color:#4ade80">+${diff?.additions ?? 0}</span><span class="stat-l">Added</span></div>
  <div class="stat"><span class="stat-n" style="color:#f87171">-${diff?.deletions ?? 0}</span><span class="stat-l">Removed</span></div>
  <div class="stat"><span class="stat-n">${findings.length}</span><span class="stat-l">Findings${high ? `, ${high} high` : ''}</span></div>
</div>

<div class="page">

  ${actions.length ? `<div class="actions">
    <div class="actions-title">Required actions</div>
    ${actions.map(a => `<div class="action"><span class="action-arr">→</span><span class="action-txt">${e(a)}</span></div>`).join('')}
  </div>` : ''}

  ${findings.length ? `<div class="sec">
    <div class="sec-label">Findings</div>
    ${findings.map((f, i) => renderFinding(f, i)).join('')}
  </div>` : ''}

  ${scoutSec || builderSec || diffSec ? `<div class="sec">
    <div class="sec-label">Details</div>
    ${scoutSec}${builderSec}${diffSec}
  </div>` : ''}

  <div class="footer">Crosscheck · not a guarantee of correctness or security</div>
</div>

</body>
</html>`;
}
