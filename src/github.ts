import * as github from '@actions/github';
import * as core from '@actions/core';
import { AddedTodo } from './parser';
import { Identifier, LABEL_COLORS } from './identifiers';

type Octokit = ReturnType<typeof github.getOctokit>;

export interface CreateIssueParams {
  todo: AddedTodo;
  identifier: Identifier;
  repoOwner: string;
  repoName: string;
  globalAssignees: string[];
  extraLabels: string[];
  milestone: number | undefined;
}

export interface CreatedIssue {
  number: number;
  html_url: string;
}

/** Ensure a label exists in the repo; create it if not. */
async function ensureLabel(
  octokit: Octokit,
  owner: string,
  repo: string,
  label: string,
): Promise<void> {
  try {
    await octokit.rest.issues.getLabel({ owner, repo, name: label });
  } catch {
    const color = LABEL_COLORS[label] ?? 'ededed';
    try {
      await octokit.rest.issues.createLabel({ owner, repo, name: label, color });
    } catch (err) {
      // Label may have been created by a concurrent run — ignore conflict errors
      core.debug(`Label creation skipped (may already exist): ${label}`);
    }
  }
}

export async function createIssue(
  octokit: Octokit,
  params: CreateIssueParams,
): Promise<CreatedIssue> {
  const { todo, identifier, repoOwner, repoName, globalAssignees, extraLabels, milestone } = params;

  const labels = [identifier.label, ...extraLabels];
  if (todo.refs.label) labels.push(todo.refs.label);

  // Ensure all labels exist before assigning them
  for (const label of labels) {
    await ensureLabel(octokit, repoOwner, repoName, label);
  }

  const assignees = [...globalAssignees];
  if (todo.refs.assignee) assignees.push(todo.refs.assignee);

  const bodyParts: string[] = [];
  if (todo.body) bodyParts.push(todo.body);
  bodyParts.push('');
  bodyParts.push(`---`);
  bodyParts.push(`**File:** \`${todo.file}\` (line ${todo.line})`);
  bodyParts.push(`**Identifier:** \`${todo.identifier}\``);
  if (todo.refs.parent) bodyParts.push(`**Related issue:** #${todo.refs.parent}`);
  bodyParts.push('');
  bodyParts.push('_This issue was automatically created by [todo-sync-flow](https://github.com/your-org/todo-sync-flow)._');

  const { data } = await octokit.rest.issues.create({
    owner: repoOwner,
    repo: repoName,
    title: `${todo.identifier}: ${todo.title} [${todo.file}:${todo.line}]`,
    body: bodyParts.join('\n'),
    labels,
    assignees: assignees.length > 0 ? assignees : undefined,
    milestone: milestone ?? undefined,
  });

  return { number: data.number, html_url: data.html_url };
}

export async function closeIssue(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
  filePath: string,
): Promise<void> {
  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body: `Closing: the \`TODO\` comment in \`${filePath}\` was removed.\n\n_Automated by [todo-sync-flow](https://github.com/your-org/todo-sync-flow)._`,
  });

  await octokit.rest.issues.update({
    owner,
    repo,
    issue_number: issueNumber,
    state: 'closed',
    state_reason: 'completed',
  });
}
