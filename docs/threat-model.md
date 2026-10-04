# Threat model

INTERLOCK reads PLC project exports and engineer-written safety declarations, and tells a reviewer which changes affect declared safety functions. Its inputs are untrusted files; its outputs are trusted by people signing off on safety changes. Both directions matter: a hostile file must not compromise the host, and a wrong or manipulated result must not pass as evidence.

This document lists the assets, the trust boundaries, and for each threat the mitigation as implemented today and the risk that remains. File references are to the repository. Version: 0.1.0 (2026-10-04).

## Boundary of the product

INTERLOCK is defensive project-file analysis only. It never connects to a controller, never writes or downloads logic, never executes anything contained in a file, and never scans a network. It has no code path that does any of these, and the engine (`packages/core/src`) is linted so it cannot import networking or filesystem modules (see [architecture.md](architecture.md#determinism)).

## Assets

| Asset | Why it matters |
|---|---|
| Project files | Proprietary control logic. They describe how a plant's protection works, which is useful to an attacker. |
| Safety declarations | Name every protective output, alarm and trip of a site. |
| Analysis results and reports | A list of the ways a site's safety functions can be weakened, with exact tag names and conditions. Treat a report as at least as sensitive as the project. |
| Integrity of conclusions | Engineers act on findings. A false "no change", a hidden finding or a forged report line is a safety problem, not only a security one. |
| The host | The browser tab, the API server process and its database, the CI runner executing the CLI. |
| `INTERLOCK_API_TOKEN` | The only credential INTERLOCK knows about (server mode). |

## Trust boundaries

```
 untrusted                         │ INTERLOCK                                    │ consumers
                                   │                                              │
 project file bytes  ─────────────►│ decode ─► XML parser ─► L5X adapter ─►       │
 safety manifest JSON ────────────►│ manifest validator ─────────────────► engine ├─► web UI (DOM)
 HTTP client (server mode) ───────►│ API: host check, token, limits ─► worker ───►├─► JSON / CSV / Markdown / PDF
 baseline provenance (people) ────►│ (trusted as given)                           ├─► CLI text, SARIF, exit code
```

1. **File bytes to model.** Everything in an uploaded file is attacker-controlled: structure, names, descriptions, rung text, sizes.
2. **Manifest to model.** Declarations are untrusted input like project files, and also the thing every conclusion is relative to.
3. **Client to API** (server mode only). Any process that can reach the port.
4. **API to engine worker.** The engine runs in a worker thread with a time and memory budget, so a pathological file costs one worker, not the server.
5. **Engine to renderers and consumers.** Strings derived from the file reach browsers, spreadsheets, Markdown renderers, terminals and code-scanning UIs.
6. **People to the baseline.** INTERLOCK compares against the baseline it is given. It cannot know whether that file is the approved one.

## Execution modes

| Mode | Where the engine runs | Where project bytes go |
|---|---|---|
| Web workstation, LOCAL (default and the static GitHub Pages build) | a Web Worker in the user's browser | nowhere: they stay in the tab; results are kept in the browser's IndexedDB |
| API server | a Node worker thread on the server | uploaded over HTTP, stored as BLOBs in the server's SQLite database |
| CLI | the local Node process | read from local paths; output to stdout |

The web UI shows "Analysis mode LOCAL. Project files remain in this browser." only in local mode.

## Threats

### Malicious project file

A crafted L5X tries to execute code, read files, reach the network, or crash the host.

Mitigations as implemented:

- Nothing in a file is ever executed. Rung text is parsed into a data structure and interpreted symbolically; there is no `eval` or `new Function` in the engine (`no-eval` and `no-new-func` lint rules).
- The engine cannot open files or sockets: adapters receive decoded text, never a path (`adapters/types.ts`), and `node:*`, `fs`, `http`, `net` and friends are forbidden imports in `packages/core/src` (`eslint.config.js`).
- Extension allow-list before content is examined: `.l5x`, `.xml`, `.xef` (`adapters/registry.ts`). Format detection is a hint, not trust: a file sniffed as L5X still has to have the `<RSLogix5000Content>` root (`fixtures/adversarial/wrong-root.xml` → `L5X_WRONG_ROOT`).
- An error-severity diagnostic stops the analysis ("INTERLOCK did not continue analysis because the semantic model could not be trusted"); a partial model is never analyzed.

Residual risk: bugs in the engine itself. The XML parser and adapter are property-tested to throw nothing but `ProjectParseError` on arbitrary strings, token soups and random mutations of a real export (`packages/core/test/xml/property.test.ts`).

### Malformed XML and parser vulnerabilities

| Attack | Mitigation (`packages/core/src/xml/parser.ts` unless noted) | Fixture |
|---|---|---|
| XXE (external entities) | Any `<!DOCTYPE`, in any letter case, anywhere, is rejected (`XML_DOCTYPE_FORBIDDEN`). Without a DTD there are no entity declarations, so external entities are impossible by construction. | `xxe-external-entity.L5X`, `xxe-parameter-entity.L5X` |
| Billion laughs / entity expansion | Same: no DTD, no entity declarations. Only the five predefined entities and numeric character references are decoded; any other `&name;` is `XML_UNKNOWN_ENTITY`. | `billion-laughs.L5X`, `unknown-entity.L5X` |
| Deep nesting / stack exhaustion | The parser and the path assignment are iterative (no recursion). `maxDepth` 64 → `XML_TOO_DEEP`. | `deep-nesting.L5X` (5,000 levels) |
| Huge inputs | `maxChars` 64 Mi characters, `maxElements` 2,000,000, `maxAttributesPerElement` 64, `maxAttributeValueLength` 1 MiB, `maxTextLength` 16 MiB per element, each with its own error code (`adapters/types.ts` `DEFAULT_XML_LIMITS`). An internal `RangeError` becomes `XML_RESOURCE_LIMIT`. | `property.test.ts` "under tight limits" |
| Prototype pollution | Attribute maps are created with `Object.create(null)`; lookups use `hasOwnProperty`. An attribute named `__proto__` or `constructor` is inert data. | `prototype-attributes.L5X` |
| Duplicate attributes (parser differential) | Rejected (`XML_DUPLICATE_ATTRIBUTE`), so two parsers cannot disagree about, for example, a tag's `ExternalAccess`. | `duplicate-attribute.L5X` |
| Invalid encodings | UTF-8 decoded with a fatal decoder: invalid bytes are `ENCODING_INVALID` with the byte offset, never U+FFFD (`util/decode.ts`). NUL characters are `XML_NUL_CHARACTER`. | `invalid-utf8.L5X` |
| Truncation and mismatched tags | `XML_UNCLOSED_TAG`, `XML_MISMATCHED_TAG`, `XML_UNTERMINATED_CDATA` and others, each with line, column and the open element's location. | `truncated.L5X`, `mismatched-tags.L5X`, `unterminated-cdata.L5X` |
| Hostile names in messages | File-supplied values are cleaned and truncated to 80 characters before they appear in a message or location (`displayValue`). | `parser.test.ts` |
| ReDoS in the parser | The XML scanner applies no regular expression to unbounded hostile input; every scan moves forward. | |

Every fixture in `fixtures/adversarial/` has an asserted result in `packages/core/test/l5x/adversarial.test.ts`.

Residual risk: none known for tokenizing. Two patterns applied after parsing were quadratic on pathological input in the first build (a 40,000-digit operand made one analysis take about 25 s); both were replaced with linear-time scanning, numeric literals longer than 64 characters are rejected, and `packages/core/test/logic/linear-time.test.ts` keeps it that way.

### Resource exhaustion

Mitigations as implemented:

- Parser limits above, applied before any analysis.
- Structural diff: the rung alignment is bounded; a routine pair whose unmatched middle would exceed 4,000,000 LCS cells is aligned positionally instead (`analysis/diff.ts`).
- Firing-condition comparison: at most 2^20 assignments per comparison; beyond that the result is `NOT_DECIDED`, never an unbounded enumeration (`logic/truth.ts`). Minimal-form rendering is limited to 12 atoms.
- Rung parsing: branch nesting deeper than 64 levels is a parse error, so no recursive walker can overflow the stack on a hostile rung.
- Symbolic scan: recursion into a routine already on the call stack is refused; AOI nesting beyond eight levels and alias chains beyond depth 8 are not followed.
- The manifest is at most 2 MiB of text and 500 functions (`analysis/manifest.ts`).
- API server: uploads are capped (`INTERLOCK_MAX_UPLOAD_MB`, default 64) and JSON bodies at 4 MiB, both enforced while the body streams in (with or without `Content-Length`); every engine job (parsing an upload, an analysis, a drift comparison) runs in its own fresh worker thread that receives no environment variables (`apps/api/src/engine.ts`), the engine runs in a worker thread with a timeout (`INTERLOCK_ANALYSIS_TIMEOUT_MS`, default 60,000) and a memory cap (`INTERLOCK_WORKER_MAX_MEMORY_MB`, default 512), concurrent analyses are limited (`INTERLOCK_MAX_CONCURRENT_ANALYSES`, default 2), and uploads, analyses and drift requests are rate-limited per client address (`INTERLOCK_RATE_LIMIT_PER_MINUTE`, default 60).
- Web: the engine runs in a Web Worker, so the page stays responsive; Cancel terminates the worker.

Residual risk: a single comparison near the 2^20 bound takes noticeable time, and the CLI has no built-in timeout (run it under a CI job timeout).

### Data leakage

Mitigations as implemented:

- **Local mode sends nothing.** The engine runs in a Web Worker; project bytes reach it by `postMessage` and never leave the page. The production `index.html` carries a Content-Security-Policy with `connect-src 'self'`, `font-src 'self'`, `script-src 'self'`, `object-src 'none'`, `base-uri 'none'` and `form-action 'none'`, and `<meta name="referrer" content="no-referrer">`.
- **No third-party requests.** Fonts (Manrope, IBM Plex Mono) are bundled from `@fontsource` packages and served from the same origin; Vite's `assetsInlineLimit: 0` keeps them as files. There is no analytics, telemetry or CDN dependency at runtime.
- **The engine has no network code** (lint-enforced).
- **Server mode stores what you upload.** Files are stored as BLOBs next to their SHA-256 in SQLite under `INTERLOCK_DATA_DIR` (default `.data/`). Nothing a client sends is used to build a filesystem path (`apps/api/src/store.ts`). The token is never logged.

Residual risk:

- In local mode, analysis results and history persist in the browser's IndexedDB on that machine until cleared from Settings or by clearing site data. A shared workstation shares them.
- In server mode the database is not encrypted at rest by INTERLOCK; protect the volume. There is no per-user separation (see [unsafe deployment assumptions](#unsafe-deployment-assumptions)).
- Reports are as sensitive as the project. Handle exported JSON, CSV, Markdown and PDF files accordingly.

### False positives

A finding that is not a real safety regression costs reviewer time and erodes trust in the tool.

Mitigations as implemented: a rewritten rung is only "different" when its interpretation differs (reordered contacts are proved equivalent and reported as LOW informational, `COSMETIC_LOGIC_CHANGE`); a weakening is only reported after an exhaustive comparison; a new inhibit is only called an inhibit after the cofactor proof; numeric comparisons on one tag are reasoned about together, so a setpoint change is not reported as two unrelated atoms; every finding carries the before/after condition, a witness assignment and the evidence ledger so the reviewer can check it.

Residual risk: the scan is a steady-state, single-scan model. A change that is harmless because of timing, task interleaving or plant physics (for example a contact that can never be true in practice) is still reported if it weakens the logical condition. Previous-scan atoms can produce `MIXED` verdicts that describe situations that do not occur in steady operation (scenario 09, SF-04).

### False negatives

The worse failure: a real weakening that INTERLOCK does not report.

Mitigations as implemented:

- A comparison is exhaustive or it is `NOT_DECIDED`; it is never sampled.
- Unknown instructions, unparsable rungs and structured-text assignments become opaque writes to every tag they mention, so a writer of a protective output is never invisible because INTERLOCK did not understand it.
- A new writer of a protective output, inside or outside the declared implementation, is reported as a bypass.
- A writer that no longer executes (deleted rung, removed JSR, disabled program, inhibited task) is reported as a removed path.
- Logic outside every declared function is UNDECLARED, never safe; the trust status says so.
- Executing logic INTERLOCK cannot read (source-protected routines and AOIs, FBD, SFC) forces `PARTIAL_COVERAGE`.
- A function whose comparison is undecided, or whose cone contains an unsupported construct, is `NOT_ANALYZED`; an opaque condition in any function's comparison forces `PARTIAL_COVERAGE`. Nothing undecided becomes `VERIFIED_SCOPE`.
- The scan runs two passes, so a later rung that changes a value read earlier (for example unlatching a trip input) is seen.
- A declared output shadowed by a new program-scoped tag of the same name is analyzed at the location the baseline protected, and trust becomes `PARTIAL_COVERAGE`.
- Alarm configuration stored in the export (condition, minimum duration, disable, suppress, shelve) is compared, so an alarm weakened without a rung change is reported (IL-R019).

These mitigations were added after an adversarial review of the engine built hostile variants of the fixture plant; the cases it found are kept as tests in `tests/adversarial-engine/`.

Residual risk:

- FBD and SFC routines are not analyzed; their writes are not visible to the scan. Trust becomes `PARTIAL_COVERAGE`, but the specific output they write is not named.
- `SSV` effects are not modeled. An `SSV` that can disable a program, task or routine is reported as an unsupported construct against its target, and the functions that depend on the target become `NOT_ANALYZED`; other `SSV` uses (for example changing a task rate) are not reported.
- Backward `JMP`, `JSR` return parameters and indirect addressing (array indices computed at run time) are not modeled; backward jumps are reported as unsupported constructs.
- Task preemption is approximated: periodic tasks run after the continuous task, event tasks under an opaque trigger.
- Operator actions are not in the project file: HMI alarm shelving, forces, and online edits made after the export. (Logic that writes an alarm's disable, suppress or shelve members, and the alarm configuration stored in the export, are analyzed.)
- Timing: IL-R009 reports a larger timer preset in a declared cone (in the rung or the timer tag data), logic that writes a timer preset, and protective logic moved to a slower periodic or an event task. Other timing effects (watchdog, task priority, a slower rate of a task that only feeds the logic) are reported as execution changes but not analyzed.

These limits are listed in the README and in [architecture.md](architecture.md#modelling-assumptions).

### Incomplete declarations

Everything INTERLOCK concludes about safety is relative to the manifest. A function the engineer did not declare is not analyzed as a safety function.

Mitigations as implemented: logic outside every declared cone and outside the declared non-safety scope is `UNDECLARED_LOGIC_CHANGED` with the disposition UNDECLARED: "No safety intent has been declared for this logic. INTERLOCK therefore cannot conclude that it is safe." A name-based hint flags undeclared logic whose tag names look protective (labelled as a hint, not a conclusion). A declaration that does not resolve in the current project is `DECLARATION_UNRESOLVED`, never "no change". Operational instances of a changed shared module are listed as undeclared.

Residual risk: a manifest that declares a protective program non-safety hides changes there as informational. A wrong trip state inverts the meaning of every finding for that function. Declarations are as good as the engineer who writes them; review the manifest as part of the change.

### Unsupported constructs

Mitigations as implemented: every construct the scan does not model is recorded in `coverage.unsupported` with its kind, location, side, whether it is in a safety cone and whether it changed. Any unsupported construct inside a declared cone lowers that function's findings to MEDIUM confidence and sets trust to `PARTIAL_COVERAGE`. A rung or instruction that cannot be interpreted is never ignored (opaque writes, see above).

Residual risk: see [false negatives](#false-negatives).

### Tampered baseline

INTERLOCK trusts the baseline file you give it. If an attacker can replace the "known-good" export with one that already contains the weakening, the comparison against the current export shows nothing.

Mitigations as implemented: the SHA-256 of both files is computed by the engine, shown at ingest, recorded in every analysis result, in every evidence item (`fileSha256`) and in every report's project metadata. The analysis id is derived from both hashes and the manifest, so a different baseline produces a different analysis id.

Recommendation: keep the approved baseline's SHA-256 in your change-management record (MOC ticket, version control, signed release notes) and compare it with the hash INTERLOCK displays before trusting a result. Store baselines where the people whose changes are being reviewed cannot rewrite them.

Residual risk: INTERLOCK cannot verify provenance on its own.

### Output injection

Strings from the file reach spreadsheets, Markdown renderers, terminals, the browser DOM and code-scanning UIs.

| Sink | Mitigation as implemented |
|---|---|
| Bidi and invisible characters (Trojan Source) | Every string the L5X adapter reads passes through `stripInvisible` (`util/sanitize.ts`): bidi embeddings, overrides and isolates, zero-width characters, Unicode tag characters, C0/C1 controls except TAB, LF and CR, and lone surrogates are removed, with a `TEXT_INVISIBLE_CHARACTERS` warning naming the element. Manifest strings and every report string are cleaned again. The character set is defined as numeric code point ranges, and a test checks the source file itself contains no literal invisible characters. |
| Terminal escape sequences | ESC (U+001B) and the other C0/C1 controls are removed by the same function. The CLI additionally passes every file-derived string through `term()` (`apps/cli/src/terminal.ts`), which turns every remaining control character, including CR and LF, into a space; multi-line Markdown and CSV printed to a terminal keep LF and TAB only; JSON output escapes C1, bidi and invisible characters as `\uXXXX`. |
| CSV formula injection | A cell that starts with `=`, `+`, `-`, `@`, TAB or CR is prefixed with `'`; cells with quotes, commas or line breaks are quoted (`report/export.ts` `csvCell`). |
| Markdown | Inline text escapes `` \ ` * _ { } [ ] ( ) < > # + ! \| & ~ ``; table cells also collapse whitespace so a value cannot add cells or rows; code blocks use a fence longer than any backtick run in the content (`report/export.ts`). |
| HTML (web UI) | React renders file-derived strings as text. The CSP forbids inline and third-party scripts. |
| PDF | The PDF writer emits only text operators with the standard fonts; characters outside WinAnsi are transliterated or replaced with `?`. |

A lone carriage return deserves a note: the XML parser decodes `&#13;` to CR in attribute values and non-CDATA text, and CommonMark treats a lone CR as a line ending, so a CR followed by `===` inside a paragraph could turn the previous line into a heading. Inline Markdown text replaces every CR, LF and CRLF with a space, and code blocks normalize line endings to LF (`report/export.ts`). `tests/adversarial-engine/robustness.test.ts` pins this.

Residual risk: a renderer that interprets raw HTML or extensions beyond CommonMark may still display escaped text unexpectedly; the JSON and PDF outputs carry no markup.

### Unsafe deployment assumptions

The API server is a single-tenant tool. Mitigations and defaults as implemented in `apps/api/src/config.ts`:

- Binds to `127.0.0.1` by default (`HOST`). Exposing it requires an explicit choice.
- Optional bearer-token authentication (`INTERLOCK_API_TOKEN`) on every `/api` route except `/api/health`, compared in constant time. The server refuses to start with a token shorter than 16 characters, and there is no default token.
- DNS-rebinding protection: when bound to loopback, only `127.0.0.1`, `localhost` and `[::1]` are accepted as `Host` headers unless `INTERLOCK_ALLOWED_HOSTS` says otherwise.
- CORS is off by default. A state-changing request (anything but GET and HEAD) from another origin that is not listed in `INTERLOCK_ALLOWED_ORIGINS` is refused with `403 ORIGIN_REJECTED`, so a page on another site cannot use a simple form POST to upload files; unlisted origins get no CORS headers, so browsers do not let them read responses.
- Security headers on every response: a CSP without inline scripts or third-party origins, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, COOP and CORP `same-origin`, a restrictive `Permissions-Policy`, and HSTS in production. API responses are `Cache-Control: no-store`.
- Logs are JSON lines with the route pattern (not the raw path or query string), status and duration; never bodies, file contents or tokens. Errors never return stack traces.
- In production the server also serves the web build; every request path is decoded and checked to stay inside the build directory, symlinks included, before anything is read.
- Client addresses for rate limiting come from the socket unless `INTERLOCK_TRUST_PROXY_HOPS` says how many proxies to trust; then the address that many entries from the right of `X-Forwarded-For` is used, because entries to its left are forgeable.
- The container image runs as the unprivileged `node` user with npm and other package managers removed; `docker-compose.yml` publishes the port on loopback only and runs the container read-only, with all capabilities dropped, `no-new-privileges`, and memory and process limits. CI scans the image (Trivy), produces an SBOM, runs CodeQL and scans the history for secrets.

Residual risk and operator responsibilities:

- There is no multi-tenant isolation and no user model: anyone with the token sees every project and analysis in the database. Run one instance per team or trust domain.
- The server speaks plain HTTP. Put it behind a TLS-terminating reverse proxy before exposing it beyond loopback, set `INTERLOCK_TRUST_PROXY_HOPS` to match, and set `INTERLOCK_ALLOWED_HOSTS` to the public host name.
- Never expose it without `INTERLOCK_API_TOKEN`. Rotate the token by restarting with a new value.
- The static GitHub Pages build has no server component; everything runs in the visitor's browser.

## Reporting a vulnerability

See [SECURITY.md](../SECURITY.md).
