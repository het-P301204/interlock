# Contributing to INTERLOCK

INTERLOCK tells engineers whether a PLC change weakened a safety function. A wrong "no change" is worse than no tool at all, so contributions are held to one rule above the others: **when INTERLOCK cannot decide, it must say so.** Unknown is reported as unknown, undeclared as undeclared, never as safe.

## Setup

```bash
git clone https://github.com/het-P301204/interlock.git
cd interlock
npm ci                 # Node 24 or later
npm run verify         # lint, typecheck, tests, web build
```

| Task | Command |
|---|---|
| web app (Vite) | `npm run dev` |
| API | `npm run dev:api` |
| tests | `npm test`, or `npx vitest run <path>` |
| end-to-end | `npm run build && npm run test:e2e` |
| lint | `npm run lint` (`npx eslint <paths>` for a subset) |
| typecheck | `npm run typecheck` |
| regenerate fixtures | `npm run fixtures`; check with `npm run fixtures:check` |
| CLI | `npm run interlock -- scenario 04` |

Windows: every task is an npm script; there is no `make`. The commands work in PowerShell, cmd and Git Bash. The repository uses LF line endings (`.gitattributes`); configure your editor accordingly.

## Repository layout

```
packages/core   the engine: model, xml, adapters, logic, analysis, report, util
apps/web        React review workstation (engine in a Web Worker)
apps/api        Hono REST API (engine in worker threads, node:sqlite)
apps/cli        command line for CI
fixtures        synthetic Northgate pump station: generator, L5X, manifests, oracle
tests           golden scenarios, fixture generator tests, adversarial engine tests, e2e
docs            architecture, methodology, threat model, formats, declarations, API, CLI, deployment, testing
```

## Conventions

### TypeScript under Node type stripping

The engine, API and CLI run `.ts` files directly with Node 24's type stripping. Type stripping erases types; it cannot emit code. Therefore:

- No `enum` (use string literal unions and `as const` objects).
- No `namespace`.
- No constructor parameter properties (`constructor(private x: T)`): declare the field and assign it in the body.
- Imports carry the real `.ts` extension: `import { lc } from './project-index.ts'`.
- Type-only imports use `import type`, separately from value imports (`verbatimModuleSyntax`).

`tsconfig.base.json` enables `erasableSyntaxOnly`, `strict` and `noUncheckedIndexedAccess`; ESLint rejects the constructs above with an explanation.

### Engine rules

Code in `packages/core/src` must stay deterministic and side-effect free, because the same code runs in a browser worker, a server worker thread and the CLI, and because identical inputs must produce identical evidence:

- no `Date.now()` (callers pass `analyzedAt`), no `Math.random()`;
- no `fetch`, `XMLHttpRequest`, `DOMParser`, `document`, `window`;
- no `node:*` or other Node built-in imports;
- no `eval` or `new Function`;
- iterate collections in a defined order and sort anything that reaches the output.

ESLint enforces the first four. Parse XML only with `xml/parser.ts`.

### Security habits

- Treat every string from a project file or manifest as hostile. Strings that reach people go through `cleanText`/`stripInvisible`; strings that reach a terminal go through the CLI's `term()`.
- Do not apply a regular expression with nested or adjacent unbounded quantifiers to file content. Prefer a linear scan.
- Build control or bidi character classes from code points (`String.fromCodePoint`, `new RegExp`), never by typing the characters: an editor can silently turn an escape into the invisible character.
- Write long source files with your editor or a write tool, not shell heredocs (they mangle backslashes and truncate long input in some shells).

### Wording

Findings and UI copy are engineering language: "Safety-impacting logic change identified", not "Threat detected"; "Findings", not "Vulnerabilities"; "Analysis could not be completed", not "Oops". Never claim a project is secure or safe. Every sentence in a finding must be built from parsed names, computed conditions or declared intent.

## Adding a rule

