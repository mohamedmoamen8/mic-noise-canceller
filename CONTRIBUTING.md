# Contributing

Thanks for your interest in contributing to Mic Noise Canceller! This document outlines a few guidelines to get you started quickly.

Getting started

1. Fork the repo and create a feature branch from `main` (or `docs/readme-enhancements` for doc edits):

```bash
git clone https://github.com/<your-username>/mic-noise-canceller.git
cd mic-noise-canceller
npm install
```

2. Build and run tests locally:

```bash
npm run build
npm test
```

Code style

- The project uses TypeScript. Keep types strict where practical.
- Run `npm run typecheck` before opening a PR.
- Prefer small, focused commits. Use Conventional Commits for messages (e.g., `feat(...)`, `fix(...)`, `chore(...)`).

Commit message guidance

Use Conventional Commits:

- feat: a new feature
- fix: a bug fix
- docs: changes to documentation
- style: formatting only
- refactor: refactoring without behavior changes
- test: adding/updating tests
- chore: maintenance tasks

Pull request checklist

- [ ] The PR has a descriptive title and description.
- [ ] Changes are covered by tests where appropriate.
- [ ] Type checks pass: `npm run typecheck`.
- [ ] Linting and formatting are applied.
- [ ] The PR targets the appropriate branch and is small and focused.

Development notes

- To iterate quickly, use `npm run watch` during development.
- Builds are written to `dist/`. When loading the unpacked extension in Chrome, point to that directory.
- If you add or change the worklet/WASM files, ensure the extension CSP and manifest are updated accordingly.

Reporting issues

When filing an issue, please include: browser version, steps to reproduce, expected vs actual behavior, and any console logs.
