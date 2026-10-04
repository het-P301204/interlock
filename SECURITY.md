# Security policy

## Reporting a vulnerability

Report vulnerabilities privately through GitHub's private vulnerability reporting:

**https://github.com/het-P301204/interlock/security/advisories/new**

Do not open a public issue for a vulnerability. Please include:

- the affected component (engine, web app, API, CLI, container) and version or commit;
- a minimal reproduction: a synthetic project file, manifest or request that triggers it (never a real plant export);
- what you expected and what happened;
- your assessment of the impact.

The maintainer aims to acknowledge reports within seven days. Fixes are released as soon as they are ready, and the advisory credits the reporter unless you prefer otherwise.

## Scope

In scope:

- Parsing of untrusted project files and manifests: code execution, file or network access, XXE, entity expansion, prototype pollution, crashes or hangs (including algorithmic complexity), memory exhaustion.
- **Wrong safety conclusions**: a change that weakens a declared safety function, suppresses a declared alarm, or bypasses a declared protective output, and that INTERLOCK reports as unchanged, equivalent, informational or in `VERIFIED_SCOPE`. These are treated as security issues.
- Output injection: CSV formulas, Markdown or HTML structure, terminal escape sequences, bidirectional text in any report or UI.
- The API server: authentication bypass, Host or Origin check bypass, path traversal in static serving, information disclosure, denial of service beyond the documented limits.
- Data leakage from the web app's local mode (any request that carries project content off the machine).
- The container image and the CI supply chain.

Out of scope:

- Findings that follow from documented limitations (see the README and [docs/threat-model.md](docs/threat-model.md)), unless the documentation is wrong.
- Deployments that ignore the documented requirements (exposing the API without a token or TLS, multi-tenant use).
- Vulnerabilities in a controller, an engineering tool or a plant. INTERLOCK does not interact with any of them.

Known issues are listed in [docs/threat-model.md](docs/threat-model.md) with their residual risk.

## Supported versions

| Version | Supported |
|---|---|
| 0.1.x | yes |

Only the latest release receives fixes.

## The defensive-only boundary

INTERLOCK is a defensive review tool. It analyzes exported project files and nothing else: it never connects to a PLC, never writes or downloads logic, never modifies a plant system, never executes content from a file, and never scans a network. Contributions that add any of these capabilities will not be accepted, and research reported under this policy must stay within the same boundary: use synthetic projects, and do not test against controllers or plants you do not own.