1. Add the finding type to `FindingType` in `packages/core/src/model/analysis.ts` if it is new.
2. Implement the rule in the file that matches its subject (`analysis/rules/protective.ts`, `notification.ts` or `changes.ts`): an object implementing `Rule` with the next free id (`IL-R019`), a title, a one-sentence description, a base severity and `evaluate(ctx): Effect[]`.
3. Fill every `Effect` field from the context: `severity` (cap weakenings with `capByCriticality`), `confidence`, `disposition`, `safetyFunctionIds`, `location`, `changeIds`, `explanation`, `impact`, `recommendation`, `evidence` hints, a `groupKey` that merges effects with one root cause, and a `bonus` (0 unless you document why in the methodology).
4. Register it in `RULES` in `analysis/rules/index.ts`. `RULE_INFO`, `GET /api/rules` and SARIF rule descriptors pick it up automatically.
5. If it explains a weakened protective condition, decide where it sits in the precedence of `classifyProtective` so each weakening still yields exactly one finding.
6. Tests: one minimal project that triggers it and one near miss that must not, in `packages/core/test/analysis/semantics.test.ts` (use `mini-l5x.ts`). If a scenario exercises it, add the expectation to `fixtures/src/expected.ts` with a `why` line and regenerate.
7. Document it in `docs/analysis-methodology.md` (rule catalogue and, if it has one, the bonus).

## Adding a format adapter

1. Implement `ProjectAdapter` (`packages/core/src/adapters/types.ts`) in `packages/core/src/adapters/<format>/`. `canParse` is a cheap sniff on the name and the first 4,096 characters; `parse(text, options)` returns a vendor-neutral `ParsedProject` and throws only `ProjectParseError`.
2. Parse XML with `parseXml` (pass `options.limits` through). Never use `DOMParser` or a third-party XML library.
3. Map the vendor's concepts onto the model: reusable definitions are modules, their uses are instances, tasks schedule programs, programs own routines. Keep vendor vocabulary in labels only.
4. Clean every string with the adapter's `clean` equivalent and report removals. Keep `SourceRef` (path, line, column) on every entity.
5. Errors stop the analysis; warnings state the assumption taken; never guess silently.
6. Replace the `planned(...)` entry in `adapters/registry.ts` with the real adapter and set `status: 'SUPPORTED'`.
7. Only ladder logic is analyzed semantically today. If the format's logic is not RLL, either translate it into the neutral rung text the scan understands or mark the routines with their real kind so coverage and trust stay honest.
8. Tests: a sample export, structural errors, hostile inputs (add them to `fixtures/adversarial/`), property tests that nothing but `ProjectParseError` escapes, and a performance test.
9. Update `docs/supported-formats.md` and the README table.

## Fixtures

Everything under `fixtures/` except `fixtures/src/` and `fixtures/adversarial/generate.ts` is generated. Edit the generator (`fixtures/src/*.ts`: the plant model, L5X writer, scenario edits, the large-plant generator with its seeded PRNG, the oracle), run `npm run fixtures`, and commit the generator and its output together. CI runs `npm run fixtures:check` and fails if anything on disk differs.

The oracle in `fixtures/src/expected.ts` is written by hand from the plant logic. If the engine disagrees with it, find out which one is wrong; never copy engine output into the oracle.

All fixture data is synthetic. Do not add real plant exports, real site names or real tag databases to the repository.

## Commit messages

Conventional Commit prefixes: `feat:`, `fix:`, `test:`, `docs:`, `refactor:`, `chore:`, `ci:`. A short imperative subject, a blank line, and a body that says what changed and why in plain language. One logical change per commit; keep generated fixtures in the same commit as the generator change that produced them.

```
feat: add cross-project module drift analysis

Groups same-named AOI definitions across sites by content, flags revisions
that were not bumped and older revisions, and compares output behaviour
symbolically.
```

## Pull requests

- `npm run verify` passes locally.
- New behaviour has tests; changed semantics are reflected in `docs/architecture.md` or `docs/analysis-methodology.md`.
- No new runtime dependency in `packages/core` without a reason in the PR description (the engine depends only on `zod`).
- Security-sensitive changes (parser, sanitizing, API middleware) say so in the description.

Report vulnerabilities privately; see [SECURITY.md](SECURITY.md).
