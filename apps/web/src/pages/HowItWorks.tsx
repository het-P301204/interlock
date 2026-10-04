import { DocList, DocPage } from '../site/DocPage.tsx'
import { LogicDiff } from '../ui/LogicDiff.tsx'
import { StatusPill } from '../ui/Badge.tsx'

const PIPELINE: Array<[string, string]> = [
  ['01 Ingest', 'Reads both files, measures size and SHA-256, and parses the XML with a hardened parser: no DTDs, no external entities, bounded depth and size.'],
  ['02 Normalize', 'Turns the L5X into a vendor-neutral model of tasks, programs, routines, rungs, modules (AOIs), parameters and tags.'],
  ['03 Resolve modules', 'Matches every AOI call site to its definition and maps call operands to parameters in declaration order.'],
  ['04 Build reuse graph', 'Connects tasks, programs, routines, module definitions, instances and tags with typed edges: schedules, calls, defines, instantiates, writes.'],
  ['05 Map safety functions', 'Resolves each declared function to its routine, module instance, protective output and alarm, and computes the logic it depends on.'],
  ['06 Compare logic', 'Diffs the two models structurally, then decides for each changed rung whether it still computes the same thing.'],
  ['07 Trace protective paths', 'Runs a symbolic single scan of both versions and compares each protective output’s firing condition over every consistent input combination.'],
  ['08 Analyze alarms', 'Follows each declared alarm from condition through logic and alarm instruction, and reports where the notification path breaks.'],
  ['09 Rank impact', 'Classifies findings, counts call-site blast radius, and orders them by what they do to protection.'],
  ['10 Generate review set', 'Produces the ranked findings, the review order, coverage and trust status, each finding with its evidence.'],
]

export function HowItWorks() {
  return (
    <DocPage
      docTitle="How it works"
      eyebrow="Documentation"
      title="How INTERLOCK works"
      lede={
        <p>
          INTERLOCK compares two exports of the same PLC project and answers one question: did this change alter a safety function, where does it
          propagate, and could it prevent the system from stopping or notifying an operator?
        </p>
      }
      numbered
      sections={[
        {
          id: 'pipeline',
          title: 'The analysis pipeline',
          body: (
            <>
              <p>
                Every analysis runs the same ten stages in order. The progress view in the workstation only advances when the engine reports that a
                stage has finished, and each stage reports what it actually did, with counts.
              </p>
              <DocList items={PIPELINE} />
            </>
          ),
        },
        {
          id: 'safety-model',
          title: 'The safety-function model',
          body: (
            <>
              <p>
                INTERLOCK never infers that logic is safety-relevant from its shape or its tag names. An engineer declares each safety function in a
                small JSON file: its kind (shutdown, trip, interlock, permissive or alarm), criticality, where it is implemented, its protective
                output and the state that output takes when the function acts, and its alarm.
              </p>
              <p>
                <strong>Trip state matters.</strong> A run-enable output protects by going to 0 (de-energize); a close-valve command protects by going
                to 1 (energize). The firing condition is computed accordingly.
              </p>
            </>
          ),
        },
        {
          id: 'firing',
          title: 'Firing conditions',
          body: (
            <>
              <p>
                The engine executes one controller scan symbolically: tasks by priority, programs in schedule order, routines through their JSR calls,
                AOI calls through their definitions. The result is, for each protective output, a Boolean condition over the inputs that decides
                whether the function acts.
              </p>
              <p>
                Baseline and current conditions are compared over every consistent assignment of their inputs. A function is <strong>weakened</strong>{' '}
                when there is a situation in which it acted before and does not now; INTERLOCK shows that situation as a witness.
              </p>
              <div className="mt-5">
                <LogicDiff
                  language="condition"
                  beforeLabel="FIRES WHEN · BASELINE"
                  afterLabel="FIRES WHEN · CURRENT"
                  before="Pressure_High AND Safety_Enable"
                  after="Pressure_High AND Safety_Enable AND NOT Maintenance_Mode"
                />
              </div>
            </>
          ),
        },
        {
          id: 'notification',
          title: 'Notification paths',
          body: (
            <>
              <p>
                A shutdown that still works but no longer tells anyone is a different failure. For each declared alarm INTERLOCK traces the path
                CONDITION → LOGIC → ALARM → HMI → OPERATOR and reports each stage before and after.
              </p>
              <p>
                The HMI and operator stages are shown as <strong>DECLARED</strong>: a controller project cannot prove what an HMI displays, so
                INTERLOCK states the declared notification and does not claim more.
              </p>
            </>
          ),
        },
        {
          id: 'undeclared',
          title: 'Undeclared logic',
          body: (
            <>
              <p>
                Logic that is neither inside a declared safety function’s dependency cone nor declared non-safety is <strong>undeclared</strong>.
                Changes there are reported for review with the same weight as an unknown: INTERLOCK cannot conclude that they are safe, and says so.
              </p>
              <p className="mt-4 flex flex-wrap items-center gap-3">
                <StatusPill status="UNDECLARED" />
                <span>No safety intent has been declared for this logic. INTERLOCK therefore cannot conclude that it is safe.</span>
              </p>
            </>
          ),
        },
        {
          id: 'coverage',
          title: 'Coverage and trust',
          body: (
            <>
              <p>
                Every result states what was and was not analyzed: declared functions resolved, declared routines covered, module relationships
                resolved, notification paths traced, and any construct the engine could not read (source-protected routines, unsupported
                instructions, unresolved references).
              </p>
              <DocList
                items={[
                  ['VERIFIED SCOPE', 'Everything inside the declared scope was analyzed and decided.'],
                  ['PARTIAL COVERAGE', 'Something inside the declared scope could not be analyzed; conclusions there are incomplete.'],
                  ['REVIEW REQUIRED', 'A change touched undeclared logic or something the engine could not decide; an engineer must look.'],
                ]}
              />
              <p className="mt-4">There is no green “secure” verdict. The strongest statement INTERLOCK makes is about its declared scope.</p>
            </>
          ),
        },
        {
          id: 'boundary',
          title: 'The hard boundary',
          body: (
            <>
              <p>
                INTERLOCK analyzes <strong>exported project files</strong>. It never connects to a controller, never writes or downloads logic, never
                modifies a plant system, never executes anything contained in a file, and never scans a network. Rockwell L5X is supported today;
                PLCopen XML, Siemens TIA Portal XML and Schneider XEF are planned and are shown as planned, not supported.
              </p>
            </>
          ),
        },
      ]}
    />
  )
}
