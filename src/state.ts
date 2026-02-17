/**
 * State tracking via embedded issue URLs.
 *
 * After creating an issue, the URL is appended to the TODO comment:
 *   // TODO: Add rate limiting  →  // TODO: Add rate limiting https://github.com/org/repo/issues/42
 *
 * When that line is later removed, we extract the issue number from the URL
 * to know which issue to close. No external state store required.
 */

/** Extract a GitHub issue number from a line containing an issue URL or short #N reference */
export function extractIssueNumber(line: string, repoUrl: string): number | null {
  // Full URL pattern: https://github.com/org/repo/issues/42
  const escaped = repoUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const urlMatch = line.match(new RegExp(`${escaped}/issues/(\\d+)`));
  if (urlMatch) return parseInt(urlMatch[1], 10);

  // Short reference at end of line: #42
  const shortMatch = line.match(/#(\d+)\s*$/);
  if (shortMatch) return parseInt(shortMatch[1], 10);

  return null;
}

/** Returns true if a line already has an issue URL embedded (skip re-creating) */
export function hasEmbeddedUrl(line: string, repoUrl: string): boolean {
  return line.includes(`${repoUrl}/issues/`);
}
