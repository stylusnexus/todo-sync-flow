import { Identifier } from './identifiers';
import { extractIssueNumber, hasEmbeddedUrl } from './state';
import syntaxData from '../syntax.json';

export interface TodoRefs {
  assignee?: string;  // @username  syntax inside parens
  label?: string;     // !label     syntax inside parens
  parent?: number;    // #123       syntax inside parens
}

export interface AddedTodo {
  file: string;
  line: number;       // 1-indexed line number in the new file
  identifier: string;
  title: string;
  body: string;       // multi-line continuation text
  refs: TodoRefs;
}

export interface RemovedTodo {
  file: string;
  identifier: string;
  issueNumber: number | null;
}

// ---------------------------------------------------------------------------
// Regex construction
// ---------------------------------------------------------------------------

/**
 * Builds a regex that matches a TODO-style comment line from a git diff.
 *
 * The line starts with '+' (diff prefix), followed by optional whitespace,
 * then a language comment prefix, then the identifier, optional refs in
 * parens, optional colon, and the title text.
 *
 * TODO: implement this — see guidance below
 * https://github.com/your-org/todo-sync-flow/issues/1
 *
 * @param identifiers - list of identifiers to match (TODO, FIXME, etc.)
 * @returns RegExp with capture groups: (identifierName, refString|undefined, title)
 *
 * Guidance:
 *   - Diff added lines start with '+' followed by the actual file content
 *   - Comment prefixes to support: '//' '#' '--' '*' ';'
 *   - Identifier is one of the names joined with '|'
 *   - Optional refs in parens: '(@user, !label, #123)' — capture the inner string
 *   - Optional ':' separator between identifier and title
 *   - Title is the remaining non-empty text on the line
 *
 * Example matches:
 *   +  // TODO(@alice): Add rate limiting
 *   +# FIXME: broken null check
 *   +  -- HACK(!perf): workaround for slow query
 */
/** Collect all unique comment-start patterns from syntax.json, longest first. */
function getCommentPatterns(): string[] {
  const seen = new Set<string>();
  const patterns: string[] = [];

  for (const entry of syntaxData) {
    for (const marker of entry.markers) {
      const pat = typeof marker.pattern === 'string'
        ? marker.pattern
        : marker.pattern.start;
      if (!seen.has(pat)) {
        seen.add(pat);
        patterns.push(pat);
      }
    }
  }

  // Sort longest-first so more specific patterns take regex priority
  return patterns.sort((a, b) => b.length - a.length);
}

/**
 * Builds a regex matching TODO-style comment lines from a git diff.
 *
 * Capture groups:
 *   [1] identifier name  (TODO, FIXME, SRD-VIOLATION, …)
 *   [2] refs string      ((@alice,!perf)) — includes parens, or undefined
 *   [3] title text
 *
 * Pattern logic:
 *   ^  +  <whitespace>  <comment-prefix>  <whitespace>  IDENTIFIER  (refs)?  :?  title  $
 */
export function buildIdentifierPattern(identifiers: Identifier[]): RegExp {
  const names = identifiers.map(i => i.name).join('|');
  const prefixes = getCommentPatterns().map(p => `(?:${p})`).join('|');
  return new RegExp(`^\\+\\s*(?:${prefixes})\\s*(${names})(\\([^)]*\\))?\\s*:?\\s*(.+)$`);
}

// ---------------------------------------------------------------------------
// Ref parsing
// ---------------------------------------------------------------------------

function parseRefs(refString: string | undefined): TodoRefs {
  if (!refString) return {};
  const refs: TodoRefs = {};
  for (const part of refString.split(',').map(s => s.trim())) {
    if (part.startsWith('@')) refs.assignee = part.slice(1);
    else if (part.startsWith('!')) refs.label = part.slice(1);
    else if (part.startsWith('#')) refs.parent = parseInt(part.slice(1), 10);
  }
  return refs;
}

// ---------------------------------------------------------------------------
// Hunk header parsing
// ---------------------------------------------------------------------------

function parseHunkHeader(line: string): { newStart: number } | null {
  // Format: @@ -oldStart[,oldCount] +newStart[,newCount] @@ optional context
  const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
  if (!match) return null;
  return { newStart: parseInt(match[1], 10) };
}

// ---------------------------------------------------------------------------
// Continuation detection
// ---------------------------------------------------------------------------

function isContinuationLine(line: string, identPattern: RegExp): boolean {
  if (!line.startsWith('+')) return false;
  const content = line.slice(1).trimStart();
  // Must be a comment line...
  if (!/^(\/\/|#|--|;|\*)/.test(content)) return false;
  // ...but must NOT start a new identifier
  return !identPattern.test(line);
}

function extractContinuationText(line: string): string {
  return line.slice(1).replace(/^\s*(?:\/\/|#|--|;|\*)\s*/, '').trim();
}

// ---------------------------------------------------------------------------
// Main diff parser
// ---------------------------------------------------------------------------

function flush(pending: AddedTodo | null, added: AddedTodo[]): null {
  if (pending) added.push(pending);
  return null;
}

export function parseDiff(
  diff: string,
  identifiers: Identifier[],
  repoUrl: string,
): { added: AddedTodo[]; removed: RemovedTodo[] } {
  const added: AddedTodo[] = [];
  const removed: RemovedTodo[] = [];

  const identPattern = buildIdentifierPattern(identifiers);
  const identNames = identifiers.map(i => i.name).join('|');
  const removedIdentPattern = new RegExp(`(${identNames})`);

  let currentFile = '';
  let currentLine = 0;
  let pending: AddedTodo | null = null;

  for (const line of diff.split('\n')) {
    // New file
    if (line.startsWith('+++ b/')) {
      pending = flush(pending, added);
      currentFile = line.slice(6);
      continue;
    }

    // Skip file header lines
    if (line.startsWith('diff ') || line.startsWith('--- ') || line.startsWith('index ')) {
      continue;
    }

    // Hunk header — update line counter
    if (line.startsWith('@@')) {
      pending = flush(pending, added);
      const hunk = parseHunkHeader(line);
      if (hunk) currentLine = hunk.newStart;
      continue;
    }

    // Removed line
    if (line.startsWith('-')) {
      pending = flush(pending, added);
      const identMatch = line.match(removedIdentPattern);
      if (identMatch) {
        removed.push({
          file: currentFile,
          identifier: identMatch[1],
          issueNumber: extractIssueNumber(line, repoUrl),
        });
      }
      continue;
    }

    // Added line
    if (line.startsWith('+')) {
      // Continuation of the current pending TODO?
      if (pending && isContinuationLine(line, identPattern)) {
        const text = extractContinuationText(line);
        if (text) pending.body += (pending.body ? '\n' : '') + text;
        currentLine++;
        continue;
      }

      pending = flush(pending, added);

      // Skip lines that already have an embedded URL (action already ran on this TODO)
      if (hasEmbeddedUrl(line, repoUrl)) {
        currentLine++;
        continue;
      }

      const match = identPattern.exec(line);
      if (match) {
        const [, identifierName, refPart, title] = match;
        pending = {
          file: currentFile,
          line: currentLine,
          identifier: identifierName,
          title: title.trim(),
          body: '',
          refs: parseRefs(refPart?.slice(1, -1)), // strip surrounding parens
        };
      }

      currentLine++;
      continue;
    }

    // Context line (space-prefixed in unified diff)
    pending = flush(pending, added);
    currentLine++;
  }

  flush(pending, added);
  return { added, removed };
}
