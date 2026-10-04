## What and why

<!-- One or two sentences. Link the issue if there is one. -->

## Analysis impact

- [ ] No change to engine conclusions (findings, severities, trust, coverage)
- [ ] Changes engine conclusions: the affected scenarios and `fixtures/expected/*.json` are updated, and the reason is explained above

## Checklist

- [ ] `npm run verify` passes (lint, typecheck, tests, build)
- [ ] `npm run fixtures:check` passes
- [ ] New behaviour has tests; a fixed false negative has a regression fixture
- [ ] Untrusted input (project files, manifests, file names) is validated, size-bounded and never used as a path
- [ ] No real plant data, credentials or customer names in code, fixtures or screenshots
