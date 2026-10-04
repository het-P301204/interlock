# Supported formats

INTERLOCK reads exported project files. It never talks to a controller or an engineering tool; you export the project, INTERLOCK reads the export.

| Format | Vendor | Extension | Status | Adapter id | Detected by |
|---|---|---|---|---|---|
| Logix Designer export (L5X) | Rockwell Automation | `.L5X` | **SUPPORTED** | `rockwell-l5x` 1.0.0 | `.l5x` extension (any case), or `<RSLogix5000Content` in the first 4,096 characters |
| PLCopen XML (IEC 61131-3 TC6) | PLCopen | `.xml` | PLANNED | `plcopen-xml` | `<project` and `http://www.plcopen.org/xml/tc6` in the first 4,096 characters |
| TIA Portal Openness XML | Siemens | `.xml` | PLANNED | `siemens-tia-openness` | `<Document>` and `<Engineering version=` in the first 4,096 characters |
| EcoStruxure Control Expert / Unity Pro (XEF) | Schneider Electric | `.xef` | PLANNED | `schneider-xef` | `<FEFExchangeFile` in the first 4,096 characters |

PLANNED means INTERLOCK recognizes the file and declines it honestly with `FORMAT_NOT_SUPPORTED`: "Detected PLCopen XML. INTERLOCK does not parse this format yet; it is on the roadmap. Export the project as Rockwell L5X to analyze it today." It never pretends to parse a format it does not support. `GET /api/adapters` and the web UI list the same four entries with their status.

Any other extension is refused before the content is examined (`EXTENSION_NOT_ALLOWED`). An allowed extension with unrecognized content is `FORMAT_UNRECOGNIZED`.

## Encoding

UTF-8 with or without a BOM (what Logix Designer writes), and UTF-16 LE or BE with a BOM or an unmistakable leading `<`. Decoding is strict: an invalid byte sequence is `ENCODING_INVALID` with its byte offset; nothing is silently replaced. If the XML declaration names another encoding, the error says so.

## Rockwell L5X

### What is read

| Element | Read into the model |
|---|---|
| `RSLogix5000Content` (root) | `SchemaRevision`, `SoftwareRevision`, `TargetName`, `TargetType`, `ContainsContext`, `ExportDate` (kept as text, never parsed) |
| `Controller` | `Name`, `ProcessorType`, `MajorRev.MinorRev` as firmware revision |
| `DataTypes/DataType` | name, family, members (name, data type, hidden) |
| `AddOnInstructionDefinitions/AddOnInstructionDefinition` | name, `Revision`, `RevisionExtension`, `Vendor`, description, `EditedDate`, signature id; parameters in declaration order (excluding `EnableIn`/`EnableOut`) with usage, data type, required, visible, external access, default value, description; local tags; routines |
| `Tags/Tag` (controller and program scope) | name, `TagType` (Base, Alias, Produced, Consumed), `DataType`, `AliasFor`, `Dimensions`, `Constant`, `ExternalAccess` (absent means `Read/Write`, the Logix default), description, stored value as a canonical text with structure members sorted (for `ALARM_DIGITAL` tags: the alarm configuration `Severity`, `MinDurationPRE`, `ShelveDuration`, `MaxShelveDuration`, `Condition`, `AckRequired`, `Latched` and the stored disable, suppress and shelve flags, plus the alarm message; runtime state is left out) |
| `Programs/Program` | name, `Disabled`, `MainRoutineName`, `FaultRoutineName`, `Class`, description, program tags, routines, child programs |
| `Routine` | name, `Type`, description, rungs (number, text, comment, edit type) or structured-text lines |
| `Tasks/Task` | name, `Type`, `Priority`, `Rate`, `Watchdog`, `InhibitTask`, `DisableUpdateOutputs`, description, scheduled programs in order |

Every entity keeps its source position: an XPath-like path (`/RSLogix5000Content/Controller[@Name='NORTHGATE_PS']/Programs/Program[@Name='Compressor']/Routines/Routine[@Name='Main']/RLLContent/Rung[@Number='0']`), line and column. Evidence items cite these positions.

Not read: `Modules` (I/O tree), `Trends`, `DataLogs`, `CST`, `WallClockTime`, `TimeSynchronize`, `EthernetPorts`, `RedundancyInfo`, `Security`, `SafetyInfo`, and other controller-level elements. Changes to them are not detected.

