import { Link } from 'react-router'
import { DocList, DocPage } from '../site/DocPage.tsx'

export function PrivacyPage() {
  return (
    <DocPage
      docTitle="Privacy"
      eyebrow="Privacy"
      title="Your project files stay in this browser"
      lede={
        <p>
          PLC projects describe how a plant works. INTERLOCK is built so that analyzing one does not mean sending it anywhere.
        </p>
      }
      sections={[
        {
          id: 'local',
          title: 'Local analysis',
          body: (
            <>
              <p>
                When you choose a file, the browser reads it into memory and hands it to the analysis engine running in a Web Worker in the same page.
                The file is not uploaded. The page’s Content Security Policy only allows connections to its own origin, and the analysis makes none.
              </p>
            </>
          ),
        },
        {
          id: 'stored',
          title: 'What is stored, and where',
          body: (
            <>
              <DocList
                items={[
                  ['Project files', 'Not stored. They are held in memory for the current session and discarded when you close or reload the page.'],
                  ['Project versions', 'Name, size, SHA-256, controller and object counts of each file you inspect, so you can find it again. Never the file contents.'],
                  ['Analysis results', 'Saved in this browser’s IndexedDB so you can reopen them. They include rung text and tag names from your files.'],
                  ['Preferences', 'Theme and sidebar state, in localStorage.'],
                ]}
              />
              <p className="mt-4">
                You can delete saved results at any time in{' '}
                <Link to="/app/settings" className="font-semibold text-ink underline underline-offset-4">
                  Settings
                </Link>
                . Clearing your browser’s site data removes them as well.
              </p>
            </>
          ),
        },
        {
          id: 'tracking',
          title: 'No analytics, no accounts',
          body: (
            <p>
              There are no accounts, cookies, analytics, advertising or third-party scripts. Fonts are served from the same origin as the page.
            </p>
          ),
        },
      ]}
    />
  )
}
