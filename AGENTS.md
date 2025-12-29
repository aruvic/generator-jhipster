# Repository Guidelines

## Project Structure & Module Organization
- Root contains generator sources (`generators/`), shared utilities (`lib/`, `types/`), CLI entrypoints (`bin/`, `cli/`), and tests (`test/`). Build artifacts land in `dist/` after compilation; `target/` is only for transient test output.
- Templates live under `generators/**/templates/` (Java, TS, EJS) and are copied verbatim to generated apps. Keep template changes minimal and generic.
- Specs and helper types sit in `types/` and `lib/`; avoid duplicating logic that already exists there.

## Build, Test, and Development Commands
- Install deps: `npm install`.
- Build generator: `npm run build` (runs `tsc`, copies templates/types, fixes CLI bin).
- Lint and format checks: `npm run lint` (ESLint + ejslint), `npm run prettier:check`.
- Type checks: `npm run check-types`.
- Run tests: `npm test` (mocha suite over generators/cli). Update snapshots with `npm run update-snapshots`.
- Clean artifacts: `npm run clean`.

## Coding Style & Naming Conventions
- TypeScript + EJS templates: prefer explicit types and small helpers in `lib/`; avoid reflection/magic. Keep templates ASCII and narrow changes to the smallest scope.
- Use ESLint defaults from repo; 2-space indentation in TS/JS, standard Java formatting in templates (prettier-plugin-java).
- Template variables use `<% %>`/`<%= %>`; avoid inline logic when a helper exists.
- DTO/mapper helpers should be pure and side-effect free; name methods with clear intent (`toX`, `updateX`, `createX`).

## Testing Guidelines
- Add/adjust unit tests in `test/` when changing generators or helpers; prefer fixture-based assertions rather than large snapshot churn.
- For template regressions, add focused tests that assert generated snippets (use existing helpers in `test/utils`).
- Validate type safety with `npm run check-types` before opening a PR.

## Commit & Pull Request Guidelines
- Commit messages: short imperative summaries (e.g., “Fix polymorphic mapper unwrap”). Keep unrelated changes split into separate commits.
- PRs should describe the generator behavior change, affected blueprints/templates, and include before/after notes or links to failing scenarios. Mention added tests and manual verification steps (`npm run build`, targeted generated app checks).
- Cross-link related issues or RFEs; attach screenshots only when touching docs or rendered outputs.

## Security & Configuration Tips
- Do not add runtime network calls in templates or helper code. Keep dev-time tooling pinned via package-lock.json.
- Avoid writing outside the workspace in generators; paths should resolve through the provided context and `this.destinationPath`.
- Secrets are never needed here; strip placeholders from tests and fixtures.***
