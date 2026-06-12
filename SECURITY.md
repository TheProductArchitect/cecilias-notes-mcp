# Security Policy

## Supported versions

Only the latest published version on npm is supported.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for a security report.

Email the maintainer at **nvg1996@gmail.com** with:

- A description of the issue and its potential impact.
- Steps to reproduce, or a minimal proof of concept.
- Affected versions, if known.

You will receive an acknowledgement within 72 hours. Verified issues
will be fixed and disclosed via a patched npm release; reporters who
wish to be credited will be named in the release notes.

## Scope

This package is a local-only macOS stdio MCP server. The most
plausible attack surfaces are:

- Malformed tool inputs that crash the server or write outside the
  iCloud container.
- Crafted `.inkbook` files that break the parser.

Out of scope:

- Issues that require physical access to the user's Mac.
- iOS / iPadOS app vulnerabilities — please report those via the
  [Cecilia's Notes project page](https://venugopinath.me/cecilias-notes).
