import { describe, it, expect } from 'vitest';
import { parseDiff, buildIdentifierPattern } from '../src/parser';
import { DEFAULT_IDENTIFIERS, buildIdentifiers } from '../src/identifiers';

const REPO_URL = 'https://github.com/test-org/test-repo';

function makeDiff(file: string, added: string[], removed: string[] = []): string {
  const plus = added.map(l => `+${l}`).join('\n');
  const minus = removed.map(l => `-${l}`).join('\n');
  return [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -1,${removed.length} +1,${added.length} @@`,
    minus,
    plus,
  ].filter(Boolean).join('\n');
}

describe('buildIdentifierPattern', () => {
  it('matches // (JS/TS/Go/Rust)', () => {
    const p = buildIdentifierPattern(DEFAULT_IDENTIFIERS);
    expect(p.test('+  // TODO: Add rate limiting')).toBe(true);
  });

  it('matches # (Python/Shell/Ruby/YAML)', () => {
    const p = buildIdentifierPattern(DEFAULT_IDENTIFIERS);
    expect(p.test('+# FIXME: broken null check')).toBe(true);
  });

  it('matches -- (SQL/Lua/Haskell)', () => {
    const p = buildIdentifierPattern(DEFAULT_IDENTIFIERS);
    expect(p.test('+  -- HACK: workaround for slow query')).toBe(true);
  });

  it('matches /* (CSS/block comment start)', () => {
    const p = buildIdentifierPattern(DEFAULT_IDENTIFIERS);
    expect(p.test('+  /* TODO: block comment')).toBe(true);
  });

  it('matches <!-- (HTML/XML/Markdown)', () => {
    const p = buildIdentifierPattern(DEFAULT_IDENTIFIERS);
    expect(p.test('+ <!-- TODO: fix layout -->')).toBe(true);
  });

  it('matches ; (AutoHotkey)', () => {
    const p = buildIdentifierPattern(DEFAULT_IDENTIFIERS);
    expect(p.test('+; TODO: AutoHotkey comment')).toBe(true);
  });

  it('matches %% (TeX)', () => {
    const p = buildIdentifierPattern(DEFAULT_IDENTIFIERS);
    expect(p.test('+% TODO: TeX comment')).toBe(true);
  });

  it("matches ' (VBA)", () => {
    const p = buildIdentifierPattern(DEFAULT_IDENTIFIERS);
    expect(p.test("+'  TODO: VBA comment")).toBe(true);
  });

  it('does NOT match a context line (no leading +)', () => {
    const p = buildIdentifierPattern(DEFAULT_IDENTIFIERS);
    expect(p.test('  // TODO: something')).toBe(false);
  });

  it('captures identifier name, refs, and title', () => {
    const p = buildIdentifierPattern(DEFAULT_IDENTIFIERS);
    const match = p.exec('+  // TODO(@alice,!perf): Add caching');
    expect(match).not.toBeNull();
    expect(match![1]).toBe('TODO');
    expect(match![2]).toContain('@alice');
    expect(match![3].trim()).toBe('Add caching');
  });
});

describe('parseDiff — added TODOs', () => {
  it('extracts a single TODO', () => {
    const diff = makeDiff('src/api/route.ts', ['// TODO: Add rate limiting']);
    const { added } = parseDiff(diff, DEFAULT_IDENTIFIERS, REPO_URL);
    expect(added).toHaveLength(1);
    expect(added[0].title).toBe('Add rate limiting');
    expect(added[0].identifier).toBe('TODO');
    expect(added[0].file).toBe('src/api/route.ts');
  });

  it('extracts multi-line TODO body from consecutive comment lines', () => {
    const diff = makeDiff('src/foo.ts', [
      '// TODO: Add rate limiting',
      '// This needs to happen before launch',
      '// See issue tracker for details',
    ]);
    const { added } = parseDiff(diff, DEFAULT_IDENTIFIERS, REPO_URL);
    expect(added).toHaveLength(1);
    expect(added[0].body).toContain('This needs to happen before launch');
    expect(added[0].body).toContain('See issue tracker for details');
  });

  it('parses @assignee ref', () => {
    const diff = makeDiff('src/foo.ts', ['// TODO(@bob): Fix this']);
    const { added } = parseDiff(diff, DEFAULT_IDENTIFIERS, REPO_URL);
    expect(added[0].refs.assignee).toBe('bob');
  });

  it('parses !label ref', () => {
    const diff = makeDiff('src/foo.ts', ['// TODO(!perf): Optimize loop']);
    const { added } = parseDiff(diff, DEFAULT_IDENTIFIERS, REPO_URL);
    expect(added[0].refs.label).toBe('perf');
  });

  it('skips lines that already have an embedded issue URL', () => {
    const diff = makeDiff('src/foo.ts', [
      `// TODO: Already tracked  ${REPO_URL}/issues/5`,
    ]);
    const { added } = parseDiff(diff, DEFAULT_IDENTIFIERS, REPO_URL);
    expect(added).toHaveLength(0);
  });

  it('handles multiple TODOs in the same diff', () => {
    const diff = makeDiff('src/foo.ts', [
      '// TODO: First thing',
      'const x = 1;',
      '// FIXME: Second thing',
    ]);
    const { added } = parseDiff(diff, DEFAULT_IDENTIFIERS, REPO_URL);
    expect(added).toHaveLength(2);
  });
});

describe('parseDiff — removed TODOs', () => {
  it('extracts issue number from embedded URL in removed line', () => {
    const diff = makeDiff('src/foo.ts', [], [`// TODO: Old thing  ${REPO_URL}/issues/42`]);
    const { removed } = parseDiff(diff, DEFAULT_IDENTIFIERS, REPO_URL);
    expect(removed).toHaveLength(1);
    expect(removed[0].issueNumber).toBe(42);
  });

  it('returns null issueNumber when removed TODO has no URL', () => {
    const diff = makeDiff('src/foo.ts', [], ['// TODO: No URL here']);
    const { removed } = parseDiff(diff, DEFAULT_IDENTIFIERS, REPO_URL);
    expect(removed[0].issueNumber).toBeNull();
  });
});

describe('parseDiff — extra identifiers', () => {
  it('detects a custom identifier', () => {
    const identifiers = buildIdentifiers('[{"name":"SRD-VIOLATION","label":"compliance"}]');
    const diff = makeDiff('src/npc.ts', ['// SRD-VIOLATION: Uses Beholder reference']);
    const { added } = parseDiff(diff, identifiers, REPO_URL);
    expect(added).toHaveLength(1);
    expect(added[0].identifier).toBe('SRD-VIOLATION');
  });
});
