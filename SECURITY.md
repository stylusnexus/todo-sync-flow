# Security policy

## Reporting a problem

Please report security issues privately through GitHub's [private vulnerability reporting](https://github.com/stylusnexus/todo-sync-flow/security/advisories/new). Do not open a public issue.

We aim to acknowledge reports within 5 business days.

## Supported versions

| Version | Supported |
|---|---|
| 1.1.x (`@v1`) | Yes |
| 1.0.x | No; upgrade to 1.1.x |

## What the action can change

With `insert_urls: 'true'` (the default) the action commits to the branch that triggered the run, staging only files that contain new TODOs. With `insert_urls: 'false'` it never writes to the repository. See [What this action does to your repo](README.md#what-this-action-does-to-your-repo).
