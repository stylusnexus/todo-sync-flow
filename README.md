# todo-sync-flow

A GitHub Action that converts TODO-style comments into GitHub issues with full lifecycle management.

## What it does

- **Detects** new `TODO`, `FIXME`, `HACK`, `BUG` comments on push
- **Creates** a GitHub issue for each one, with full file path + line number in the title
- **Inserts** the issue URL back into the comment (bidirectional tracking, no external store)
- **Closes** the linked issue automatically when the TODO comment is removed

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
      contents: write
      issues: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 2
      - uses: your-org/todo-sync-flow@v1
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
```

## Inputs

| Input | Default | Description |
|---|---|---|
| `github_token` | required | `GITHUB_TOKEN` or PAT |
| `extra_identifiers` | `'[]'` | JSON array of `{name, label, priority?}` objects |
| `insert_urls` | `'true'` | Commit issue URL back into the comment after creation |
| `close_on_remove` | `'true'` | Close linked issue when TODO is deleted |
| `assignees` | `''` | Comma-separated GitHub usernames |
| `extra_labels` | `''` | Additional labels for every created issue |
| `milestone` | `''` | Milestone number |

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
- uses: your-org/todo-sync-flow@v1
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

The consuming workflow needs:
- `issues: write` — to create/close issues
- `contents: write` — to commit issue URL insertions back into source

> **Important:** Enable "Read and write permissions" for Actions in your repo settings:
> Settings → Actions → General → Workflow permissions
