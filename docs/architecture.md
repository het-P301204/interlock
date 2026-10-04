# Architecture

INTERLOCK is a deterministic analysis engine (`packages/core`) with three thin hosts around it: a browser workstation (`apps/web`, engine in a Web Worker), a REST API (`apps/api`, engine in a worker thread) and a command line (`apps/cli`). The engine is the product; the hosts move bytes in and results out.

This document maps each conceptual layer to the module that implements it, lists every modelling assumption the engine makes, and states the determinism guarantees. The analysis rules and scoring are covered in [analysis-methodology.md](analysis-methodology.md); the security posture in [threat-model.md](threat-model.md).

## Layers

```
 Input Layer ──► Parser ──► Normalization ──► Dependency Graph ──► Safety Model
 bytes, name     XML tree   ParsedProject     symbolic scan,       declarations resolved,
 SHA-256         + adapter  + ProjectIndex    reuse graph          firing conditions
                                                                         │
 Review UI ◄── Findings ◄── Impact Engine ◄── Semantic Comparator ◄──────┘
 web / API /   ranked,      20 rules,         structural diff +
 CLI / reports evidence     grouping          truth-table comparison
```

| Layer | Modules | Main data types | Engine stage(s) |
|---|---|---|---|
| Input Layer | `util/decode.ts`, `util/sha256.ts`, `api-types.ts` | `FileInput`, `SourceFile` | `INGEST` |
| Parser | `xml/parser.ts`, `xml/query.ts`, `adapters/registry.ts`, `adapters/l5x/*` | `XmlElement`, `ParsedProject`, `ParserDiagnostic`, `ProjectParseError` | `INGEST` |
| Normalization | `analysis/project-index.ts`, `logic/rll.ts` | `ProjectIndex`, `RllElement` | `NORMALIZE`, `RESOLVE_MODULES` |
| Dependency Graph | `analysis/scan.ts`, `logic/expr.ts`, `analysis/graph.ts` | `SymbolicScan`, `ExprPool`, `ReuseGraph` | `BUILD_REUSE_GRAPH` (graph emitted in `GENERATE_REVIEW_SET`) |
| Safety Model | `analysis/manifest.ts`, `analysis/safety.ts`, `model/safety.ts` | `SafetyManifest`, `SfAnalysis`, `DeclarationResolution` | `INGEST` (validation), `MAP_SAFETY_FUNCTIONS` |
| Semantic Comparator | `analysis/diff.ts`, `logic/truth.ts` | `Change`, `RawComparison`, `FiringComparison` | `COMPARE_LOGIC`, `TRACE_PROTECTIVE_PATHS`, `ANALYZE_ALARMS` |
| Impact Engine | `analysis/rules/*.ts` | `Rule`, `Effect`, `RuleContext` | `RANK_IMPACT` |
| Findings | `analysis/findings.ts`, `analysis/pipeline.ts` | `Finding`, `EvidenceItem`, `Coverage`, `Trust`, `ReviewSurface` | `RANK_IMPACT`, `GENERATE_REVIEW_SET` |
| Review UI | `report/*`, `apps/web`, `apps/api`, `apps/cli` | `AnalysisResult` | (outside the engine) |

All paths are relative to `packages/core/src/` unless they start with `apps/`.

### Input Layer

`decodeProjectBytes` turns the uploaded bytes into text. UTF-8 is the L5X norm and is decoded with a fatal `TextDecoder`: an invalid byte sequence is `ENCODING_INVALID` with the byte offset, never a silent U+FFFD that would change a tag name. UTF-16 is accepted with a BOM, or without one when the file unmistakably starts with `<` followed by a zero byte. An empty file, or one holding only a BOM, is `EMPTY_FILE`.

