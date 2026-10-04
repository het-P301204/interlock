# Analysis methodology

This document specifies how INTERLOCK decides what a change means for a declared safety function. Every formula and threshold below is quoted from the implementation; every example output is real engine output on the synthetic fixtures (`node .interlock/run.ts <id> v`, or the CLI `scenario` command). Module paths are relative to `packages/core/src/`.

The engine's modelling assumptions (scan order, instruction semantics, AOI `EnableIn`, aliases, case-insensitivity) are listed in [architecture.md](architecture.md#modelling-assumptions). This document builds on them.

## 1. From a scan to a firing condition

INTERLOCK executes one controller scan of each project symbolically (`analysis/scan.ts`), in two passes so that values read before they are written take the scan's own previous-scan value. At the end of the scan every storage location holds a boolean expression over atoms. An atom is a value nothing in the scan determines: a field input, an HMI-written tag, a numeric comparison, an opaque stand-in for something not modeled, or the start-of-scan value of an output nothing writes.

For each declared function with a protective output, the firing condition is taken from the end-of-scan value of that output:

| Trip state | Firing condition | Typical output |
|---|---|---|
| `DE_ENERGIZE` | `NOT output` | run enable, permit, MCC main enable |
| `ENERGIZE` | `output` | trip command, close-valve command |

