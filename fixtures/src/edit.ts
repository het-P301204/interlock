/**
 * Small, strict editing helpers for scenario mutations. Every edit states what
 * it expects to find and throws when the model does not match, so a scenario
 * can never silently apply to the wrong rung after the plant changes.
 */
import type { AoiDefinition, ControllerModel, Program, Routine, Rung, TagDef } from './types.ts'

export function clone(model: ControllerModel): ControllerModel {
  return structuredClone(model)
}

export function stamp(model: ControllerModel, lastModified: string, exported: string): void {
  model.lastModifiedDate = lastModified
  model.exportDate = exported
}

export function program(model: ControllerModel, name: string): Program {
  const p = model.programs.find((x) => x.name === name)
  if (p === undefined) throw new Error(`No program ${name}`)
  return p
}

export function aoi(model: ControllerModel, name: string): AoiDefinition {
  const a = model.aois.find((x) => x.name === name)
  if (a === undefined) throw new Error(`No AOI ${name}`)
  return a
}

/** Routine by "Program/Routine"; AOI routines are addressed as "AOI_Name/Logic". */
export function routine(model: ControllerModel, container: string, name: string): Routine {
  const owner = model.programs.find((p) => p.name === container) ?? model.aois.find((a) => a.name === container)
  if (owner === undefined) throw new Error(`No program or AOI ${container}`)
  const r = owner.routines.find((x) => x.name === name)
  if (r === undefined) throw new Error(`No routine ${container}/${name}`)
  return r
}

function rungAt(r: Routine, index: number): Rung {
  const g = r.rungs[index]
  if (g === undefined) throw new Error(`Routine ${r.name} has no rung ${index}`)
  return g
}

export function setRungText(model: ControllerModel, container: string, routineName: string, index: number, from: string, to: string): void {
  const g = rungAt(routine(model, container, routineName), index)
  if (g.text !== from) throw new Error(`${container}/${routineName} rung ${index}: expected "${from}", found "${g.text}"`)
  g.text = to
}

export function setRungComment(model: ControllerModel, container: string, routineName: string, index: number, comment: string): void {
  const g = rungAt(routine(model, container, routineName), index)
  if (g.comment === comment) throw new Error(`${container}/${routineName} rung ${index}: comment unchanged`)
  g.comment = comment
}

export function deleteRung(model: ControllerModel, container: string, routineName: string, index: number, expectedText: string): void {
  const r = routine(model, container, routineName)
  const g = rungAt(r, index)
  if (g.text !== expectedText) throw new Error(`${container}/${routineName} rung ${index}: expected "${expectedText}", found "${g.text}"`)
  r.rungs.splice(index, 1)
}

export function tag(model: ControllerModel, name: string): TagDef {
  const t = model.tags.find((x) => x.name === name)
  if (t === undefined) throw new Error(`No controller tag ${name}`)
  return t
}

export function setTagDescription(model: ControllerModel, name: string, description: string): void {
  const t = tag(model, name)
  if (t.description === description) throw new Error(`Tag ${name}: description unchanged`)
  t.description = description
}

export function addTag(model: ControllerModel, t: TagDef): void {
  if (model.tags.some((x) => x.name === t.name)) throw new Error(`Tag ${t.name} already exists`)
  model.tags.push(t)
}

export function setTimerPreset(model: ControllerModel, name: string, from: number, to: number): void {
  const t = tag(model, name)
  if (t.value?.kind !== 'TIMER' || t.value.pre !== from) throw new Error(`Tag ${name}: expected TIMER with PRE ${from}`)
  t.value.pre = to
}

/** Every rung of every program and AOI routine, keyed "Container/Routine". */
export function rungMap(model: ControllerModel): Map<string, Rung[]> {
  const out = new Map<string, Rung[]>()
  for (const a of model.aois) for (const r of a.routines) out.set(`${a.name}/${r.name}`, r.rungs)
  for (const p of model.programs) for (const r of p.routines) out.set(`${p.name}/${r.name}`, r.rungs)
  return out
}
