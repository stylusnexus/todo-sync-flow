/**
 * Write-back mode helpers.
 *
 * When insert_urls is true the action commits one change per new TODO (the
 * issue URL appended to that comment line) back to the branch that triggered
 * the run. These helpers keep that behaviour narrow and explainable:
 *   - only the branch that triggered the run, never the default branch
 *   - only the files the action patched, never `git add -A`
 *   - a preflight check before any issue is created
 */

export const WRITE_BACK_DOCS =
  'https://github.com/stylusnexus/todo-sync-flow#what-this-action-does-to-your-repo';

export const COMMIT_MESSAGE = 'chore(todo-sync-flow): insert issue URLs into TODO comments [skip ci]';

/** Branch name for a push ref (refs/heads/x), or null for tags, PR merge refs and anything else. */
export function resolveWriteBackBranch(ref: string | undefined): string | null {
  const prefix = 'refs/heads/';
  if (!ref || !ref.startsWith(prefix)) return null;
  const branch = ref.slice(prefix.length);
  return branch.length > 0 ? branch : null;
}

export function unsupportedRefMessage(ref: string | undefined): string {
  return [
    `Write-back is on (insert_urls: true) but this run was triggered by "${ref ?? 'unknown ref'}", which is not a branch.`,
    'todo-sync-flow only commits to the branch that triggered the run, so it cannot write back here.',
    `Run it on push events, or set insert_urls: false. See ${WRITE_BACK_DOCS}`,
  ].join(' ');
}

export function preflightFailureMessage(branch: string, detail: string): string {
  const trimmed = detail.trim().split('\n').slice(-3).join(' | ');
  return [
    `Write-back is on (insert_urls: true) but a dry-run push to "${branch}" failed, so no issues were created.`,
    'Usual causes: the job is missing "permissions: contents: write", or actions/checkout ran with persist-credentials: false.',
    `Fix the permission, or set insert_urls: false to run read-only. See ${WRITE_BACK_DOCS}`,
    trimmed ? `Git said: ${trimmed}` : '',
  ].filter(Boolean).join(' ');
}

export function pushFailureMessage(branch: string, detail: string): string {
  const trimmed = detail.trim().split('\n').slice(-3).join(' | ');
  return [
    `Issues were created, but pushing the URL commit to "${branch}" failed.`,
    'Usual causes: branch protection on that branch, or another run pushed first (add a concurrency group).',
    `The created issues are listed in the job summary. See ${WRITE_BACK_DOCS}`,
    trimmed ? `Git said: ${trimmed}` : '',
  ].filter(Boolean).join(' ');
}

/** De-duplicated, order-preserving list of files to stage. */
export function filesToStage(files: string[]): string[] {
  return [...new Set(files.filter(f => f.trim().length > 0))];
}

export interface RunReport {
  writeBack: boolean;
  branch: string | null;
  mode: 'diff' | 'full-scan';
  created: { number: number; url: string; file: string; line: number }[];
  closed: number[];
  filesChanged: string[];
  /** Set when the run stopped early; first sentence of the error. */
  failure?: string;
}

/** Markdown for the job summary: always states the mode and exactly what was changed. */
export function summaryMarkdown(r: RunReport): string {
  const lines: string[] = ['## todo-sync-flow', ''];
  lines.push(`| Setting | Value |`, `|---|---|`);
  lines.push(`| Result | ${r.failure ? `**failed**: ${r.failure}` : 'completed'} |`);
  lines.push(`| Scan mode | ${r.mode} |`);
  lines.push(`| Write-back | ${r.writeBack ? `**on**, commits to \`${r.branch}\`` : 'off (read-only)'} |`);
  lines.push(`| Issues created | ${r.created.length} |`);
  lines.push(`| Issues closed | ${r.closed.length} |`);
  lines.push(`| Files committed | ${r.filesChanged.length} |`);
  if (r.created.length) {
    lines.push('', '### Created');
    for (const c of r.created) lines.push(`- #${c.number} from \`${c.file}:${c.line}\``);
  }
  if (r.closed.length) {
    lines.push('', '### Closed');
    for (const n of r.closed) lines.push(`- #${n}`);
  }
  if (r.filesChanged.length) {
    lines.push('', '### Files committed');
    for (const f of r.filesChanged) lines.push(`- \`${f}\``);
  }
  return lines.join('\n') + '\n';
}