The file's SHA-256 is computed by `util/sha256.ts`, a synchronous pure-JavaScript FIPS 180-4 implementation (checked against the FIPS test vectors in `test/logic/logic.test.ts`). It is synchronous because finding fingerprints and module content hashes need hashes in code that cannot be asynchronous, and pure JavaScript so the identical code runs in the browser and in Node without `node:crypto`.

`inspectProjectSync` (`analysis/pipeline.ts`) is the single entry point: decode, hash, detect the format, parse, and summarize. It never throws; a failure comes back as `{ ok: false, error }` with a code, a message, a friendly location and the parser diagnostics.

### Parser

Two layers, deliberately separate.

**`xml/parser.ts`** is a hand-written, iterative XML tree builder. It produces `XmlElement` nodes (name, attributes, own text, children, 1-based line and column, an XPath-like `path` and a human `location` such as `Controller.Tags.Tag[27] (Tag "Pump_01_Run_Enable")`). It implements only what L5X needs: no DTD, no namespaces, no entity declarations. Its security properties are listed in [threat-model.md](threat-model.md#malformed-xml-and-parser-vulnerabilities). Every failure is a `ProjectParseError` with a stable `XML_*` code.

**`adapters/`** turns the element tree into the vendor-neutral `ParsedProject` (`model/project.ts`). The registry (`adapters/registry.ts`) holds one SUPPORTED adapter (`rockwell-l5x`, version `1.0.0`) and three PLANNED ones that recognize PLCopen XML, Siemens TIA Openness XML and Schneider XEF by content and refuse them with `FORMAT_NOT_SUPPORTED`. File extensions other than `.l5x`, `.xml` and `.xef` are refused before content is examined (`EXTENSION_NOT_ALLOWED`).

The L5X adapter (`adapters/l5x/parse.ts`) is structural only: rung text is kept exactly as exported (leading and trailing whitespace trimmed) and never interpreted. It reads metadata, data types, Add-On Instruction definitions (including source-protected ones), controller and program tags, programs, routines and tasks. Every string taken from the file goes through `stripInvisible`, and a `TEXT_INVISIBLE_CHARACTERS` warning records where characters were removed. Problems become `ParserDiagnostic`s with a severity:

- `error`: the semantic model cannot be trusted (a nameless program, a rung without `<Text>`, two `<Text>` elements in one rung, an AOI parameter with an unknown `Usage`, two `<Controller>` elements). The adapter collects every diagnostic, then throws one `ProjectParseError` carrying the first error's code and location, a count of the rest, and the full diagnostic list. Analysis does not continue.
- `warning`: something unusual that was handled in a stated way (duplicate names, protected content, unexpected elements, unknown `ExternalAccess`). The version is `READY_WITH_WARNINGS`.
- `info`: worth knowing (partial export, disabled program, inhibited task, unscheduled program, ST/FBD/SFC routine parsed structurally).

The `ProjectAdapter` interface (`adapters/types.ts`) is the extension point for new formats; see [CONTRIBUTING.md](../CONTRIBUTING.md#adding-a-format-adapter).

### Normalization

`ProjectIndex` (`analysis/project-index.ts`) builds case-insensitive lookup tables over a `ParsedProject`: routines by id and by `(program, name)`, programs, modules, tasks, controller tags and per-program tags, and which task schedules each program. Every key is the lower-cased name; the declared spelling is kept for display.

`logic/rll.ts` parses neutral rung text into a series/branch tree (`RllInstruction`, `RllBranch`). Series instructions are ANDed into the rung condition; branch legs are ORed. Inside an instruction's parentheses, `[` and `,` mean array index and argument separator, so operands are split on commas at nesting depth zero only (`CPT(Dest,A*(B+C))` and `MOV(Tbl[3,1],X)` both parse). The parser never throws: a malformed rung returns an error list, and the scan treats the rung as unknown (see below).

`staticCallSites` (`analysis/pipeline.ts`) finds every AOI call written in a program's RLL routines, executed or not. That list feeds the `RESOLVE_MODULES` stage, the instance counts in the ingest summary, and the module-relationship coverage ratio.

### Dependency Graph: the symbolic scan

`SymbolicScan` (`analysis/scan.ts`) executes one controller scan of each project with boolean expressions instead of bits. Each storage location ends the scan holding the expression that computes it from the scan's inputs. Expressions live in an `ExprPool` (`logic/expr.ts`), a hash-consed DAG: equal subexpressions are a single node, constructors fold constants, flatten nested AND/OR, remove duplicates, collapse complementary pairs and sort arguments, so `A AND B` and `B AND A` are the same node. The scan's expressions share a great deal of structure (every guarded write wraps the previous value; every instance of an AOI runs the same definition logic), and hash-consing keeps that sharing explicit instead of copying it.

Each value also carries a provenance set of anchors (`rung:`, `routine:`, `program:`, `task:`, `module:`, `instance:`, `loc:`, `prev:`). The dependency cone of an output is the closure of those anchors over previous-scan reads of locations the scan also writes (`SymbolicScan.cone`). Cones are what tie a change to a safety function: a change whose anchors fall inside a function's cone is that function's change.

The scan runs in two modes. Mode `full` executes the whole project from its tasks. Mode `rung` interprets one rung in isolation, with AOI calls and JSRs as opaque effects; the structural diff uses it to decide whether a rewritten rung is semantically equivalent.

`analysis/graph.ts` builds the reuse graph shown in the UI from the current project's scan, keeping routines and instances that only exist in the baseline (marked `removed`). Node types: task, program, routine, module, instance, safety-function, protective-output, alarm, tag. Edge types: `schedules`, `calls`, `defines`, `instantiates`, `writes`, `protects`, `alarms`, `implements`, `influences` (the model also reserves `references`). Scenario 04 produces 72 nodes and 103 edges.

### Safety Model

`analysis/manifest.ts` validates the engineer's declarations (schema and rules in [safety-declarations.md](safety-declarations.md)). `analysis/safety.ts` resolves each declared function in both projects and takes, from the two scans, the end-of-scan expression of the protective output and of the alarm notification:

```
firing condition (DE_ENERGIZE) = NOT (final value of the output)    the function acts when the output drops
firing condition (ENERGIZE)    =      final value of the output     the function acts when the output rises
```

It also records the writers of the output on each side (`executedWrites`: writes whose guard is not constant false), new writers and lost writers, the declaration resolution state, and the cones. The protective analysis and the notification analysis run as separate passes (`TRACE_PROTECTIVE_PATHS`, then `ANALYZE_ALARMS`) and are merged per function.

### Semantic Comparator

Two independent comparisons.

**Structural diff** (`analysis/diff.ts`). Every attribute INTERLOCK models is compared, so "total changes" is an honest count that includes descriptions and export bookkeeping. Each `Change` gets a category (`logic`, `execution`, `interface`, `configuration`, `data`, `documentation`, `metadata`) and a stable id `CH-0001…` in a deterministic order. Rungs are aligned per routine with a longest-common-subsequence over whitespace-stripped, lower-cased rung text after trimming the common prefix and suffix; unmatched deletions and insertions between two matches are paired in order as modifications. If the unmatched middle exceeds 4,000,000 cells the rungs are paired positionally instead. Each modified rung is interpreted in isolation on both sides (`rung` mode) and every location it writes is compared: `equivalent` only if all are provably equivalent, `unknown` if a comparison is undecided or the rung contains an unmodeled instruction, `different` otherwise. Structured-text lines are aligned the same way and always marked `unknown`.

**Firing-condition comparison** (`logic/truth.ts`). The baseline and current conditions are compared over every consistent assignment of the atoms they mention, with numeric comparisons on the same tag grouped so only values a real tag could take are checked. The verdicts, the bound, the numeric grouping and the minimal-form rendering are specified in [analysis-methodology.md](analysis-methodology.md#3-exhaustive-comparison).

### Impact Engine

Twenty rules (`analysis/rules/`) each map the `RuleContext` to zero or more `Effect`s. A rule never writes prose about anything the context does not contain: every sentence is built from parsed names, computed conditions and declared intent. The catalogue is in [analysis-methodology.md](analysis-methodology.md#6-rule-catalogue).

### Findings

`analysis/findings.ts` groups effects that share a `groupKey` (one root cause affecting several functions becomes one finding), takes the maximum severity and lowest confidence in the group, computes the ranking score, sorts, numbers findings `IL-0001…` in review order and attaches the evidence ledger (`EV-0001-01…`). `analysis/pipeline.ts` then computes per-function results, module blast radii, the undeclared-logic list, coverage, trust and the review surface, and assembles the `AnalysisResult` (`schema: "interlock.analysis/v1"`).

### Review UI and reports

`report/document.ts` builds one document model from an `AnalysisResult`; `report/export.ts` renders it as Markdown and also writes JSON and CSV; `report/pdf.ts` is a dependency-free PDF 1.4 writer that renders the same model with the three standard Type 1 fonts. The Markdown and PDF reports therefore cannot disagree. The hosts are described in [api.md](api.md), [cli.md](cli.md) and [deployment.md](deployment.md).

## The ten pipeline stages

`analyzeProjectsSync` runs ten stages in order. Each stage reports what it did with real counts (`StageReport.detail` and `counts`), and an optional `onStage` hook receives a `start` and a `done` event per stage; the web timeline shows only these events. Real output for scenario 04:

| Stage | What it does | Detail reported for scenario 04 |
|---|---|---|
| `INGEST` | decode, hash and parse both files; validate the manifest | Hashed and parsed baseline-safe.L5X (50.0 KB) and current-aoi-modified.L5X (50.7 KB); 8 safety declarations validated. |
| `NORMALIZE` | index both projects; parse every rung | Normalized 40 routines and 86 rungs into the vendor-neutral model. |
| `RESOLVE_MODULES` | find every module call site and resolve its definition | Resolved 5 module call sites in the current project (5 in the baseline) against 1 Add-On Instruction definition (AOI_PumpInterlock). |
| `BUILD_REUSE_GRAPH` | symbolically execute one scan of each project | Executed one controller scan of each project symbolically: 20 routines and 5 module instances execute in the current project; 53 storage locations written. |
| `MAP_SAFETY_FUNCTIONS` | resolve every declaration | Mapped 8 declared safety functions: 11 of 11 declared outputs and alarms resolve in the current project. |
| `COMPARE_LOGIC` | structural diff and per-rung semantic equivalence | Found 9 structural changes; 1 touch logic, of which 0 are provably equivalent. |
| `TRACE_PROTECTIVE_PATHS` | compare every protective firing condition | Compared 7 protective firing conditions over 814 input combinations; 3 weakened. |
| `ANALYZE_ALARMS` | compare every notification path | Traced 4 operator notification paths from condition to alarm; 1 changed. |
| `RANK_IMPACT` | run the rules, group and rank findings | Applied 20 deterministic rules: 5 effects grouped into 3 findings, ranked by severity, criticality and reach. |
| `GENERATE_REVIEW_SET` | coverage, trust, review surface, reuse graph | Review set: 3 items to review out of 9 changes; coverage 100%, trust review required. |

If the baseline, the current file or the manifest cannot be trusted, `INGEST` throws `AnalysisInputError` with `side` (`baseline`, `current` or `manifest`), the error code, and the location or the list of manifest issues. No later stage runs on an untrusted model.

## Modelling assumptions

Everything INTERLOCK concludes is relative to these assumptions. The central cases (TND, forward JMP, MCR zones, AFI, disabled programs and inhibited tasks, a second writer, a MOV into a protective output, seal-in circuits, alias retargeting, case-insensitivity, AOI `EnableIn` hold, shared-module propagation, numeric setpoints, ALMD `ProgDisable`, the truth-table bound) are pinned by one test each in `packages/core/test/analysis/semantics.test.ts`.

### Scan order

- Continuous tasks run first, then periodic tasks, then event tasks; within each group, ascending `Priority` (a lower number is a higher priority; a task with no priority sorts as 100; ties keep file order). A periodic task can preempt the continuous task at any point; running it afterwards makes its writes the last ones, which is the conservative choice for a write that could override a protective output. Every task runs once per symbolic scan. An event task's programs run under an opaque "event task X triggered" condition, because whether the event fires is not in the project file. Preemption at arbitrary points, task rates and interleaving are not modeled.
- The scan runs twice (`SymbolicScan.runFull`). The first pass computes every location's end-of-scan value; the second pass runs the same scan with those values as the "previous scan" values, so a location read before it is written sees what the scan itself wrote last time (steady state, inputs held constant). Without the second pass, a later rung that unlatches a trip input would be invisible.
- Within a task, programs run in `ScheduledPrograms` order. Each program runs its `MainRoutineName` routine only; the fault routine is not executed.
- Rungs run top to bottom. `JSR(Routine,…)` inlines the target routine at the call, under an execution guard equal to the caller's guard AND the JSR's rung condition. The target must be a routine of the same program. Input parameters (`JSR(Routine, n, in1, in2, …)`) are copied into the matching operands of the `SBR` instruction in the target's first rung; a JSR that passes parameters to a routine without an `SBR` is reported as unsupported. Return parameters are not modeled.
- A program that is not scheduled, is `Disabled`, or sits in an `InhibitTask` task executes nothing. A program routine that no executing routine calls is recorded as blocked ("routine is not called from any executing routine"). A writer that lived in such a routine in the baseline becomes a lost writer and drives `PROTECTIVE_PATH_REMOVED` (scenario 09).
- A recursive call into a routine already on the call stack is not followed; it is reported as an unsupported `EXECUTION_CONTROL` construct, and a declared function whose logic contains it is `NOT_ANALYZED`.

### Writes

With guard `g` (the routine's execution guard) and rung condition `rc` at the instruction:

| Instruction | Effect on location `v` |
|---|---|
| `OTE(v)` | `v := g ? rc : v` |
| `OTL(v)` | `v := (g AND rc) ? 1 : v` |
| `OTU(v)` | `v := (g AND rc) ? 0 : v` |
| `CLR(v)`, `MOV(0,v)` | `v := (g AND rc) ? 0 : v` |
| `MOV(1,v)` | `v := (g AND rc) ? 1 : v` |
| other move/math with a destination | `v := (g AND rc) ? <opaque value> : v`, and every member of `v` already written in the scan becomes opaque too |

Output instructions pass the rung condition through unchanged, which is what makes output branches work. Writes are applied in scan order, so the last executed write determines the end-of-scan value: a later `OTL` or `MOV` into a protective output overrides the protective logic, and INTERLOCK reports it as a bypass (scenario 05).

### Add-On Instructions and `EnableIn`

- An AOI call is `AOI_Name(BackingTag, arg1, arg2, …)`: the backing tag, then the required parameters (excluding `EnableIn`/`EnableOut`) in declaration order. Arguments are bound by position. A count mismatch is recorded as an unresolved reference and binding continues by position.
- `BackingTag.EnableIn := rc`. The definition's logic routine (the routine named `Logic`, else the first routine) runs under guard `g AND rc`. When the rung condition is false the logic does not run and every output holds its previous value: this is how a condition placed in front of an AOI call can weaken the trip it computes.
- Required `Input` parameters read their argument directly; `InOut` parameters are bound to the argument by reference; non-required parameters are members of the backing tag (`PUMP_01_IL.Maint_Bypass`). Required `Output` parameters are copied from the backing member to their argument after the call, under the caller's guard.
- An atom on a backing member carries the more restrictive of the backing tag's and the parameter's external access.
- `EnableInFalse`, `Prescan` and `Postscan` routines are not executed.
- A source-protected AOI, or a call nested more than eight levels deep, is executed as an opaque call: `EnableIn` follows the rung, and every output (and every required output argument) becomes an opaque function of the exact argument list. A protected call is also reported as `PROTECTED_CONTENT`.

### Timers, counters, one-shots

- Timing is not modeled; timers are evaluated in steady state. `TON` and `TOF`: `.EN := rc` and `.DN := rc` (a TON's done bit follows its input once the preset has elapsed; a TOF's follows it until the preset elapses after the input drops). `RTO`: `.EN := rc`, `.DN` is opaque (retentive). The preset of every timer is recorded, and rule IL-R009 compares presets separately (preset comparison is the only timing semantics INTERLOCK has).
- In `rung` mode a preset change makes the rung `different`, so a preset edit is never mistaken for a cosmetic change.
- `CTU`/`CTD`: `.CU`/`.CD := rc`, `.DN` opaque. `RES` clears `.DN`, `.TT` and `.EN` when its rung is true.
- `ONS`, `OSR`, `OSF` use their storage bit's start-of-scan value, so one-shot behaviour is expressed over previous-scan atoms.

### Conditions

- `XIC`/`XIO` read a bit; `AFI` is constant false; `NOP` passes the rung condition through.
- `EQU NEQ GRT GEQ LES LEQ` between a tag and a literal become numeric comparison atoms grouped by tag. Between two literals they fold to a constant. Between two tags they become one independent comparison atom (no relation to other comparisons is assumed).
- A numeric tag that logic writes (`MOV`, `CPT`, …) earlier in the scan, or later in the scan and therefore seen through the previous-scan value, is not treated as the raw input: the comparison's subject carries the expression that produced the value and its label reads "(as written by logic)". A changed or new write is therefore a different subject and never compares as equivalent.
- `LIM(low,test,high)` with literal limits and a tag under test becomes a range atom (including the Logix wrap-around when `low > high`). `MEQ`, `CMP` and comparisons on computed operands are opaque atoms.
- Tags of type `SINT INT DINT LINT USINT UINT UDINT ULINT BOOL`, and `.PRE`/`.ACC` members, are integers; everything else is treated as real when choosing representative values.

### Execution control

- `TND` and `RET`: later rungs of the same routine run under `guard AND NOT(rung condition)`. Both are modeled as ending the current routine. A conditional `RET` is also recorded as an execution-control instruction; an unconditional one is not.
- `JMP(L)` to a label on a later rung of the same routine: the rungs up to and excluding the `LBL(L)` rung run under `guard AND NOT(JMP rung condition)`. A backward or unresolved jump is reported as `EXECUTION_CONTROL` and is not modeled; later results for that routine are approximate.
- `MCR`: a conditional `MCR` rung starts a zone; a rung holding only `MCR` ends it. Rungs inside the zone see rung-in equal to the zone condition, so their `OTE`s are forced false while the zone is off.
- `UID`, `UIE`, `EOT`, `SFP`, `SFR` are recorded as execution-control instructions (IL-R010 reports them when they are new in a safety routine) and otherwise pass the rung condition through. `SBR` and `LBL` have no effect of their own.
- `SSV` on a `Program`, `Task` or `Routine` with an attribute containing "disable" or "inhibit" (for example `SSV(Program,Safety,DisableFlag,…)`) can stop logic at run time. INTERLOCK does not model runtime attribute changes; it records the instruction as an execution-control construct anchored to the program, task or routine it targets, wherever the `SSV` itself sits. A declared function whose cone contains the target is `NOT_ANALYZED`, and IL-R010 reports a newly introduced one. Other `SSV` uses pass the rung condition through without effect.

### Alarms

- `ALMD(Alarm, ProgAck, ProgReset, ProgDisable, ProgEnable)`: the rung condition is the alarm input (`Alarm.In := rc`). The notification condition is `rc AND NOT disable`, where `disable` is the `ProgDisable` operand (a literal or a bit) ORed with any value logic writes to the alarm's `.ProgDisable`, `.ProgSuppress`, `.OperDisable`, `.OperSuppress` or `.OperShelve` members, earlier in the scan or, through the previous-scan value, later in it.
- The alarm's stored configuration in the tag (`Severity`, `MinDurationPRE`, `ShelveDuration`, `MaxShelveDuration`, `Condition`, `AckRequired`, `Latched` and the stored disable, suppress and shelve flags) is part of the tag's compared value; rule IL-R019 reports changes that delay, invert, disable or suppress a declared alarm.
- A declared alarm that was driven by an `ALMD` in the baseline and is a plain BOOL in the current project is `DEGRADED`: alarm-system features (acknowledgement, shelving, history, severity) are lost.
- An alarm tag of type `ALARM_*` that no executing `ALMD` drives has mechanism `NOT_EXECUTED`; its notification is constant false (a broken path).
- `ALMA` (analog alarm) is treated as opaque: its notification path is `NOT_ANALYZED`.
- A declared alarm that is a plain BOOL tag is analyzed through its end-of-scan value. If no baseline logic writes it, INTERLOCK notes that it is set outside the controller.
- Operator shelving, suppression and disabling performed at the HMI at run time are operator actions and are not modeled; only logic that writes those members, and the configuration stored in the export, are. The HMI and operator stages of a notification path are `DECLARED`: the project file cannot prove that link.

### Names, scopes and aliases

- Logix identifiers are case-insensitive. Every lookup is lower-cased; `pump_01` and `PUMP_01` are one tag. Duplicate names that differ only in case are a `L5X_DUPLICATE_NAME` warning, and both definitions are kept.
- A tag reference resolves in the current program's scope first, then controller scope. `\Program.Tag` names a program-scoped tag explicitly. Inside an AOI, names resolve to parameters, `EnableIn`/`EnableOut` and local tags of the definition.
- An alias tag resolves to its target location; the display label keeps the alias name. Retargeting an alias changes the location every reader sees and is detected. Alias chains are followed to a depth of 8; beyond that the reference is unresolved.
- I/O paths that contain `:` (for example `Local:3:I.Data.4`) are not in `<Tags>`; they become their own locations with external access `n/a`.
- A reference that does not resolve is an `UNRESOLVED_REFERENCE` construct and reads as an opaque atom.

### Previous-scan atoms

A location read before anything in the current pass wrote it takes its previous-scan value. If the scan writes that location at all, the previous-scan value is the expression the first pass computed for it (a seal-in contact, an output read before its writer runs, a trip input unlatched by a later rung). If nothing in the scan writes it, it is an atom: an input, or a tag set by an HMI or another client. Atoms carry the tag's name as their label. An atom whose location no executing logic writes is reported as `externallySet` and, when its external access is `Read/Write`, the finding says that an HMI or OPC client can set it.

Where the first pass's value itself depends on start-of-scan values (an output that holds its value when nothing writes it), those remain atoms, which is why scenario 09's SF-04 reads `NOT Pump_03_Run_Enable` once the routine that wrote it no longer executes.

### Unparsable and unknown logic

- A rung that does not parse is never ignored: every tag it mentions receives an opaque write, so a broken rung that touches a protective output still shows up as a writer. It is reported as an `INSTRUCTION` construct.
- An instruction INTERLOCK does not know (and that is not an AOI in the project) is reported, opaquely writes every tag operand, and contributes an opaque atom to the rung condition.
- Structured text is not analyzed semantically. Every assignment target (`X := …`) and the destination of every `COP`, `CPS` and `MOV` call in an executing ST routine is recorded as an opaque write, so an ST routine that writes a protective output still appears as a writer. FBD and SFC routines are parsed structurally; their writes are not visible to the scan, and an executing one makes the trust status `PARTIAL_COVERAGE`.
- Branch nesting deeper than 64 levels in one rung is a parse error (Logix itself allows only shallow nesting), so no walker can exhaust the stack.

### Scope shadowing of a declared output

If the declared protective output resolves to a different storage location in the current project than in the baseline (for example a new program-scoped tag with the same name shadows the controller tag wired to the I/O), INTERLOCK analyzes the location the baseline protected, because that is the one the equipment still listens to, records a note on the function, and sets the trust status to `PARTIAL_COVERAGE` because the declaration has become ambiguous.

### Functions INTERLOCK cannot see completely

A declared function is `NOT_ANALYZED`, never unchanged, when any of its declared paths could not be compared in both projects, when any comparison was `NOT_DECIDED`, or when an unsupported construct (unknown instruction, unparsable rung, recursion, a disabling `SSV`, protected content) touches a location, routine or target in its current dependency cone. Any opaque atom in a function's comparison (an unmodeled condition or an event trigger) makes the trust status `PARTIAL_COVERAGE`.

## Determinism

The same baseline bytes, current bytes, manifest and `analyzedAt` produce byte-identical JSON. The golden tests assert this for every scenario (`tests/golden/scenarios.test.ts`, "is deterministic: same inputs, same result").

- **No clock.** The caller passes `analyzedAt` as a string; the engine never reads time. Export dates are kept as the text in the file and never parsed into a clock value.
- **No randomness.** Ids are content-derived: the analysis id is the first 12 hex characters of the SHA-256 of both file hashes, the validated manifest serialized as JSON, and the engine version; each finding's `fingerprint` hashes its type, rule, safety functions, module, routine and the summaries of its changes. Change ids, finding ids and evidence ids are assigned after deterministic sorts.
- **No I/O.** The engine takes bytes and returns objects. It has no filesystem, network or DOM access, so it runs unchanged in a Web Worker, a Node worker thread and the CLI.
- **Stable iteration.** Every collection that reaches the output is sorted or built in file order; ties in ranking are broken by severity, then a fixed type order, then fingerprint.

These properties are enforced, not just intended. `eslint.config.js` applies these rules to `packages/core/src/**/*.ts`:

| ESLint rule | Forbids |
|---|---|
| `no-restricted-globals` | `document`, `window`, `fetch`, `XMLHttpRequest`, `DOMParser` |
| `no-restricted-properties` | `Date.now`, `Math.random` |
| `no-restricted-imports` | `node:*`, `fs`, `path`, `child_process`, `http`, `https`, `net` |
| `no-eval`, `no-new-func` | dynamic code |

The whole repository additionally forbids TypeScript `enum`, `namespace` and constructor parameter properties (`no-restricted-syntax`), because the API, CLI and engine run under Node's type stripping, which cannot emit runtime code for those constructs.

## Package layout

```
packages/core/src/
  model/        project.ts, safety.ts, analysis.ts: every type the engine exchanges
  xml/          hardened XML tree builder, queries, serializer (round-trip tests)
  adapters/     ProjectAdapter interface, registry, l5x/ (parse, context, values)
  logic/        rll.ts (rung parser), expr.ts (hash-consed expressions), truth.ts (comparison)
  analysis/     project-index, scan, diff, safety, manifest, rules/, findings, graph, drift, pipeline
  report/       document model, JSON/CSV/Markdown export, PDF writer
  util/         decode (bytes to text), sha256, sanitize (invisible characters)
  index.ts      public API
apps/web        React 19 + Vite review workstation; engine in a Web Worker
apps/api        Hono REST API with node:sqlite storage; engine in a worker thread
apps/cli        command line for CI
fixtures/       synthetic Northgate pump station: generator, L5X, manifests, expected findings
tests/          golden scenario tests, fixture generator tests
```
