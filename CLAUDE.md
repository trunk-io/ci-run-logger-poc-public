# CI Run Logger Action

POC GitHub Action that logs CI run fields (job name, SHA, attempt, timestamps, etc.)
to stdout to validate field availability for the CI Flake Detection data model.

See: https://github.com/trunk-io/trunk2/blob/main/docs/prd/ci-flake-detection.md (Risk #2)
Design: https://github.com/trunk-io/trunk2/blob/main/docs/plans/2026-04-23-ci-run-logger-poc-design.md

## Build

Run `npm install` then `npm run build` to regenerate `dist/`.
Always commit `dist/` after rebuilding — GitHub executes the committed bundles.
