import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { insertIssueUrl } from '../src/patcher';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-sync-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function write(name: string, content: string): string {
  const filePath = path.join(tmpDir, name);
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

describe('insertIssueUrl', () => {
  it('appends the URL to the correct line', () => {
    const file = write('foo.ts', 'const x = 1;\n// TODO: Add rate limiting\nconst y = 2;');
    insertIssueUrl(file, 2, 'https://github.com/org/repo/issues/42');
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    expect(lines[1]).toBe('// TODO: Add rate limiting  https://github.com/org/repo/issues/42');
    expect(lines[0]).toBe('const x = 1;');
    expect(lines[2]).toBe('const y = 2;');
  });

  it('is idempotent — does not insert the URL a second time', () => {
    const url = 'https://github.com/org/repo/issues/42';
    const file = write('foo.ts', `// TODO: thing  ${url}`);
    insertIssueUrl(file, 1, url);
    const content = fs.readFileSync(file, 'utf8');
    expect(content.split(url)).toHaveLength(2); // exactly one occurrence
  });

  it('throws when line number is out of range', () => {
    const file = write('foo.ts', 'const x = 1;\n');
    expect(() => insertIssueUrl(file, 99, 'https://github.com/org/repo/issues/1')).toThrow();
  });
});
