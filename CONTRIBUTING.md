# Contributing to cecilias-notes-mcp

Thanks for your interest in contributing. This repo is the MCP server
half of [Cecilia's Notes](https://venugopinath.me/cecilias-notes) —
it writes `.inkbook` JSON into the app's iCloud container so any
MCP-compatible AI agent can manage notebooks.

The bar for changes is **small, focused, reviewable, and tested.**

## Ground rules

- The maintainer ([@TheProductArchitect](https://github.com/TheProductArchitect))
  is the sole approver. All non-trivial changes ship via PR.
- All PRs must pass CI (`npm test`) before merge.
- All PRs must receive code-owner approval before merge.
- Force pushes and branch deletion on `main` are disabled.
- The `main` branch has a linear history — please rebase instead of merge.

## Workflow

1. **Open an issue first** for anything beyond a typo or small doc fix.
   This avoids you spending time on a change that won't be accepted.
2. **Fork** the repo and create a feature branch off `main`:
   ```bash
   git checkout -b my-change
   ```
3. **Make the smallest change** that solves the problem. No incidental
   refactors. No unrelated style changes.
4. **Test locally**:
   ```bash
   npm install
   npm test            # builds + runs the stdio smoke test
   ```
5. **Open a PR** against `main`. Fill in the PR template.
6. The maintainer reviews. You may be asked to rebase, reword the
   commit message, or split into multiple PRs.

## Code style

- **TypeScript strict mode.** No new `any` unless absolutely necessary.
- **No new runtime dependencies** without prior discussion. The package
  intentionally has a tiny dependency surface.
- **Validate inputs at the tool boundary** with the existing zod schemas
  in `src/lib/validate.ts`. Generate the JSON Schema from zod via the
  `toolInputSchema()` helper — never hand-write a parallel JSON schema.
- **Atomic file writes** — use the existing `writeJsonAtomic` pattern.
  Never `fs.writeFileSync` directly to the target path.
- **No telemetry, no network calls.** The package is local-only by design.

## Schema / wire format changes

Changes to the `.inkbook` schema or to the Inbox / MCP-mirror file
contract require a paired change in the iPad app's importer. Open
an issue describing the wire-format change first; the maintainer will
coordinate with the app side.

## Commit messages

- Imperative mood, present tense ("Add foo", not "Added foo").
- First line under 72 characters.
- Body explains *why*, not *what* (the diff shows *what*).

## Releases

The maintainer handles versioning and npm publishes. Don't bump the
package version in your PR.

## Code of conduct

By participating you agree to follow the [Code of Conduct](./CODE_OF_CONDUCT.md).

## Security issues

Do **not** open a public issue for a security report. See [SECURITY.md](./SECURITY.md).
