// @actions/exec is the safe Actions-native equivalent of execFile (array args, no shell injection)
import * as core from '@actions/core';
import * as actionsExec from '@actions/exec';
import * as github from '@actions/github';
import * as fs from 'fs';
import * as path from 'path';
import { buildIdentifiers, identifierForName, type Identifier } from './identifiers';
import { parseDiff, type AddedTodo } from './parser';
import { createIssue, closeIssue } from './github';
import { insertIssueUrl } from './patcher';
import { hasEmbeddedUrl } from './state';

async function getDiff(): Promise<string> {
  let output = '';
  const options = {
    listeners: { stdout: (data: Buffer) => { output += data.toString(); } },
    silent: true,
    ignoreReturnCode: true,
  };

  // Consumer workflows must set fetch-depth: 2 so HEAD~1 exists
  const rc = await actionsExec.exec('git', ['diff', 'HEAD~1', 'HEAD'], options);
  if (rc !== 0 || !output.trim()) {
    core.warning('Could not get diff from HEAD~1 — may be initial commit. Skipping.');
    return '';
  }
  return output;
}

// ---------------------------------------------------------------------------
// Full-scan mode: grep all source files for unlinked TODOs
// ---------------------------------------------------------------------------

const COMMENT_PREFIX_RE = /^\s*(?:\/\/|#|--|;|\*)\s*/;

function scanAllFiles(
  identifiers: Identifier[],
  repoUrl: string,
): AddedTodo[] {
  const identNames = identifiers.map(i => i.name).join('|');
  const todoPattern = new RegExp(
    `(?:${COMMENT_PREFIX_RE.source})(${identNames})(\\([^)]*\\))?\\s*:?\\s*(.+)$`
  );

  const results: AddedTodo[] = [];
  const scanDirs = ['src', 'tests', 'e2e', 'supabase', 'docs'];

  function walkDir(dir: string): void {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === 'dist') continue;
        walkDir(fullPath);
      } else if (/\.(ts|tsx|js|jsx|py|sql|md)$/.test(entry.name)) {
        scanFile(fullPath);
      }
    }
  }

  function scanFile(filePath: string): void {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Skip lines that already have an embedded issue URL
      if (hasEmbeddedUrl('+' + line, repoUrl)) continue;
      // Skip lines that reference an issue number like TODO(#123)
      if (/TODO\(#\d+\)/.test(line)) continue;

      const match = todoPattern.exec(line);
      if (match) {
        const [, identifierName, refPart, title] = match;
        // Collect continuation lines
        let body = '';
        for (let j = i + 1; j < lines.length; j++) {
          const nextLine = lines[j].trimStart();
          if (!/^(?:\/\/|#|--|;|\*)/.test(nextLine)) break;
          if (todoPattern.test(nextLine)) break;
          const text = nextLine.replace(COMMENT_PREFIX_RE, '').trim();
          if (!text) break;
          body += (body ? '\n' : '') + text;
        }

        results.push({
          file: filePath,
          line: i + 1,
          identifier: identifierName,
          title: title.trim(),
          body,
          refs: {},
        });
      }
    }
  }

  for (const dir of scanDirs) {
    walkDir(dir);
  }

  return results;
}

async function commitAndPush(octokit: ReturnType<typeof github.getOctokit>, owner: string, repo: string): Promise<void> {
  const { data: repoData } = await octokit.rest.repos.get({ owner, repo });

  await actionsExec.exec('git', ['config', 'user.name', 'github-actions[bot]']);
  await actionsExec.exec('git', ['config', 'user.email', 'github-actions[bot]@users.noreply.github.com']);
  await actionsExec.exec('git', ['add', '-A']);
  // [skip ci] prevents this commit triggering another workflow run
  await actionsExec.exec('git', ['commit', '-m', 'chore: insert issue URLs into TODO comments [skip ci]']);
  await actionsExec.exec('git', ['push', 'origin', `HEAD:${repoData.default_branch}`]);
}

async function run(): Promise<void> {
  const token = core.getInput('github_token', { required: true });
  const insertUrls = core.getBooleanInput('insert_urls');
  const closeOnRemove = core.getBooleanInput('close_on_remove');
  const fullScan = core.getInput('full_scan') === 'true';
  const extraIdentifiersJson = core.getInput('extra_identifiers');
  const assigneesInput = core.getInput('assignees');
  const extraLabelsInput = core.getInput('extra_labels');
  const milestoneInput = core.getInput('milestone');

  const octokit = github.getOctokit(token);
  const { owner, repo } = github.context.repo;
  const repoUrl = `https://github.com/${owner}/${repo}`;

  const identifiers = buildIdentifiers(extraIdentifiersJson);
  const globalAssignees = assigneesInput
    ? assigneesInput.split(',').map(s => s.trim()).filter(Boolean)
    : [];
  const extraLabels = extraLabelsInput
    ? extraLabelsInput.split(',').map(s => s.trim()).filter(Boolean)
    : [];
  const milestone = milestoneInput ? parseInt(milestoneInput, 10) : undefined;

  core.info(`Identifiers: ${identifiers.map(i => i.name).join(', ')}`);
  core.info(`Mode: ${fullScan ? 'FULL SCAN' : 'diff-based'}`);

  let added: AddedTodo[];
  let removed: { file: string; identifier: string; issueNumber: number | null }[] = [];

  if (fullScan) {
    // Full scan: walk all source files for unlinked TODOs
    added = scanAllFiles(identifiers, repoUrl);
    core.info(`Full scan found ${added.length} unlinked TODO(s)`);
  } else {
    // Diff-based: only process changes in the last commit
    const diff = await getDiff();
    if (!diff) return;
    const parsed = parseDiff(diff, identifiers, repoUrl);
    added = parsed.added;
    removed = parsed.removed;
    core.info(`Found ${added.length} new TODO(s), ${removed.length} removed TODO(s)`);
  }

  // --- Create issues for new TODOs ---
  let urlsInserted = false;

  for (const todo of added) {
    const identifier = identifierForName(todo.identifier, identifiers);
    if (!identifier) continue;

    core.info(`Creating issue: ${todo.identifier} in ${todo.file}:${todo.line}`);
    const issue = await createIssue(octokit, {
      todo,
      identifier,
      repoOwner: owner,
      repoName: repo,
      globalAssignees,
      extraLabels,
      milestone,
    });
    core.info(`Created #${issue.number}: ${issue.html_url}`);

    if (insertUrls) {
      insertIssueUrl(todo.file, todo.line, issue.html_url);
      urlsInserted = true;
    }
  }

  if (insertUrls && urlsInserted) {
    core.info('Committing URL insertions...');
    await commitAndPush(octokit, owner, repo);
  }

  // --- Close issues for removed TODOs (diff mode only) ---
  if (closeOnRemove && !fullScan) {
    for (const removedTodo of removed) {
      if (!removedTodo.issueNumber) {
        core.debug(`No linked issue for removed ${removedTodo.identifier} in ${removedTodo.file}`);
        continue;
      }
      core.info(`Closing #${removedTodo.issueNumber} (TODO removed from ${removedTodo.file})`);
      await closeIssue(octokit, owner, repo, removedTodo.issueNumber, removedTodo.file);
    }
  }

  core.info('todo-sync-flow complete.');
}

run().catch(err => core.setFailed(err instanceof Error ? err.message : String(err)));
