# Safety declarations

INTERLOCK never infers that logic is safety-relevant from its shape. An engineer declares what each safety function is supposed to do: its protective output and the state that output takes when the function acts, its alarm, and where it is implemented. Every safety conclusion is relative to these declarations, and logic outside every declared function is reported as UNDECLARED, never as safe.

The declarations are a JSON document with the schema id `interlock.safety/v1`, conventionally named `<project>.safety.json`. The reference example is `fixtures/manifests/northgate.safety.json`. The document is validated by `packages/core/src/analysis/manifest.ts` (zod, strict mode) before any analysis runs; an invalid document stops the analysis with the list of issues.

## Example

```json
{
  "schema": "interlock.safety/v1",
  "project": "Northgate Pump Station",
  "functions": [
    {
      "id": "SF-02",
      "name": "Pump P-101 High-Level Shutdown",
      "description": "Stops P-101 on wet well high-high, discharge pressure high, motor over-temperature or station ESD.",
      "kind": "SHUTDOWN",
      "criticality": "CRITICAL",
      "implementation": { "program": "PumpControl", "routine": "PUMP_01", "module": "AOI_PumpInterlock", "instance": "PUMP_01_IL" },
      "protectiveOutput": { "tag": "Pump_01_Run_Enable", "tripState": "DE_ENERGIZE" },
      "alarm": { "tag": "Pump_01_Shutdown_Alarm", "notification": "HMI alarm summary, Control Room A" }
    },
    {
      "id": "SF-06",
      "name": "Compressor C-201 High-Pressure Shutdown",
      "kind": "SHUTDOWN",
      "criticality": "CRITICAL",
      "implementation": { "program": "Compressor", "routine": "Main" },
      "protectiveOutput": { "tag": "C201_Shutdown_Cmd", "tripState": "ENERGIZE" },
      "alarm": { "tag": "C201_Shutdown_Alm", "notification": "HMI alarm summary, Control Room A" },
      "enableCondition": "Safety_Enable"
    },
    {
      "id": "SF-07",
      "name": "Tank T-101 High-High Level Alarm",
      "kind": "ALARM",
      "criticality": "CRITICAL",
      "implementation": { "program": "Alarms", "routine": "Main" },
      "alarm": { "tag": "LT101_HH_Alm", "notification": "HMI alarm summary, Control Room A" }
    }
  ],
  "nonSafetyScope": { "programs": ["Utilities", "Reporting"] }
}
```

## Fields

### Document

| Field | Type | Required | Rules |
|---|---|---|---|
| `schema` | string | yes | exactly `"interlock.safety/v1"` |
| `project` | string | no | free text for humans, at most 200 characters |
| `functions` | array of functions | yes | at most 500; may be empty |
| `nonSafetyScope` | object | no | see below |

### Function

| Field | Type | Required | Rules |
|---|---|---|---|
| `id` | string | yes | 1 to 32 characters, letters, digits, `-` and `_` only; unique within the document, compared case-insensitively |
| `name` | string | yes | 1 to 160 characters |
| `description` | string | no | at most 2,000 characters; informational |
| `kind` | enum | yes | `SHUTDOWN`, `TRIP`, `INTERLOCK`, `PERMISSIVE`, `ALARM` |
| `criticality` | enum | yes | `CRITICAL`, `HIGH`, `MEDIUM`, `LOW` |
| `implementation` | object | yes | may be `{}`; fields below |
| `protectiveOutput` | object | see rules | `{ "tag": <name>, "tripState": "DE_ENERGIZE" \| "ENERGIZE" }` |
| `alarm` | object | see rules | `{ "tag": <name>, "notification"?: <text, at most 300 characters> }` |
| `enableCondition` | string | no | at most 200 characters; informational, not analyzed |
| `notes` | string | no | at most 4,000 characters; informational |

### Implementation

| Field | Meaning |
|---|---|
| `program` | program that holds the implementing routine |
| `routine` | routine name inside `program` |
| `module` | Add-On Instruction that implements the function |
| `instance` | backing tag of the AOI instance, e.g. `PUMP_01_IL` |

All four are optional names.

### Non-safety scope

| Field | Type | Rules |
|---|---|---|
| `programs` | array of names | at most 1,000; every routine of these programs is declared non-safety |
| `routines` | array of strings | at most 5,000; each `"Program/Routine"`, 1 to 300 characters |

Matching is case-insensitive. Logic changes there that reach no declared function are `NON_SAFETY_LOGIC_CHANGE` (INFO). Changes there that do reach a declared function are still analyzed through that function.

## Validation rules

Applied by `validateManifest` in this order:

