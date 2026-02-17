import * as fs from 'fs';

/**
 * Appends an issue URL to the TODO comment at the given line in a source file.
 *
 * Before: // TODO: Add rate limiting
 * After:  // TODO: Add rate limiting https://github.com/org/repo/issues/42
 */
export function insertIssueUrl(filePath: string, lineNumber: number, issueUrl: string): void {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  const idx = lineNumber - 1; // convert 1-indexed to 0-indexed
  if (idx < 0 || idx >= lines.length) {
    throw new Error(`Line ${lineNumber} out of range in ${filePath} (${lines.length} lines)`);
  }

  // Idempotent: don't insert again if URL is already present
  if (lines[idx].includes(issueUrl)) return;

  lines[idx] = lines[idx].trimEnd() + '  ' + issueUrl;
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
}