For a declared alarm the notification condition is taken the same way: the ALMD notification condition (`rc AND NOT ProgDisable`, see [architecture.md](architecture.md#alarms)) or, for a BOOL alarm tag, its end-of-scan value.

The condition is a function of the inputs, not of the rung that writes the output. Intermediate bits are expanded: if the output depends on `Mid` and `Mid`'s rung gained a new contact, the weakening is found through `Mid`. In scenario 04 the trip of P-101 is computed inside `AOI_PumpInterlock`, and its firing condition names the inputs at the call site, including `ESD_Remote_Cmd` and `Fire_Detected`, which reach the pump through `MCC_Main_Enable` and `ESD_Active`.

## 2. Symbolic scan semantics

Summary of what each instruction contributes. The complete list, including the scan order and execution-control handling, is in [architecture.md](architecture.md#modelling-assumptions). `g` is the routine's execution guard; `rc` is the rung condition at the instruction.

| Construct | Semantics in the scan |
|---|---|
| `XIC(b)` / `XIO(b)` | `rc AND b` / `rc AND NOT b` |
| Branch `[leg, leg]` | OR of the legs' conditions |
| `OTE(v)` | `v := g ? rc : v` |
| `OTL(v)` / `OTU(v)` | `v := g AND rc ? 1 : v` / `v := g AND rc ? 0 : v` |
| `MOV(0,v)`, `CLR(v)` / `MOV(1,v)` | as `OTU` / as `OTL` |
| Other moves and math | `v := g AND rc ? <opaque> : v` |
| `EQU NEQ GRT GEQ LES LEQ` tag vs literal | numeric atom, grouped per tag |
| `LIM` with literal limits | range atom, grouped per tag |
| `TON`, `TOF` | `.EN := rc`, `.DN := rc` (steady state); preset compared separately |
| `RTO`, counter `.DN` | opaque |
| `JSR(R, n, in…)` | `R` runs under `g AND rc`; input parameters are copied to `R`'s `SBR` operands |
| AOI call | `.EnableIn := rc`; logic runs under `g AND rc`; outputs hold when it does not run |
| `TND`, `RET` | later rungs of the routine run under `g AND NOT rc` |
| forward `JMP(L)` | rungs before `LBL(L)` run under `g AND NOT rc` |
| `MCR` zone | rungs in the zone see rung-in = zone condition |
| `AFI` | `FALSE` |
| `ALMD(A,…,ProgDisable,…)` | notification := `rc AND NOT (ProgDisable OR A.ProgDisable OR A.ProgSuppress OR A.OperDisable OR A.OperSuppress OR A.OperShelve)`, the members as written by logic |
| `ALMA` | opaque (notification not analyzed) |
| `SSV` disabling a program, task or routine | reported as unsupported against its target; functions depending on the target are `NOT_ANALYZED` |
| Structured text | each assignment target and each `COP`/`CPS`/`MOV` destination receives an opaque write |
| Unknown instruction, unparsable rung | opaque writes to every tag mentioned; reported as unsupported |
| Task order | continuous, then periodic by priority, then event tasks under an opaque trigger |
| Previous scan | two passes; a value read before it is written comes from the first pass |

Opaque values are atoms that stand for "something INTERLOCK did not model". They are never assumed true or false; they take both values in the comparison. Any finding whose comparison contains one is at most MEDIUM confidence, and any opaque atom in a declared function's comparison makes the trust status `PARTIAL_COVERAGE`.

## 3. Exhaustive comparison

`compareConditions` (`logic/truth.ts`) compares the baseline condition `B` and the current condition `C` over every consistent assignment of the atoms either mentions.

### Verdicts

| Verdict | Meaning |
|---|---|
| `UNCHANGED` | `B` and `C` are the same expression node |
| `EQUIVALENT` | different expressions, same value under every assignment |
| `WEAKENED` | some assignment fired before and does not fire now; none the other way |
| `STRENGTHENED` | some assignment fires now and did not before; none the other way |
| `MIXED` | both directions occur |
| `NEVER_FIRES` | `C` is unsatisfiable while `B` was satisfiable |
| `ALWAYS_FIRES` | `C` is a tautology while `B` was not |
| `NOT_DECIDED` | the assignment space exceeds the bound |

The verdicts `WEAKENED`, `MIXED` and `NEVER_FIRES` count as a weakening. The checks are applied in the order `UNCHANGED`, `EQUIVALENT`, `NEVER_FIRES`, `ALWAYS_FIRES`, `WEAKENED`, `STRENGTHENED`, `MIXED`.

### The bound

`DEFAULT_BOUNDS = { maxAssignments: 1 << 20, maxMinimizeAtoms: 12 }`. If the number of consistent assignments exceeds 1,048,576 (2^20), the verdict is `NOT_DECIDED` with a reason that states the input count and the assignment count. It is never a guess: the function becomes `NOT_ANALYZED`, coverage drops, the trust status becomes `PARTIAL_COVERAGE`, and rule IL-R016 reports that the function could not be analyzed. A real protective function usually depends on 3 to 15 inputs; the largest fixture comparison checks 256 assignments.

### Numeric grouping

Numeric comparisons on the same tag are not independent bits: `Level > 95` implies `Level > 85`. `buildSpace` groups every comparison and range atom by the tag it tests and enumerates the group over representative values of that tag instead of over all bit combinations:

- real-valued tags: each constant, one value below the smallest (`c - 1`), the midpoint between each pair of adjacent constants, and one value above the largest (`c + 1`);
- integer tags (`SINT`…`ULINT`, `BOOL`, `.PRE`, `.ACC`): `floor(c) - 1`, `floor(c)`, `ceil(c)`, `ceil(c) + 1` for each constant.

Each representative value gives one row of truth values for the group's atoms; duplicate rows are dropped. Only rows a real value can produce are checked. In scenario 08 the permissive tests `Suction_Press_PV > 12.0` in the baseline and `Suction_Press_PV > 8.0` in the current project; the representatives 7, 8, 10, 12, 13 give three distinct rows (both false, only `> 8.0` true, both true) instead of four bit combinations, so the comparison checks 16 × 3 = 48 assignments.

### Witness and minimal forms

The witness is the differing assignment closest (Hamming distance) to a "normal operating state": the lowest-weight assignment in which the baseline condition does not fire. Examples therefore read as "everything normal, except these inputs".

When the comparison mentions at most 12 atoms, conditions are rendered as a minimal sum of products: prime implicants by Quine-McCluskey with infeasible assignments (from numeric grouping) as don't-cares, then essential primes and a deterministic greedy cover. Shared literals are factored out for display only. Beyond 12 atoms the text is a structural rendering and `ConditionText.minimal` is `false`. `lost` is the rendering of the assignments that fired before and not now; `gained` the reverse.

## 4. Inhibit proof by cofactor

`findSuppressors` (`analysis/safety.ts`) proves that a new term is an inhibit rather than inferring it from text. For each atom `X` that appears in `C` but not in `B` (numeric and range atoms excluded), and for each value `v` in `{0, 1}`:

1. Compute the Shannon cofactor `C[X := v]` with `ExprPool.restrict`.
2. Compare it with `B` exhaustively.
3. If the result is `UNCHANGED` or `EQUIVALENT`, `X` is a suppressor: with `X = v` the function is exactly the baseline function, and with `X = NOT v` it fires in fewer situations. `suppressesWhen` is `NOT v`.

The same proof is used for alarm notification paths: a weakened notification with a suppressor is `SUPPRESSED`; without one it is `DEGRADED`.

## 5. Classification precedence

When a protective firing condition is weakened, several explanations can be true at once. `classifyProtective` (`analysis/rules/protective.ts`) picks the first that applies, so each weakened function yields exactly one protective finding:

| Order | Type | Applies when |
|---|---|---|
| 0 | `PROTECTIVE_OUTPUT_BYPASSED` | the comparison is `NOT_DECIDED` but the output has a new writer: undecided never hides a bypass |
| 1 | `PROTECTIVE_OUTPUT_BYPASSED` | the output has a writer in the current scan whose `(routine, kind, instruction)` did not exist in the baseline (and the baseline had at least one writer), inside or outside the declared implementation |
| 1 | `PROTECTIVE_OUTPUT_BYPASSED` | the verdict is `NEVER_FIRES`, or the current condition is unsatisfiable |
| 2 | `PROTECTIVE_PATH_REMOVED` | a baseline writer has no counterpart that still executes (deleted rung, removed `JSR`, disabled program, inhibited task, deleted routine) |
| 3 | `NEW_INHIBIT` | at least one suppressor is proved by cofactor |
| 4 | `PROTECTIVE_PATH_REMOVED` | a non-numeric atom of the baseline condition no longer appears in the current one (a removed trip cause) |
| 5 | `SETPOINT_RELAXED` | the set of numeric comparisons on some tag differs between the two conditions |
| 6 | `SHUTDOWN_WEAKENED`, `INTERLOCK_WEAKENED`, `PERMISSIVE_WEAKENED` | weaker for a reason not listed above; the type follows the function's `kind` (`SHUTDOWN`, `TRIP` and `ALARM` map to `SHUTDOWN_WEAKENED`) |

A new writer whose value later logic in the same scan overwrites leaves the firing condition unchanged, so none of the above applies; rule IL-R020 reports it separately (see below).

A strengthened condition (`STRENGTHENED` or `ALWAYS_FIRES`) is never classified as a weakening; it is `PROTECTION_STRENGTHENED` with disposition `POSITIVE`. `ALWAYS_FIRES` additionally explains that the output is held in its safe state, which may stop the equipment from running.

## 6. Rule catalogue

Twenty rules run on every analysis (`analysis/rules/index.ts`). "Capped" means `capByCriticality(base, sf)`: the severity is the lower of the base severity and the function's declared criticality, so a weakening of a `HIGH`-criticality function is at most `HIGH`.

| Id | Type | Title | Triggered when | Severity |
|---|---|---|---|---|
| IL-R001 | `PROTECTIVE_PATH_REMOVED` | Protective path removed | precedence 2 or 4 above | CRITICAL, capped |
| IL-R002 | `NEW_INHIBIT` | New inhibit added | precedence 3 | CRITICAL, capped |
| IL-R003 | `PROTECTIVE_OUTPUT_BYPASSED` | Protective output bypassed | precedence 0 or 1 | CRITICAL, capped |
| IL-R004 | `SHUTDOWN_WEAKENED` | Shutdown condition weakened | precedence 6, kind `SHUTDOWN`/`TRIP`/`ALARM` | CRITICAL, capped |
| IL-R005 | `INTERLOCK_WEAKENED` | Interlock weakened | precedence 6, kind `INTERLOCK` | HIGH, capped |
| IL-R006 | `PERMISSIVE_WEAKENED` | Permissive weakened | precedence 6, kind `PERMISSIVE` | HIGH, capped |
| IL-R007 | `SETPOINT_RELAXED` | Trip setpoint relaxed | precedence 5 | HIGH, capped |
| IL-R008 | `ALARM_SUPPRESSED` | Alarm path suppressed | a declared alarm's notification status is `SUPPRESSED`, `DEGRADED` or `BROKEN` | CRITICAL if the function's criticality is CRITICAL, otherwise HIGH; `BROKEN` raises it one level |
| IL-R009 | `TRIP_DELAY_INCREASED` | Trip delay increased | a timer whose `.DN` or `.EN` is in a function's current cone has a larger preset than the same timer kind in the baseline (preset in the rung, or in the timer tag's stored data when the rung says `?`); or logic now writes that timer's `.PRE`; or the protective output's writer moved to a slower periodic task or to an event task | HIGH, capped; confidence MEDIUM |
| IL-R010 | `EXECUTION_CONTROL_INTRODUCED` | Execution-control instruction introduced | a `TND`, `JMP`, `MCR`, conditional `RET`, `UID`, `UIE`, `EOT`, `SFP` or `SFR` not present in the baseline routine appears in a routine inside a function's current cone; or a new disabling `SSV` targets a program, task or routine inside a function's cone (in either project), wherever the `SSV` sits | HIGH, capped (HIGH if any affected function allows it) |
| IL-R011 | `SHARED_MODULE_PROPAGATION` | Shared module modified | an AOI definition's logic (non-equivalent rung change), parameters or interface changed and it has at least two call sites | highest capped CRITICAL over impacted functions; else MEDIUM with operational instances; else LOW |
| IL-R012 | `UNDECLARED_LOGIC_CHANGED` | Undeclared routine affected | a non-equivalent logic or execution change in a program routine outside every cone and outside the declared non-safety scope | MEDIUM; disposition `UNDECLARED` |
| IL-R013 | `PROTECTION_STRENGTHENED` | Protective condition strengthened | verdict `STRENGTHENED` or `ALWAYS_FIRES` | INFO; disposition `POSITIVE` |
| IL-R014 | `COSMETIC_LOGIC_CHANGE` | Cosmetic logic change | a logic change whose rung semantics are `equivalent` | LOW; disposition `INFORMATIONAL` |
| IL-R015 | `NON_SAFETY_LOGIC_CHANGE` | Non-safety logic change | a non-equivalent logic change in declared non-safety scope that reaches no cone | INFO; disposition `INFORMATIONAL` |
| IL-R016 | `DECLARATION_UNRESOLVED` | Safety declaration does not resolve | a declared output, alarm, routine or module is missing in the current project, the declaration names neither output nor alarm, or the function could not be analyzed | HIGH if the output or alarm is missing, otherwise MEDIUM |
| IL-R017 | `MODULE_REVISION_NOT_BUMPED` | Module changed without a revision change | an AOI changed (as for IL-R011) and its `Revision` did not | LOW |
| IL-R018 | `EXTERNAL_WRITE_ACCESS_GRANTED` | External write access granted on safety tag | a tag inside a function's cone changed `ExternalAccess` to `Read/Write` | HIGH, capped (highest over affected functions) |
| IL-R019 | `ALARM_SUPPRESSED` | Alarm configuration weakened | the stored configuration of a declared ALMD alarm tag changed so that it is inverted (`Condition`), delayed (`MinDurationPRE` increased), disabled (`ProgDisable`/`OperDisable` stored true) or suppressed (`ProgSuppress`/`OperSuppress`/`OperShelve` stored true), with no rung change | CRITICAL if the function's criticality is CRITICAL, otherwise HIGH; raised one level when inverted or disabled (notification `BROKEN`) |
| IL-R020 | `PROTECTIVE_OUTPUT_BYPASSED` | New writer of a protective output (currently overridden) | a new instruction writes a declared protective output but later logic in the same scan overwrites it, so the firing condition is not weakened | HIGH, capped; confidence MEDIUM |

Further details that matter in review:

- **IL-R008** also reports an alarm that an `ALMD` drove in the baseline and a plain BOOL drives now (`DEGRADED`: acknowledgement, shelving, history and severity are lost). It does not cap by criticality: a suppressed alarm on a `LOW`-criticality function is still `HIGH`, because the operator loses the warning regardless of how the function was classified.
- **IL-R011** has disposition `REVIEW` when at least one instance executes, otherwise `INFORMATIONAL`. Instances are the module's static call sites in the current project, each classified `safety` (its backing tag is in a declared function's cone), `operational` (executes, no declared function) or `not-executed`.
- **IL-R012** groups changes per routine. A change is skipped when its anchors are inside a cone and every location it alters is in a cone, or when its anchors are outside every cone but every location it alters is inside one (the protective rules cover it). The finding adds a name hint when the before or after text of a changed rung mentions a tag whose name contains a protective fragment (`ESD`, `TRIP`, `SHUTDOWN`, `INTERLOCK`/`ILK`, `PERMISSIVE`/`PERM`, `ALARM`/`ALM`, `BYPASS`, `INHIBIT`, `OVERRIDE`, `ESTOP`, `EMERGENCY`, `SIS`, `HH`, `LL`, `SAFETY`, `PROTECT` and common abbreviations) as a segment delimited by the start or end of the name, `_`, `.` or a digit. The hint is labelled as a name-based hint, not a conclusion; it lowers confidence to MEDIUM and adds 4 to the score.
- **IL-R016** never lets an unanalyzable function pass as "no change". Its message states which declaration did not resolve.

Every rule's id, title, description and base severity are also exported as `RULE_INFO` and returned by `GET /api/rules`.

### Confidence

| Confidence | Protective and alarm findings |
|---|---|
| HIGH | the comparison was exhaustive, no atom is opaque, and no unsupported construct touches a location in the function's cone |
| MEDIUM | the comparison was exhaustive but involves an opaque atom, or an unsupported construct touches the cone |
| LOW | the comparison was not exhaustive |

When effects are grouped into one finding, the finding takes the lowest confidence and the highest severity of the group. The per-function result confidence is LOW for `NOT_ANALYZED`, MEDIUM when either comparison contains an opaque atom, HIGH otherwise.

## 7. Grouping

Effects with the same `groupKey` become one finding. Protective effects group on finding type, the sorted change ids and the suppressor labels with their instance prefix removed. That is why one edit to `AOI_PumpInterlock` that introduces `PUMP_01_IL.Maint_Bypass`, `PUMP_02_IL.Maint_Bypass` and `PUMP_03_IL.Maint_Bypass` as inhibits is one `NEW_INHIBIT` finding covering SF-02, SF-03 and SF-04, with the other functions' before/after conditions appended to its explanation. Alarm effects group on status, change ids and suppressors; module, undeclared, cosmetic and other effects group per module, routine or change.

## 8. Ranking

`buildFindings` (`analysis/findings.ts`) scores every finding:

```
score =  SEV[severity]                                  CRITICAL 100 · HIGH 70 · MEDIUM 45 · LOW 20 · INFO 5
       + CRIT[highest criticality of affected functions] CRITICAL 15 · HIGH 10 · MEDIUM 5 · LOW 0   (0 when no function)
       + 5 × min(4, log2(1 + affectedFunctions + safetyRelevantInstances))
       + NOTIF[notificationImpact]                      BROKEN 8 · SUPPRESSED 4 · DEGRADED 2 · NONE 0
       + bonus                                          maximum bonus among the grouped effects
       + CONF[confidence]                               HIGH 0 · MEDIUM -3 · LOW -8

if disposition is POSITIVE or INFORMATIONAL: score = min(score, 30)
score is rounded to one decimal
```

Rule bonuses, exactly as implemented:

| Rule | Bonus |
|---|---|
| IL-R003 `PROTECTIVE_OUTPUT_BYPASSED` | +6 |
| IL-R002 `NEW_INHIBIT` | +6 when the first suppressor's location has external access `Read/Write` |
| IL-R011 `SHARED_MODULE_PROPAGATION` | +2 per safety-relevant instance, at most +10 |
| IL-R012 `UNDECLARED_LOGIC_CHANGED` | +4 when a name hint is present |
| IL-R018 `EXTERNAL_WRITE_ACCESS_GRANTED` | +4 |
| all others | 0 |

`safetyRelevantInstances` comes from the finding's blast radius: the effect's own, or, for a finding attached to a changed module, that module's executed instances with a declared function.

Findings are sorted by score (descending), then severity, then a fixed type order (`PROTECTIVE_OUTPUT_BYPASSED`, `PROTECTIVE_PATH_REMOVED`, `NEW_INHIBIT`, `SHUTDOWN_WEAKENED`, `ALARM_SUPPRESSED`, then everything else), then fingerprint. They are numbered `IL-0001…` in that order, and `rank` is the position.

Worked scores from the fixtures:

| Scenario | Finding | Calculation | Score |
|---|---|---|---|
| 02 | `NEW_INHIBIT` on SF-06 | 100 + 15 + 5·log2(2) + 0 + 6 + 0 | 126 |
| 02 | `ALARM_SUPPRESSED` on SF-06 | 100 + 15 + 5·log2(2) + 4 + 0 + 0 | 124 |
| 04 | `NEW_INHIBIT` on SF-02/03/04 | 100 + 15 + 5·log2(1+3+3) + 0 + 6 + 0 | 135 |
| 04 | `SHARED_MODULE_PROPAGATION` | 100 + 15 + 5·log2(7) + 0 + min(10, 2·3) + 0 | 135 |
| 04 | `ALARM_SUPPRESSED` on SF-02 | 100 + 15 + 5·log2(1+1+3) + 4 + 0 + 0 | 130.6 |
| 08 | `SETPOINT_RELAXED` on SF-08 | 70 + 10 + 5·log2(2) + 0 + 0 + 0 | 85 |
| 06 | `UNDECLARED_LOGIC_CHANGED`, PUMP_05 (name hint) | 45 + 0 + 0 + 0 + 4 − 3 | 46 |
| 01 | `COSMETIC_LOGIC_CHANGE` on five functions | 20 + 15 + 5·log2(6) = 47.9, capped | 30 |

The two 135-point findings in scenario 04 tie on score and severity; `NEW_INHIBIT` precedes `SHARED_MODULE_PROPAGATION` in the type order, so it is IL-0001.

Ordering is by disposition first: every `REVIEW` and `UNDECLARED` finding precedes every `INFORMATIONAL` and `POSITIVE` one, whatever their scores. Within each group findings sort by score, then severity, then finding type, then fingerprint, so the order is total and deterministic.

## 9. Coverage

Coverage (`coverageOf` in `analysis/pipeline.ts`) is four ratios and their mean:

| Ratio | Covered | Total |
|---|---|---|
| `safetyFunctions` | declared functions whose status is not `NOT_ANALYZED` | declared functions |
| `declaredRoutines` | distinct declared `program/routine` pairs whose routine exists in the current project, is RLL, is not source-protected and executes | distinct declared `program/routine` pairs |
| `moduleRelationships` | static AOI call sites in program RLL routines whose definition is not source-protected | static AOI call sites |
| `notificationPaths` | functions with a declared alarm whose notification status is not `NOT_ANALYZED` | functions with a declared alarm |

```
percent = floor( mean(covered / total over the ratios whose total > 0) × 100 ),  0 when no ratio has a total
```

`coverage.unsupported` lists every unsupported construct the two scans met (`ROUTINE_TYPE`, `INSTRUCTION`, `PROTECTED_CONTENT`, `EXECUTION_CONTROL`, `BOUND_EXCEEDED`, `UNRESOLVED_REFERENCE`), deduplicated per side, each flagged `inSafetyCone` (it touches a location or rung in a declared function's cone on that side) and `changed` (its routine has a logic or execution change).

Scenario 09 shows the ratios at work: the `JSR(PUMP_03,0)` call was deleted, so the declared routine `PumpControl/PUMP_03` no longer executes. `declaredRoutines` is 7/8 and the other three ratios are complete: `floor((1 + 0.875 + 1 + 1) / 4 × 100) = 96`.

## 10. Trust

Trust (`trustOf`) is one of three statuses, decided in this order:

| Status | Condition |
|---|---|
| `PARTIAL_COVERAGE` | any declared function is `NOT_ANALYZED`; or any unsupported construct is inside a safety cone; or the current project executes logic INTERLOCK cannot read (a `PROTECTED_CONTENT` construct, or a `ROUTINE_TYPE` construct other than structured text: FBD, SFC, unknown); or any function's comparison contains an opaque atom (an unmodeled condition or an event-task trigger); or a declared protective output is shadowed by a different tag in the current project |
| `REVIEW_REQUIRED` | otherwise, if any undeclared routine is affected, or any changed logic outside the cones contains an unsupported construct |
| `VERIFIED_SCOPE` | otherwise |

`VERIFIED_SCOPE` carries the reason "This verifies the declared scope only. It is not a statement that the project is secure." INTERLOCK has no status that means "safe".

Trust does not consider the coverage percentage directly. In scenario 09 coverage is 96% and trust is `VERIFIED_SCOPE`, because every function was analyzed and the routine that stopped executing is itself the subject of a HIGH finding.

### Per-function status

Each declared function gets one status (`safetyResult` in `analysis/pipeline.ts`), decided in this order:

| Status | Condition |
|---|---|
| `NOT_ANALYZED` | a declared path (protective output or alarm) could not be compared in both projects, a comparison was `NOT_DECIDED`, the output or alarm did not resolve, or an unsupported construct touches a location, routine or target in the function's current cone |
| `IMPACTED` | the protective condition is weakened, the notification path is `SUPPRESSED`, `DEGRADED` or `BROKEN`, or a `REVIEW` finding of type `TRIP_DELAY_INCREASED`, `EXECUTION_CONTROL_INTRODUCED`, `EXTERNAL_WRITE_ACCESS_GRANTED`, `ALARM_SUPPRESSED` or `PROTECTIVE_OUTPUT_BYPASSED` names the function |
| `STRENGTHENED` | the protective verdict is `STRENGTHENED` or `ALWAYS_FIRES` |
| `CHANGED_EQUIVALENT` | logic, execution, interface or configuration changes fall inside the cone, or the verdict is `EQUIVALENT`, and nothing above applies |
| `NO_CHANGE` | otherwise |

## 11. Review surface

`surfaceOf` reduces the change set to what needs review:

| Field | Definition |
|---|---|
| `totalChanges` | every structural change |
| `meaningfulLogicChanges` | logic, execution and interface changes that are not `equivalent`, plus every configuration change |
| `safetyRelevant` | meaningful changes whose anchors fall inside some function's cone |
| `notificationPathChanges` | functions whose notification status is `SUPPRESSED`, `DEGRADED` or `BROKEN` |
| `sharedModulesWithSafetyImpact` | changed modules with at least one executed safety-relevant instance |
| `blastRadius` | largest instance count among changed modules |
| `undeclaredAffected` | routines in the undeclared list (undeclared findings plus executed operational instances of changed modules) |
| `reviewOrder` | every `REVIEW` and `UNDECLARED` finding, in rank order |
| `priority` | highest severity in `reviewOrder`, or `NONE` |

In scenario 08 that is 425 total changes (400 documentation, 21 data, 3 logic, 1 metadata) reduced to 2 meaningful logic changes, 1 safety-relevant, and a review order of two findings.

## 12. Worked examples

All four are real output on the synthetic Northgate pump station fixtures.

### Scenario 02: a new inhibit on a shutdown

One contact added to the compressor high-pressure shutdown rung (`Compressor/Main` rung 0):

```
before  XIC(PT201_High)XIC(Safety_Enable)OTE(C201_Shutdown_Cmd);
after   XIC(PT201_High)XIC(Safety_Enable)XIO(Maintenance_Mode)OTE(C201_Shutdown_Cmd);
```

SF-06 declares `C201_Shutdown_Cmd` with trip state `ENERGIZE`, so its firing condition is the output itself. The comparison has three atoms (8 assignments) and the verdict is `WEAKENED`. `Maintenance_Mode` is the only new atom; `C[Maintenance_Mode := 0]` is exactly `PT201_High AND Safety_Enable`, so it is a proved inhibit.

```
IL-0001 CRITICAL  NEW_INHIBIT  [SF-06]  Shutdown condition weakened by new inhibit
Maintenance_Mode now suppresses Compressor C-201 High-Pressure Shutdown.
In the baseline, the shutdown acts (C201_Shutdown_Cmd = 1) when: PT201_High AND Safety_Enable.
In the current project, it acts when: PT201_High AND Safety_Enable AND NOT Maintenance_Mode.
The new term Maintenance_Mode is an inhibit: with Maintenance_Mode = 0 the current condition is exactly
the baseline condition, and with Maintenance_Mode = 1 the shutdown does not act. Proved over 8 input combinations.
No executing logic writes Maintenance_Mode; its value comes from outside the controller logic (an input, an HMI or another client).
Maintenance_Mode has external access Read/Write: an HMI or OPC client can set it.
Example: with PT201_High = 1, Safety_Enable = 1, Maintenance_Mode = 1, the shutdown acted in the baseline and does not act now.
```

The alarm `C201_Shutdown_Alm` is raised by `XIC(C201_Shutdown_Cmd)ALMD(…)` in `Alarms/Main`, which runs after `Compressor` in `MainTask`, so it loses exactly the same cases. The notification analysis proves the same suppressor and reports IL-0002 `ALARM_SUPPRESSED` (CRITICAL, notification impact `SUPPRESSED`): `Condition → Logic (inhibited) → Alarm (inhibited) → HMI (inhibited) → Operator (inhibited)`.

### Scenario 04: one definition, five instances

`AOI_PumpInterlock` goes from revision 3.4 to 3.5, gains an optional input `Maint_Bypass`, and its trip rung becomes:

```
before  [XIC(Level_HH) ,XIC(Press_Trip) ,XIC(Motor_Temp_Hi) ,XIC(ESD_Active) ]OTE(Trip);
after   [XIC(Level_HH) ,XIC(Press_Trip) ,XIC(Motor_Temp_Hi) ,XIC(ESD_Active) ]XIO(Maint_Bypass)OTE(Trip);
```

The structural diff has 9 changes; 5 of them are stored-value changes to the backing tags (each gained a `Maint_Bypass=0` member). The scan executes the new definition at all five call sites. Three call sites are inside declared functions (SF-02, SF-03, SF-04); `PUMP_04_IL` and `PUMP_05_IL` execute with no declared function.

```
IL-0001 CRITICAL NEW_INHIBIT                [SF-02,SF-03,SF-04] Shutdown condition weakened by new inhibit
IL-0002 CRITICAL SHARED_MODULE_PROPAGATION  [SF-02,SF-03,SF-04] Shared module AOI_PumpInterlock modified: 5 instances affected
IL-0003 CRITICAL ALARM_SUPPRESSED           [SF-02]             Alarm path suppressed by new inhibit
trust REVIEW_REQUIRED: 2 undeclared routines affected: PumpControl/PUMP_04, PumpControl/PUMP_05.
```

The `NEW_INHIBIT` finding proves `PUMP_01_IL.Maint_Bypass` as the inhibit over 256 assignments and states that it is `Read/Write` and written by no logic. The module finding reads: "1 definition changed; 5 downstream instantiations affected (3 safety-relevant, 2 operational)." The two operational instances are not called safe: they are listed as undeclared routines, and the trust status is `REVIEW_REQUIRED`.

### Scenario 08: a relaxed setpoint in a noisy export

A 24-pump export with 425 changes, 400 of them description and comment edits. The pump start permissive (SF-08, `PERMISSIVE`, criticality `HIGH`, output `Pump_Start_Permissive` with trip state `DE_ENERGIZE`) changes one constant:

```
before  XIC(MCC_Main_Enable)XIO(LSHH_101)GRT(Suction_Press_PV,12.0)OTE(Pump_Start_Permissive);
after   XIC(MCC_Main_Enable)XIO(LSHH_101)GRT(Suction_Press_PV,8.0)OTE(Pump_Start_Permissive);
```

```
IL-0001 HIGH  SETPOINT_RELAXED  [SF-08]  Permissive setpoint relaxed on Suction_Press_PV
Suction_Press_PV > 12.0 became Suction_Press_PV > 8.0: Pump Start Permissive acts in fewer situations.
In the baseline, the permissive acts (Pump_Start_Permissive = 0) when:
  ESD_Remote_Cmd OR Fire_Detected OR LSHH_101 OR NOT EStop_Healthy OR Suction_Press_PV <= 12.0.
In the current project, it acts when:
  ESD_Remote_Cmd OR Fire_Detected OR LSHH_101 OR NOT EStop_Healthy OR Suction_Press_PV <= 8.0.
IMPACT: No longer acts when: EStop_Healthy AND NOT ESD_Remote_Cmd AND NOT Fire_Detected AND NOT LSHH_101
        AND Suction_Press_PV <= 12.0 AND Suction_Press_PV > 8.0.
```

No new boolean atom appears and none disappears, so precedence 5 applies. Severity is HIGH: the base severity of `SETPOINT_RELAXED`, also the function's criticality. The export's other two logic changes are the compressor low-suction timer preset (2000 to 10000 ms), outside every declared cone and therefore `UNDECLARED_LOGIC_CHANGED` (MEDIUM), and a reordered ESD rung proved equivalent (`COSMETIC_LOGIC_CHANGE`, LOW, informational).

### Scenario 09: protective paths removed

Two edits: `XIO(Fire_Detected)` is removed from the ESD rung, and the rung `JSR(PUMP_03,0);` is deleted from `PumpControl/Main`.

```
IL-0001 CRITICAL PROTECTIVE_PATH_REMOVED [SF-01,SF-02,SF-03,SF-08] Protective path removed: Fire_Detected no longer trips Emergency Shutdown
IL-0002 CRITICAL ALARM_SUPPRESSED        [SF-01,SF-02]             Alarm notifies in fewer situations
IL-0003 HIGH     PROTECTIVE_PATH_REMOVED [SF-04]                   Protective path removed: Pump P-103 Low-Pressure Trip logic no longer executes
```

`Fire_Detected` was an atom of the baseline ESD condition and is absent from the current one, so precedence 4 applies. Because `MCC_Main_Enable` feeds `ESD_Active`, which feeds every pump interlock, and also feeds the start permissive, the same edit weakens SF-02, SF-03 and SF-08, and the finding lists each function's before and after condition. The ESD horn notifies in fewer situations; no single atom restores the baseline, so the path is `DEGRADED`, not `SUPPRESSED`.

For SF-04 the baseline writer of `Pump_03_Run_Enable` (the AOI call in `PumpControl/PUMP_03`) has no executing counterpart: "routine PumpControl/PUMP_03 no longer executes (routine is not called from any executing routine)". The current firing condition is `NOT Pump_03_Run_Enable`, the output's own start-of-scan value, because nothing writes it any more. The verdict is `MIXED`, and the finding says so: "The change also makes the trip act in new situations", which is the honest consequence of an output that now only holds its previous value. Severity is HIGH because SF-04's criticality is HIGH.

## 13. Cross-project drift (experimental)

`analyzeDrift` (`analysis/drift.ts`) groups same-named AOI definitions across two or more projects by a content hash of their parameters, local tags and normalized logic (descriptions and revision excluded). The reference variant is the highest revision, then the variant at most sites; a remaining tie keeps input order. Each other variant's output parameters are compared with the reference's by running the module logic in isolation, every input a free atom.

Direction needs a declaration. An output parameter gets a trip state only when a declared protective output is bound to it at a call site; then a weakened comparison is `WEAKER` and a strengthened one `STRONGER`. Without a declaration a difference is `DIFFERENT`, never guessed. Flags: `SAME_NAME_DIFFERENT_DEFINITION`, `REVISION_NOT_BUMPED` (two definitions claim one revision), `OLDER_REVISION`, `SAFETY_BEHAVIOR_DIFFERS`, `MISSING_AT_SITE`.

Scenario 07 with the Northgate manifest: `AOI_PumpInterlock` is `DRIFT` with all four content flags. Site B claims revision 3.4 but lost `XIC(Motor_Temp_Hi)` from the trip rung; Site C runs revision 3.1 without the `ESD_Active` input. Both are `WEAKER` on `Run_Enable (acts at 0)`. `AOI_ValveCtl` exists only at Site C and is flagged `MISSING_AT_SITE` for Sites A and B. Without a manifest the same variants are reported as `DIFFERENT`.