1. **Shape.** The document and every nested object are strict: unknown keys are rejected. Types and enums must match.
2. **Strings.** Every string has invisible and bidirectional control characters removed and is trimmed before its length is checked.
3. **Names.** `implementation.*`, `protectiveOutput.tag`, `alarm.tag` and `nonSafetyScope.programs[]` must be 1 to 200 characters matching `^[\\A-Za-z_][A-Za-z0-9_.:[\]\\]*$`: a Logix tag or routine reference such as `Pump_01_Run_Enable`, `\Safety.Trip_Bit`, `PUMP_01_IL.Shutdown_Alarm` or `Local:3:I.Data.4`.
4. **Ids.** No two functions may share an id (case-insensitive).
5. **Something to analyze.** Every function declares a `protectiveOutput`, an `alarm`, or both.
6. **Alarm functions.** A function of kind `ALARM` must declare an `alarm`.

Rules 4 to 6 run only once the shape, string and name rules pass. Issues are reported as `path: message`. Real examples:

```
functions.0.protectiveOutput.tripState: Invalid option: expected one of "DE_ENERGIZE"|"ENERGIZE"
functions.1.protectiveOutput.tag: must be a tag or routine name
functions.1: Unrecognized key: "extra"
functions.1.id: duplicate id SF-1
functions.0: declare a protectiveOutput, an alarm, or both
functions.1: an ALARM function needs an alarm
```

At most 50 schema issues are returned. `parseManifestText` additionally refuses text over 2 MiB (2,097,152 characters) and reports JSON syntax errors (`Not valid JSON: …`); it never throws.

## Semantics

### Trip state

| `tripState` | The function acts when the output | Firing condition |
|---|---|---|
| `DE_ENERGIZE` | goes to 0 (fail-safe run enable, permit) | `NOT output` |
| `ENERGIZE` | goes to 1 (trip command, close-valve command) | `output` |

Getting this wrong inverts every conclusion for the function: a weakening reads as a strengthening. Check it against the electrical design.

### Kind

`kind` changes the wording of findings and the type of a generic weakening: `INTERLOCK` gives `INTERLOCK_WEAKENED` (HIGH), `PERMISSIVE` gives `PERMISSIVE_WEAKENED` (HIGH), `SHUTDOWN`, `TRIP` and `ALARM` give `SHUTDOWN_WEAKENED` (CRITICAL). More specific types (bypass, removed path, new inhibit, relaxed setpoint) apply to every kind.

### Criticality

Criticality caps the severity of every weakening of the function (`capByCriticality`): a `HIGH`-criticality function never produces a `CRITICAL` protective finding. It also adds to the ranking score (CRITICAL 15, HIGH 10, MEDIUM 5, LOW 0). Alarm suppression is the exception: it is CRITICAL for a CRITICAL function and HIGH otherwise, raised one level when the path is broken. See [analysis-methodology.md](analysis-methodology.md#6-rule-catalogue).

### Tag resolution

A declared tag is resolved in `implementation.program`'s scope first, then controller scope; if no program is given, controller scope and then every program in file order. `\Program.Tag` names a program-scoped tag explicitly. A member reference (`PUMP_01_IL.Shutdown_Alarm`) is allowed. Aliases resolve to their target. A declaration that does not resolve in the current project produces `DECLARATION_UNRESOLVED` and the function is `NOT_ANALYZED`; it is never treated as unchanged.

### Alarm

An alarm tag may be an `ALARM_DIGITAL` tag driven by an `ALMD` instruction (the notification condition includes the `ProgDisable` operand and logic writes to the `ProgDisable`, `ProgSuppress`, `OperDisable`, `OperSuppress` and `OperShelve` members; the alarm configuration stored in the tag is compared too) or a BOOL tag the HMI reads. Replacing an ALMD-driven alarm with a plain BOOL is reported as a degraded notification path. An `ALMA` (analog) alarm is not analyzed. The `notification` text describes the downstream path (HMI, control room); the project file cannot prove that link, so INTERLOCK shows it as DECLARED.

### Implementation and instance

`implementation` locates the function for people and for coverage (a declared routine that is missing, not ladder, protected or not executed lowers the `declaredRoutines` coverage ratio). It does not limit the analysis: the firing condition always comes from the whole scan, so logic anywhere in the project that affects the declared output is found. `module` and `instance` are checked for consistency: a missing module produces `DECLARATION_UNRESOLVED`, and an instance that is not a tag of that AOI's type is recorded in the function's notes. In drift analysis, a function whose `module` is the drifting AOI and whose `protectiveOutput.tag` is bound to one of its output parameters at a call site gives that parameter its protective direction.

## Writing good declarations

- Declare the output that actually stops the equipment (the run enable or trip command sent to the field), not an intermediate bit. Intermediate logic is part of the firing condition automatically.
- Declare one function per protective output. A pump protected by an AOI instance is one function, with the instance named.
- Put purely operational programs in `nonSafetyScope`. Leave anything you are unsure about undeclared: undeclared logic is reported for review, while non-safety logic is reported as informational.
- Keep the manifest under version control next to the project and review it with every change that adds, renames or removes protective logic.
