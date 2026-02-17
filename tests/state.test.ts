import { describe, it, expect } from 'vitest';
import { extractIssueNumber, hasEmbeddedUrl } from '../src/state';

const REPO_URL = 'https://github.com/test-org/test-repo';

describe('extractIssueNumber', () => {
  it('extracts from a full GitHub issue URL', () => {
    const line = `// TODO: thing  ${REPO_URL}/issues/42`;
    expect(extractIssueNumber(line, REPO_URL)).toBe(42);
  });

  it('extracts from a short #N reference', () => {
    const line = '// FIXME: broken thing #99';
    expect(extractIssueNumber(line, REPO_URL)).toBe(99);
  });

  it('returns null when no reference found', () => {
    const line = '// TODO: no link here';
    expect(extractIssueNumber(line, REPO_URL)).toBeNull();
  });

  it('does not match a different repo URL', () => {
    const line = '// TODO: thing  https://github.com/other-org/other-repo/issues/5';
    expect(extractIssueNumber(line, REPO_URL)).toBeNull();
  });
});

describe('hasEmbeddedUrl', () => {
  it('returns true when issue URL is present', () => {
    expect(hasEmbeddedUrl(`// TODO: x  ${REPO_URL}/issues/1`, REPO_URL)).toBe(true);
  });

  it('returns false when no URL present', () => {
    expect(hasEmbeddedUrl('// TODO: no url', REPO_URL)).toBe(false);
  });
});
