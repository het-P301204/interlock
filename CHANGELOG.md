# Changelog

All notable changes to INTERLOCK are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-04

First release. Engine 1.0.0, L5X adapter 1.0.0, API 0.1.0, CLI 0.1.0.

### Added

- **Engine** (`packages/core`): deterministic, side-effect-free analysis that runs unchanged in a browser Web Worker, a Node worker thread and the CLI.
  - Hardened, iterative XML parser: every DTD rejected (no XXE, no entity expansion), limits on size, depth, element count, attributes and text, prototype-free attribute maps, duplicate attributes rejected, precise error codes and locations.
  - Strict byte decoding (UTF-8, UTF-16 with BOM); invalid bytes are refused, never replaced.
  - Rockwell L5X adapter: controller metadata, data types, Add-On Instructions (including source-protected ones), controller and program tags, programs, RLL and structured-text routines, FBD/SFC routines structurally, tasks; localized descriptions; partial exports; invisible and bidirectional characters stripped with a located warning.
  - PLCopen XML, Siemens TIA Openness XML and Schneider XEF recognized and declined as PLANNED.
  - Symbolic scan of one controller scan per project over a hash-consed expression DAG, with provenance for exact dependency cones; two passes so previous-scan values are the scan's own steady state; continuous tasks before periodic ones, event tasks under an opaque trigger; AOI calls with `EnableIn` hold semantics, JSR with `SBR` input parameters, TND and RET, forward JMP, MCR zones, ALMD (including logic writes to `Prog*`/`Oper*` disable, suppress and shelve members), timers in steady state; disabling `SSV`s flagged against their target; structured-text assignments and `COP`/`CPS`/`MOV` destinations recorded as unanalyzed writes; branch nesting bounded.
  - Exhaustive firing-condition comparison (bounded at 2^20 assignments) with numeric comparisons grouped per tag, minimal sum-of-products rendering and witness assignments.
  - Inhibit proof by Shannon cofactor for protective outputs and alarm notification paths.
  - Structural diff with LCS rung alignment and a per-rung semantic equivalence proof.
  - Twenty rules: protective path removed, new inhibit, protective output bypassed, shutdown/interlock/permissive weakened, setpoint relaxed, alarm path suppressed, trip delay increased (presets in rungs or tag data, logic-written presets, slower tasks), execution control introduced, shared module propagation, undeclared logic changed, protection strengthened, cosmetic change, non-safety change, declaration unresolved, module revision not bumped, external write access granted, alarm configuration weakened, new writer of a protective output overridden later in the scan.
  - A function that cannot be compared completely (undecided comparison, unsupported construct in its cone, unresolved declaration) is `NOT_ANALYZED`; opaque conditions and scope-shadowed outputs force `PARTIAL_COVERAGE`. These and the scan changes above close 29 false negatives found by an adversarial review of the engine.
  - Ranked findings (`IL-0001…`) with severity capped by declared criticality, confidence, blast radius, notification impact, explanation, recommendation and an evidence ledger (file hashes, parser version, XML path and line, before/after logic, rule, timestamp).
  - Coverage ratios and a trust status (`VERIFIED_SCOPE`, `PARTIAL_COVERAGE`, `REVIEW_REQUIRED`) that never claims a project is secure.
  - Reuse graph, module blast radius, review surface and a ten-stage pipeline that reports real work.
  - Cross-project module drift (experimental).
  - Reports: JSON, CSV (formula-injection safe), Markdown (escaped) and a dependency-free PDF writer, all from one document model.
- **Safety declarations** (`interlock.safety/v1`): strict schema with bounded sizes and invisible-character stripping.
- **Web workstation** (`apps/web`): React 19 review workstation with local analysis in a Web Worker, analysis timeline driven by real stage events, demo scenarios, light and dark themes; deployable as a static site.
- **REST API** (`apps/api`): projects, versions, safety manifests, analyses, findings, changes, graph, safety map, reports and drift; engine jobs in worker threads with timeout, heap cap and concurrency limit; node:sqlite storage; optional bearer token; loopback binding, Host and Origin checks, rate limits, security headers; OpenAPI 3.1 document.
- **CLI** (`apps/cli`): `inspect`, `analyze`, `drift`, `scenarios`, `scenario`; text, JSON, Markdown, CSV, PDF and SARIF 2.1.0 output; `--fail-on` gate with exit codes 0/1/2; terminal-escape stripping.
- **Synthetic fixtures**: the Northgate Pump Station, nine scenarios, a deterministic generator, hand-written expected findings, and hostile files for the parser.
- **Delivery**: multi-stage non-root container image, Docker Compose file with a read-only, capability-free container, CI (lint, typecheck, fixture check, tests, build, CLI smoke test, Playwright, dependency audit, container smoke test, SBOM, Trivy, CodeQL, secret scanning) and a GitHub Pages workflow.
- **Documentation**: README, architecture, analysis methodology, threat model, supported formats, safety declarations, API, CLI, deployment and testing guides, contributing guide and security policy.

[0.1.0]: https://github.com/het-P301204/interlock/releases/tag/v0.1.0
