# Testing

```bash
npm test                         # vitest: engine, adapters, fixtures, golden scenarios, API, CLI
npx vitest run packages/core     # one area
npx vitest run -t "scenario 04"  # by name
npm run test:e2e                 # Playwright against the production build (run npm run build first)
npm run lint
npm run typecheck
npm run fixtures:check           # generated fixtures match their generator
npm run verify                   # lint + typecheck + test + build
```

Vitest picks up `packages/*/test/**/*.test.ts`, `apps/api/test/**`, `apps/cli/test/**`, `tests/**` (except `tests/e2e`) and `apps/web/src/**/*.test.{ts,tsx}`. Tests run in forked workers with a 30-second per-test timeout.

## What is covered

| Area | Files | What the tests pin down |
|---|---|---|
| XML parser | `packages/core/test/xml/parser.test.ts`, `property.test.ts` | tree building, positions and paths, CDATA and entity handling, CRLF normalization, prototype safety, DTD rejection in every form, every error code with its location, every limit; property tests (fast-check) that arbitrary strings, XML-like token soups and tight limits never produce anything but `ProjectParseError`; serialize/parse round trips |
| Encoding | `packages/core/test/l5x/decode.test.ts` | UTF-8 with and without BOM, UTF-16 LE/BE, strict rejection of invalid bytes with the offset, a property test that the hand-written UTF-8 validator agrees with a fatal `TextDecoder` |
| L5X adapter | `packages/core/test/l5x/adapter.test.ts`, `fixtures.test.ts`, `registry.test.ts` | every element the adapter reads, source protection, localized descriptions, partial exports, every error and warning path, case-insensitive duplicates, invisible-character stripping with locations, format detection and refusal of planned formats |
| Hostile files | `packages/core/test/l5x/adversarial.test.ts` | every file in `fixtures/adversarial/` (XXE, parameter entities, billion laughs, 5,000-deep nesting, prototype attributes, duplicate attributes, invalid UTF-8, bidi names, truncation, wrong root) is refused with its exact code and a location, or parsed with the expected warning; XXE content never leaks |
| Performance | `packages/core/test/l5x/performance.test.ts` | a ~20 MB L5X decodes and parses in well under 5 seconds |
| Sanitizing | `packages/core/test/util/sanitize.test.ts` | bidi, zero-width, tag and control characters removed; legitimate scripts (accented Latin, CJK, Arabic, Hebrew, emoji) preserved; idempotence and completeness as properties; the source file itself contains no literal invisible characters |
| Logic | `packages/core/test/logic/logic.test.ts` | SHA-256 against the FIPS 180-4 vectors, the rung parser (branches, nested operands, malformed rungs), literals and tag references, the truth-table comparison (inhibit, strengthening, setpoints, `NEVER_FIRES`, `NOT_DECIDED`) |
| Scan semantics | `packages/core/test/analysis/semantics.test.ts` | one minimal project per modelling assumption: equivalent reorder, AFI, TND, forward JMP, MCR, disabled program and inhibited task, second writer, MOV into an output, extra trip cause, intermediate bits, seal-in, aliases, case-insensitivity, AOI `EnableIn` hold, shared-module propagation, numeric setpoints, ALMD `ProgDisable`, renamed output, the exhaustive bound |
| Golden scenarios | `tests/golden/scenarios.test.ts` | each synthetic scenario against its hand-written oracle in `fixtures/expected/`: required findings (type, severity, functions, program/routine, inhibit and suppressor labels), forbidden finding types, severity ceilings, every function's status, trust, priority, review surface, blast radius, determinism (same inputs, identical result) and evidence on every finding; the drift scenario against its drift oracle |
| Adversarial engine review | `tests/adversarial-engine/` | cases an independent review wrote to break the engine, each a hostile variant of the fixture plant that weakens a declared function: scope shadowing of a protective output, weakenings beyond the exhaustive bound, `SSV` disabling a program or task, safety logic moved to an event or slower periodic task, a new earlier writer of an output, alarm configuration (`Condition`, `MinDurationPRE`, `OperDisable`), an ALMD replaced by a BOOL, external access granted on a trip input, timer presets in tag data or overwritten by logic, recursion inside safety logic; robustness against 5,000- and 20,000-level branch nesting and a 20-input weakening; Markdown injection through a lone CR; and regressions that must stay correct |
| Fixture generator | `tests/fixtures/fixtures.test.ts` | the generator is deterministic and matches the files on disk; every rung balances and ends with `;`; every AOI call passes the required arguments; every operand exists; each scenario's edits land exactly where intended; manifests resolve; the registry and the expected files are consistent |
| API | `apps/api/test/api.test.ts`, `security.test.ts`, `store.test.ts` | meta routes and that every registered route is in the OpenAPI document; project, upload (raw and multipart) and manifest validation; 413 for oversized bodies with and without `Content-Length`; scenario 02 and drift through the API; 504 on the worker timeout and 503 beyond the concurrency limit; bearer token (health stays open, mutations protected, any-length comparison), configuration refusals, loopback binding and Host checks, cross-origin rejection, static serving and path containment; store migration and BLOB round trip |
| CLI | `apps/cli/test/cli.test.ts` | version and help, exit codes 0/1/2, the `--fail-on` gate including UNDECLARED findings, every output format with the gate verdict on stderr, valid SARIF 2.1.0, drift and scenarios, terminal-escape stripping of hostile exports |
| End to end | `tests/e2e/` (Playwright, `playwright.config.ts`) | the production build served by the API on port 8797 with an in-memory database, desktop and mobile (`@mobile`) projects. The harness and the CI job are in place; at the time of writing `tests/e2e/` holds no specs yet |

## The oracle

`fixtures/expected/*.json` are written by hand in `fixtures/src/expected.ts` (and emitted by the fixture generator), reasoned from the plant logic and the scan order, never computed from the engine. Each starts with a `why` list explaining every expectation in plant terms (for scenario 02: "Maintenance_Mode is a new atom that only removes firing cases, it is ExternalAccess Read/Write and no logic writes it"). A disagreement between the engine and an expected file means one of them is wrong and must be investigated, never that the expected file is regenerated.

Expectations are deliberately partial: `findings.mustInclude` lists findings that must be present (matched by type, severity or minimum severity, functions, program, routine and inhibit or suppressor labels), `findings.mustNotIncludeTypes` lists types that must not appear, and `findings.maxSeverity` / `findings.maxSeverityOverall` cap what may be reported. `safetyStatus`, `trust`, `priority`, `surface`, `changeCounts` and `blastRadius` pin the rest. That keeps the tests strict about safety conclusions while letting wording improve.

## Determinism checks

The golden tests run each scenario twice and require identical JSON. The engine is also linted against clocks, randomness, the network and Node built-ins (see [architecture.md](architecture.md#determinism)).

## Writing a test for a new behaviour

- A change to scan semantics gets a minimal project in `packages/core/test/analysis/semantics.test.ts` built with `mini-l5x.ts`: one baseline, one current, one declared function.
- A new rule gets a semantics test that triggers it and one that must not, plus a scenario expectation if a fixture exercises it. See [CONTRIBUTING.md](../CONTRIBUTING.md#adding-a-rule).
- A new hostile input goes into `fixtures/adversarial/generate.ts`, its README table and the expectation map in `adversarial.test.ts`.

## Current count

At the time of writing (2026-10-04), `npx vitest run` reports **547 tests in 20 files, all passing**.
