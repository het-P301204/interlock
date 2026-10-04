# Command line

`apps/cli` runs the engine in process. It is meant for change review in CI: analyze the approved export against the proposed one, publish the findings, and fail the job when a safety-relevant finding needs review. It reads only the files named on the command line and writes only `--out`.

```bash
node apps/cli/src/main.ts <command> [options]
npm run interlock -- <command> [options]          # same thing through the root script
```

## Commands

| Command | What it does |
|---|---|
| `inspect <file>` | parse one export and summarize it (format, controller, counts, readiness, diagnostics) |
| `analyze <baseline> <current> --manifest <safety.json>` | full analysis of two versions |
| `drift <label=file> <label=file>... [--manifest <safety.json>]` | cross-project module drift (experimental); a bare path uses its file name as the label |
| `scenarios` | list the built-in synthetic scenarios |
| `scenario <id>` | run one built-in scenario (`01`…`09`, `4`, or a slug such as `aoi-modified`) |

`analyze` requires `--manifest`: INTERLOCK only reasons relative to declared safety functions.

## Options

| Option | Meaning |
|---|---|
| `-m, --manifest <file>` | safety declarations (`interlock.safety/v1`, at most 2 MB) |
| `-f, --format <fmt>` | `text` (default), `json`, `md`, `csv`, `pdf`, `sarif`; `inspect` and `drift` accept `text` and `json` |
| `-o, --out <file>` | write the output to a file instead of stdout |
| `--fail-on <level>` | `critical`, `high` (default), `medium`, `low` or `none` |
| `--no-color` | plain output (`NO_COLOR` is honoured; `FORCE_COLOR` forces colour) |
| `-h, --help` | usage |
| `-V, --version` | `interlock 0.1.0 (engine 1.0.0)` |

Input files larger than `INTERLOCK_MAX_UPLOAD_MB` (default 64) are refused before they are read.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | no gating findings (or a successful `inspect`, `drift`, `scenarios`) |
| 1 | input, parse or usage error: a file was rejected, the manifest is invalid, an option is wrong |
| 2 | gating findings present: at least one finding with disposition `REVIEW` or `UNDECLARED` at or above the `--fail-on` severity |

`INFORMATIONAL` and `POSITIVE` findings never gate. `--fail-on none` disables the gate.

## Output formats

| Format | Content |
|---|---|
| `text` | summary, findings table, safety-function statuses, undeclared logic, gate verdict |
| `json` | the full `AnalysisResult` (`interlock.analysis/v1`) |
| `md` | the Markdown report |
| `csv` | one row per finding, formula-injection safe |
| `pdf` | the PDF report; refused on a terminal, use `--out` or redirect |
| `sarif` | SARIF 2.1.0 for GitHub code scanning and other SARIF consumers |

With any format other than `text`, or with `--out`, the gate verdict goes to stderr so stdout stays machine-readable.

SARIF: one reporting descriptor per INTERLOCK rule, one result per finding. `CRITICAL` and `HIGH` map to level `error`, `MEDIUM` to `warning`, `LOW` and `INFO` to `note`, and `security-severity` is set (9.5, 8.0, 5.5, 3.0, 0.0) so code scanning ranks results the way INTERLOCK does. The location is the current project file (repository-relative when it is under the working directory) at the evidence line, plus a logical location `Program/Routine/rung N`.

## Terminal safety

Every string that came from a project file passes through `term()` (`apps/cli/src/terminal.ts`) before it is printed: invisible and bidirectional characters are removed and every C0/C1 control character, including ESC and CR, becomes a space, so a tag description cannot move the cursor, recolour or hide lines. Multi-line documents keep LF and TAB only; JSON output escapes C1, bidi and invisible characters as `\uXXXX`.

## Examples

```bash
node apps/cli/src/main.ts inspect fixtures/l5x/baseline-safe.L5X
```

```
File       baseline-safe.L5X  50 KB  sha256 765c17c6139cff3b…
Format     Rockwell Logix Designer export (L5X)  parser rockwell-l5x 1.0.0
Controller NORTHGATE_PS  1756-L83E  firmware 35.11
Exported   software 35.00  Mon Mar 09 08:41:17 2026
Target     Controller
Contents   2 tasks, 7 programs, 20 routines, 43 rungs, 1 modules (5 call sites), 64 tags
Readiness  READY
```

A hostile file is refused with exit code 1:

```
$ node apps/cli/src/main.ts inspect fixtures/adversarial/xxe-external-entity.L5X
File       xxe-external-entity.L5X  1 KB  sha256 fe41bd7120851264…
Result     REJECTED XML_DOCTYPE_FORBIDDEN  ((document), line 2, column 1)
           The document contains a <!DOCTYPE> declaration. L5X exports never need a DTD, and INTERLOCK rejects every DTD so that external entities (XXE) and entity expansion cannot occur (line 2, column 1)
```

Analyzing a weakened shutdown (scenario 02) exits with code 2:

```
$ node apps/cli/src/main.ts analyze fixtures/l5x/baseline-safe.L5X fixtures/l5x/current-shutdown-weakened.L5X \
    --manifest fixtures/manifests/northgate.safety.json
INTERLOCK 0.1.0 · engine 1.0.0 · analysis ec75374e87d0
Baseline   baseline-safe.L5X  NORTHGATE_PS  50 KB  sha256 765c17c6139c…
Current    current-shutdown-weakened.L5X  NORTHGATE_PS  50 KB  sha256 47612fa4aca7…
Trust      VERIFIED_SCOPE  All declared safety functions were successfully analyzed. No undeclared logic changed.
Priority   CRITICAL   coverage 100%
Changes    2  (logic 1, metadata 1)

Findings (2)
  IL-0001  CRITICAL REVIEW        NEW_INHIBIT                    SF-06       Shutdown condition weakened by new inhibit
  IL-0002  CRITICAL REVIEW        ALARM_SUPPRESSED               SF-06       Alarm path suppressed by new inhibit

Safety functions (8)
  SF-01    NO_CHANGE          Emergency Shutdown
  …
  SF-06    IMPACTED           Compressor C-201 High-Pressure Shutdown
  …

Gate: FAIL — 2 findings needing review at or above HIGH (exit 2)
```

Scenario 01 (normal maintenance) ends with `Gate: pass — no finding needing review at or above HIGH` and exit code 0.

Drift across the three scenario 07 sites:

```bash
node apps/cli/src/main.ts drift "Site A=fixtures/l5x/site-a.L5X" "Site B=fixtures/l5x/site-b-drift.L5X" \
  "Site C=fixtures/l5x/site-c-legacy.L5X" --manifest fixtures/manifests/northgate.safety.json
```

## In CI

A GitHub Actions job that gates a pull request on the exported project and publishes the findings to code scanning:

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 24
- run: npm ci
- name: INTERLOCK impact review
  timeout-minutes: 10
  run: |
    node apps/cli/src/main.ts analyze plc/approved.L5X plc/proposed.L5X \
      --manifest plc/plant.safety.json --format sarif --out interlock.sarif --fail-on high
- if: always()
  uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: interlock.sarif
```

Set a job timeout: the CLI has no built-in time limit (see [threat-model.md](threat-model.md#malformed-xml-and-parser-vulnerabilities)). Pin `plc/approved.L5X` to the export recorded in your change-management system and check its SHA-256; INTERLOCK compares against whatever baseline it is given.

The repository's own CI (`.github/workflows/ci.yml`) runs every built-in scenario, checks that scenario 02 exits with 2 and that the XXE fixture exits with 1.
