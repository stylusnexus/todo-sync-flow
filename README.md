# todo-sync-flow

[![Version](https://img.shields.io/github/v/tag/stylusnexus/todo-sync-flow?label=version&color=0f1f10)](https://github.com/stylusnexus/todo-sync-flow/tags)
[![License: MIT](https://img.shields.io/badge/license-MIT-0f1f10)](LICENSE)
[![Languages](https://img.shields.io/badge/languages-63-0f1f10)](syntax.json)
[![Guide](https://img.shields.io/badge/guide-stylusnexus.github.io-c6f19d?labelColor=0f1f10)](https://stylusnexus.github.io/todo-sync-flow/)

A GitHub Action that converts TODO-style comments into GitHub issues with full lifecycle management.

## What it does

- **Detects** new `TODO`, `FIXME`, `HACK`, `BUG` comments on push
- **Creates** a GitHub issue for each one, with full file path + line number in the title
- **Inserts** the issue URL back into the comment (bidirectional tracking, no external store)
- **Closes** the linked issue automatically when the TODO comment is removed

## What this action does to your repo

Read this before you add it. By default (`insert_urls: 'true'`) the action **writes to your repository**.

| | Write-back on (default) | Read-only (`insert_urls: 'false'`) |
|---|---|---|
| Creates and closes issues | Yes | Yes |
| Commits to your repo | Yes: appends the issue URL to each new TODO line | Never |
| Which branch | Only the branch whose push triggered the run. Never the default branch unless that is what was pushed | None |
| Which files | Only the files holding the new TODOs. Nothing else is staged | None |
| Commit author and message | `github-actions[bot]`, `chore(todo-sync-flow): insert issue URLs into TODO comments [skip ci]` | None |
| Job permission needed | `contents: write` and `issues: write` | `contents: read` and `issues: write` |
| Closes issues when a TODO is deleted | Yes | Only for TODOs that already carry an issue URL |

**You turn write-back on by granting `contents: write` in your workflow.** Without it the action stops before creating any issue and tells you how to fix it or opt out. It never half-runs.

Every run writes a job summary listing the mode, the branch, the issues created or closed, and every file committed.

Safeguards in write-back mode:
- A dry-run push runs **before** any issue is created, so a missing permission fails cleanly.
- Runs on tags or pull-request refs refuse to write back rather than guess a branch.
- `[skip ci]` stops the URL commit from triggering another run.
- Protected branches reject the push; the run fails with a clear message and the summary lists the issues already created. Use read-only mode on protected branches, or allow `github-actions[bot]` to push.

## Quick start

```yaml
# .github/workflows/todo-sync.yml
name: Sync TODOs to issues

on:
  push:
    branches: [main]

jobs:
  sync:
    runs-on: ubuntu-latest
    permissions:
      contents: write   # turns on write-back: the action commits issue URLs into TODO lines
      issues: write
    concurrency:
      group: todo-sync-${{ github.ref }}
      cancel-in-progress: false   # queue runs so two pushes never race
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 2   # the action diffs against HEAD~1
      - uses: stylusnexus/todo-sync-flow@v1
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
```

### Read-only

No commits to your repo. Issues are still created and closed (closing works only for TODOs that already carry an issue URL).

```yaml
    permissions:
      contents: read
      issues: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 2
      - uses: stylusnexus/todo-sync-flow@v1
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          insert_urls: 'false'
```

## Inputs

| Input | Default | Description |
|---|---|---|
| `github_token` | required | `GITHUB_TOKEN` or PAT |
| `extra_identifiers` | `'[]'` | JSON array of `{name, label, priority?}` objects |
| `insert_urls` | `'true'` | Write-back. Commit the issue URL into each new TODO line, on the triggering branch only. Needs `contents: write`. Set `'false'` for read-only |
| `close_on_remove` | `'true'` | Close linked issue when TODO is deleted |
| `assignees` | `''` | Comma-separated GitHub usernames |
| `extra_labels` | `''` | Additional labels for every created issue |
| `milestone` | `''` | Milestone number |
| `full_scan` | `'false'` | Scan every file, not just the latest diff; creates issues for every unlinked TODO. Useful on first install |

## Built-in identifiers

| Identifier | Label | Priority |
|---|---|---|
| `TODO` | `todo` | normal |
| `FIXME` | `bug` | high |
| `HACK` | `tech-debt` | low |
| `BUG` | `bug` | high |

## Reference syntax

Inside any identifier you can embed refs:

```ts
// TODO(@alice): Assign to alice
// FIXME(!performance): Add extra 'performance' label
// HACK(#42): Related to issue #42
// TODO(@alice,!perf,#42): All three combined
```

## Custom identifiers

```yaml
- uses: stylusnexus/todo-sync-flow@v1
  with:
    github_token: ${{ secrets.GITHUB_TOKEN }}
    extra_identifiers: |
      [
        {"name": "SRD-VIOLATION", "label": "compliance", "priority": "high"},
        {"name": "AI-SAFETY",     "label": "security",   "priority": "high"}
      ]
```

## How state tracking works

No database needed. When an issue is created, the URL is appended directly to the comment:

```ts
// Before: // TODO: Add rate limiting
// After:  // TODO: Add rate limiting  https://github.com/org/repo/issues/42
```

When that line is removed, the action extracts the issue number from the URL and closes it.

## Building

```bash
npm install
npm run build   # compiles src/ → dist/index.js (commit dist/)
npm test        # vitest
```

## Required permissions

Set them on the job, as in the examples above:
- `issues: write`: to create and close issues
- `contents: write`: write-back mode only, to commit issue URLs into source. Use `contents: read` with `insert_urls: 'false'`

A job-level `permissions:` block is enough in most repos. If your organization caps workflow permissions at read-only, an admin has to allow write under Settings → Actions → General → Workflow permissions.

## Security

See [SECURITY.md](SECURITY.md) to report a problem. Pin to a full commit SHA instead of `@v1` if your policy requires it.

## Languages

Comment syntax for 63 languages lives in [`syntax.json`](syntax.json). Add a language by adding an entry there.

## License

[MIT](LICENSE) © 2026 Stylus Nexus
