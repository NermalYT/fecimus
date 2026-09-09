# Contributing to Fecimus

Contributions should make local tool use more reliable, understandable, and economical. Report reproducible failures, improve documentation, or submit focused pull requests.

## Project scope

The platform targets are Ubuntu LTS and Ubuntu LTS based distributions such as Linux Mint XFCE, plus Windows 11 Pro through WSL2 running a supported Ubuntu LTS distribution. Consult the README for current validation status. Native Windows desktop automation is outside this architecture. A platform target is not evidence that a release has been tested there.

Models must work with their host application's tool calling implementation. A model listing does not promise reliable tool use, and screenshot interpretation additionally requires a compatible vision model and host.

## Development

1. Fork and clone the repository, then follow the README installation instructions.
2. Make a branch for one change. Keep credentials, browser profiles, application state, generated screenshots, and local configuration outside commits.
3. Run the relevant documented checks. Unit tests should use disposable fixtures; integration checks must use a private display and temporary browser profiles.
4. Describe the observed problem, resulting behavior, test command and result, and platforms actually tested in the pull request.

Do not run tests against a personal browsing session or physical desktop. Integration tests may launch processes and write temporary files. Inspect a test before running it with sensitive accounts available.

## Design expectations

- Preserve the human's cursor, keyboard focus, clipboard, and desktop session.
- Keep browser work independent of foreground visibility.
- Validate tool inputs before dispatch and report backend failures accurately.
- After an uncertain result, inspect state before retrying an action; never replay it automatically.
- Keep credentials and private page content out of diagnostics by default.
- Pin dependency versions, document new system requirements, and keep installation reversible.
- Measure performance claims on an identified environment. Include a reproduction rather than a universal guarantee.
- Treat shell and filesystem tools as the user's privileges, not a security sandbox.

Use minimal deterministic regression tests for behavior changes. Documentation-only changes need link and accuracy checks; they do not need artificial tests.

By submitting a contribution, you agree to license your contribution under the repository's MIT license. Respect the [code of conduct](CODE_OF_CONDUCT.md); report vulnerabilities as described in [SECURITY.md](SECURITY.md).
