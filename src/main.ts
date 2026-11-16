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
import {
  COMMIT_MESSAGE,
  filesToStage,
  preflightFailureMessage,
  pushFailureMessage,
  resolveWriteBackBranch,
  summaryMarkdown,
  unsupportedRefMessage,
  type RunReport,
} from './writeback';

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

async function gitCapture(args: string[]): Promise<{ rc: number; out: string }> {
  let out = '';
  const rc = await actionsExec.exec('git', args, {
    ignoreReturnCode: true,
    silent: true,
    listeners: {
      stdout: (d: Buffer) => { out += d.toString(); },
      stderr: (d: Buffer) => { out += d.toString(); },
    },
  });
  return { rc, out };
}

/** Dry-run push: proves the token can write to the branch before any issue is created. */
async function preflightPush(branch: string): Promise<void> {
  const { rc, out } = await gitCapture(['push', '--dry-run', 'origin', `HEAD:refs/heads/${branch}`]);
  if (rc !== 0) throw new Error(preflightFailureMessage(branch, out));
}

/** Stages only the files this run patched and pushes them to the triggering branch. */
async function commitAndPush(files: string[], branch: string): Promise<void> {
  await actionsExec.exec('git', ['config', 'user.name', 'github-actions[bot]']);
  await actionsExec.exec('git', ['config', 'user.email', 'github-actions[bot]@users.noreply.github.com']);
  await actionsExec.exec('git', ['add', '--', ...files]);
  // [skip ci] prevents this commit triggering another workflow run
  await actionsExec.exec('git', ['commit', '-m', COMMIT_MESSAGE]);
  const { rc, out } = await gitCapture(['push', 'origin', `HEAD:refs/heads/${branch}`]);
  if (rc !== 0) throw new Error(pushFailureMessage(branch, out));
}

async function run(): Promise<void> {
  const token = core.getInput('github_token', { required: true });
  core.setSecret(token); // mask a PAT in logs; GITHUB_TOKEN is already masked by the runner
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

  const report: RunReport = {
    writeBack: insertUrls,
    branch: null,
    mode: fullScan ? 'full-scan' : 'diff',
    created: [],
    closed: [],
    filesChanged: [],
  };

  try {
    // --- Write-back preflight: before any issue exists, prove we can push ---
    let branch: string | null = null;
    if (insertUrls && added.length > 0) {
      branch = resolveWriteBackBranch(github.context.ref);
      if (!branch) throw new Error(unsupportedRefMessage(github.context.ref));
      report.branch = branch;
      core.notice(
        `Write-back is ON: this run will commit issue URLs into ${added.length} TODO comment(s) ` +
        `on branch "${branch}" as github-actions[bot]. Set insert_urls: false to run read-only.`,
      );
      await preflightPush(branch);
    } else if (!insertUrls) {
      core.info('Write-back is OFF (insert_urls: false): no commits will be made. close_on_remove only works for TODOs that already carry an issue URL.');
    }

    // --- Create issues for new TODOs ---
    const patched: string[] = [];

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
      report.created.push({ number: issue.number, url: issue.html_url, file: todo.file, line: todo.line });

      if (insertUrls) {
        insertIssueUrl(todo.file, todo.line, issue.html_url);
        patched.push(todo.file);
      }
    }

    const files = filesToStage(patched);
    if (insertUrls && branch && files.length > 0) {
      core.info(`Committing URL insertions to ${files.length} file(s) on ${branch}...`);
      await commitAndPush(files, branch);
      report.filesChanged = files;
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
        report.closed.push(removedTodo.issueNumber);
      }
    }

    core.info('todo-sync-flow complete.');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    report.failure = msg.split('. ')[0];
    throw err;
  } finally {
    await core.summary.addRaw(summaryMarkdown(report)).write().catch(() => undefined);
  }
}

run().catch(err => core.setFailed(err instanceof Error ? err.message : String(err)));
