import { ADVISORY_URL } from '../shell/nav.ts'
import { DocList, DocPage } from '../site/DocPage.tsx'

export function SecurityPage() {
  return (
    <DocPage
      docTitle="Security"
      eyebrow="Security"
      title="Security model"
      lede={
        <p>
          INTERLOCK reads untrusted engineering files. Its design assumes a project file may be malformed or hostile, and keeps the analysis away
          from anything it could harm.
        </p>
      }
      sections={[
        {
          id: 'boundary',
          title: 'What INTERLOCK will not do',
          body: (
            <DocList
              items={[
                ['Controllers', 'No connection to any PLC, gateway or engineering workstation. No upload, download or online edit.'],
                ['Execution', 'Nothing in a project file is executed. Rung text is parsed as data and evaluated symbolically.'],
                ['Network', 'No scanning, no discovery, no outbound requests carrying project content.'],
                ['Plant systems', 'No writes anywhere. Output is a report for a human reviewer.'],
              ]}
            />
          ),
        },
        {
          id: 'parsing',
          title: 'Parsing untrusted XML',
          body: (
            <>
              <p>
                Project files are parsed by INTERLOCK’s own hardened XML reader rather than a general-purpose one. Document type declarations and
                external entities are rejected outright, and input size, nesting depth, element count and attribute sizes are bounded.
              </p>
              <p>
                When a file cannot be trusted the analysis stops and says where: a parse failure names the location and the reason, and no partial
                semantic model is used for conclusions.
              </p>
            </>
          ),
        },
        {
          id: 'browser',
          title: 'In the browser',
          body: (
            <>
              <p>
                The engine runs in a Web Worker inside this page. The page ships with a strict Content Security Policy: scripts, styles, fonts and
                connections are limited to this origin, plugins are disabled and forms cannot submit anywhere. Fonts are self-hosted, and there are
                no analytics or third-party scripts.
              </p>
              <p>Text from project files (tag names, comments, descriptions) is rendered as text, never as HTML.</p>
            </>
          ),
        },
        {
          id: 'determinism',
          title: 'Determinism',
          body: (
            <p>
              The engine reads no clock, uses no randomness and makes no network calls. The same files and declarations produce the same findings,
              the same ranking and the same analysis id, so a result can be reproduced and checked independently.
            </p>
          ),
        },
        {
          id: 'report',
          title: 'Reporting a vulnerability',
          body: (
            <>
              <p>
                Report security issues privately through a GitHub security advisory:{' '}
                <a href={ADVISORY_URL} target="_blank" rel="noreferrer noopener" className="font-semibold text-ink underline underline-offset-4">
                  open a private advisory<span className="sr-only"> (opens in a new tab)</span>
                </a>
                . Please include the INTERLOCK version, a minimal file that reproduces the issue (synthetic, never a real plant project), and what you
                observed.
              </p>
              <p>
                Machine-readable contact details are published at <code className="font-mono text-[0.9em] text-ink">/.well-known/security.txt</code>.
              </p>
            </>
          ),
        },
      ]}
    />
  )
}