### Variants handled

- Descriptions and comments as direct CDATA, or as `<LocalizedDescription>`/`<LocalizedComment>` children (with `AllProjDocTrans` exports); `en-US` is preferred, else the first.
- Program-scoped tags inside `<Program><Tags>`; `\Program.Tag` references.
- Source protection: an `<EncodedData EncodedType="Routine">` in place of a routine, or `<EncodedData EncodedType="AddOnInstructionDefinition">` in place of an AOI, is kept as a protected routine or module with no logic and a `L5X_PROTECTED_CONTENT` warning. A protected AOI keeps its visible parameters.
- Rung text with newlines and spaces before `,` and `]` is kept exactly as exported, trimmed at both ends.
- Rungs with an edit type other than `N` (pending or test edits) are kept and reported (`L5X_PENDING_RUNG_EDIT`).
- Partial exports (`TargetType` of `Program`, `AddOnInstructionDefinition`, `Routine`, `Rung`): parsed as far as they go, with an info diagnostic that references outside the component cannot be resolved and scheduling may be missing.
- A routine without a `Type` attribute: the type is inferred from its content element, with a warning.

### Routine types

| Type | Status | What happens |
|---|---|---|
| RLL (ladder) | **Analyzed** | Rungs are parsed and executed symbolically; firing conditions are compared exhaustively. |
| ST (structured text) | Parsed structurally | Lines are kept for display and line-level diff (marked `unknown` semantics). In an executing ST routine, every assignment target (`X := …`) is recorded as an unanalyzed (opaque) write, so an ST routine that writes a protective output still appears as a writer. The ST logic itself is not interpreted. |
| FBD (function block diagram) | Parsed structurally | The routine exists in the model (name, type, description, protection). Its diagram is not read: its writes are invisible to the scan. If it executes, trust is `PARTIAL_COVERAGE`. Adding, removing, retyping or protecting it is detected. |
| SFC (sequential function chart) | Parsed structurally | As FBD. |
| anything else | Not read | Warning `L5X_UNSUPPORTED_ROUTINE_TYPE`; treated like FBD. |

"Parsed structurally" therefore means: the routine is part of the project structure, the diff and the reuse graph; INTERLOCK does not claim to know what it computes, and it says so in coverage and trust.

### Diagnostics and refusals

Errors stop the analysis; the project is not analyzed on a model that cannot be trusted. Examples: `L5X_WRONG_ROOT`, `L5X_NO_CONTROLLER`, `L5X_MULTIPLE_CONTROLLERS`, `L5X_MISSING_NAME`, `L5X_RUNG_WITHOUT_TEXT`, `L5X_AMBIGUOUS_RUNG_TEXT`, `L5X_INVALID_PARAMETER_USAGE`, plus every `XML_*` parse error.

Warnings keep the analysis going with a stated assumption. Examples: `L5X_DUPLICATE_NAME` (Logix names are case-insensitive; both definitions are kept), `L5X_INVALID_NAME`, `L5X_NAME_TOO_LONG` (over 40 characters), `L5X_UNKNOWN_EXTERNAL_ACCESS` (recorded as Unknown, treated as possibly writable), `L5X_UNEXPECTED_ELEMENT`, `L5X_MAIN_ROUTINE_MISSING`, `L5X_UNKNOWN_SCHEDULED_PROGRAM`, `L5X_PROGRAM_SCHEDULED_TWICE`, `TEXT_INVISIBLE_CHARACTERS`.

Info: `L5X_PARTIAL_EXPORT`, `L5X_PROGRAM_DISABLED`, `L5X_TASK_INHIBITED`, `L5X_UNSCHEDULED_PROGRAM`, `L5X_NO_MAIN_ROUTINE`, `L5X_ROUTINE_NOT_ANALYZED`, `L5X_PENDING_RUNG_EDIT`.

A version with any warning is `READY_WITH_WARNINGS`; otherwise `READY`.

### Tested against

The L5X adapter has been tested against the synthetic Northgate pump station exports in `fixtures/l5x/` (laid out like Logix Designer v35 full-controller exports), the hand-written sample in `packages/core/test/l5x/sample.ts`, the hostile files in `fixtures/adversarial/`, and property-based mutations of the sample. It has not been tested against an export from a real plant.
