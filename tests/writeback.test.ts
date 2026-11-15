import { describe, it, expect } from 'vitest';
import {
  filesToStage,
  preflightFailureMessage,
  pushFailureMessage,
  resolveWriteBackBranch,
  summaryMarkdown,
  unsupportedRefMessage,
  WRITE_BACK_DOCS,
} from '../src/writeback';

describe('resolveWriteBackBranch', () => {
  it('returns the branch that triggered a push', () => {
    expect(resolveWriteBackBranch('refs/heads/main')).toBe('main');
    expect(resolveWriteBackBranch('refs/heads/develop')).toBe('develop');
    expect(resolveWriteBackBranch('refs/heads/feature/a-b')).toBe('feature/a-b');
  });

  it('never falls back to another branch for non-branch refs', () => {
    expect(resolveWriteBackBranch('refs/tags/v1.0.0')).toBeNull();
    expect(resolveWriteBackBranch('refs/pull/12/merge')).toBeNull();
    expect(resolveWriteBackBranch('refs/heads/')).toBeNull();
    expect(resolveWriteBackBranch('')).toBeNull();
    expect(resolveWriteBackBranch(undefined)).toBeNull();
  });
});

describe('filesToStage', () => {
  it('stages only patched files, once each, in order', () => {
    expect(filesToStage(['src/a.ts', 'src/b.ts', 'src/a.ts', ''])).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('stages nothing when nothing was patched', () => {
    expect(filesToStage([])).toEqual([]);
  });
});

describe('failure messages', () => {
  it('preflight message names the fix, the opt-out and the docs', () => {
    const m = preflightFailureMessage('main', 'remote: Permission denied\nfatal: unable to access');
    expect(m).toContain('no issues were created');
    expect(m).toContain('contents: write');
    expect(m).toContain('insert_urls: false');
    expect(m).toContain(WRITE_BACK_DOCS);
    expect(m).toContain('Permission denied');
  });

  it('push message points at protection and concurrency', () => {
    const m = pushFailureMessage('main', 'protected branch hook declined');
    expect(m).toContain('branch protection');
    expect(m).toContain('concurrency');
  });

  it('unsupported ref message explains the branch rule', () => {
    expect(unsupportedRefMessage('refs/pull/3/merge')).toContain('refs/pull/3/merge');
  });
});

describe('summaryMarkdown', () => {
  it('states read-only mode plainly', () => {
    const md = summaryMarkdown({ writeBack: false, branch: null, mode: 'diff', created: [], closed: [], filesChanged: [] });
    expect(md).toContain('off (read-only)');
    expect(md).toContain('| Files committed | 0 |');
  });

  it('lists the branch, issues and files when write-back ran', () => {
    const md = summaryMarkdown({
      writeBack: true,
      branch: 'develop',
      mode: 'diff',
      created: [{ number: 7, url: 'https://github.com/o/r/issues/7', file: 'src/a.ts', line: 3 }],
      closed: [4],
      filesChanged: ['src/a.ts'],
    });
    expect(md).toContain('**on**, commits to `develop`');
    expect(md).toContain('- #7 from `src/a.ts:3`');
    expect(md).toContain('- #4');
    expect(md).toContain('- `src/a.ts`');
  });
});
