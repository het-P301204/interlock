import type { RuleInfo } from '../../model/analysis.ts'
import {
  CosmeticChangeRule, DeclarationResolutionRule, ExternalWriteAccessRule, ModuleRevisionRule, NonSafetyChangeRule,
  SharedModulePropagationRule, UndeclaredSafetyCoverageRule,
} from './changes.ts'
import { AlarmSuppressionRule } from './notification.ts'
import { AlarmConfigurationRule, OverriddenWriterRule } from './configuration.ts'
import {
  ExecutionControlRule, InterlockWeakeningRule, NewInhibitTermRule, PermissiveWeakeningRule, ProtectionStrengthenedRule,
  ProtectiveOutputBypassRule, RemovedProtectivePathRule, SetpointRelaxationRule, ShutdownWeakeningRule, TripDelayRule,
} from './protective.ts'
import type { Effect, Rule, RuleContext } from './types.ts'

/** Every rule INTERLOCK applies, in id order. */
export const RULES: Rule[] = [
  RemovedProtectivePathRule,
  NewInhibitTermRule,
  ProtectiveOutputBypassRule,
  ShutdownWeakeningRule,
  InterlockWeakeningRule,
  PermissiveWeakeningRule,
  SetpointRelaxationRule,
  AlarmSuppressionRule,
  TripDelayRule,
  ExecutionControlRule,
  SharedModulePropagationRule,
  UndeclaredSafetyCoverageRule,
  ProtectionStrengthenedRule,
  CosmeticChangeRule,
  NonSafetyChangeRule,
  DeclarationResolutionRule,
  ModuleRevisionRule,
  ExternalWriteAccessRule,
  AlarmConfigurationRule,
  OverriddenWriterRule,
]

export const RULE_INFO: RuleInfo[] = RULES.map(({ id, title, description, severity }) => ({ id, title, description, severity }))

export function runRules(ctx: RuleContext): Effect[] {
  return RULES.flatMap((r) => r.evaluate(ctx))
}

export type { Effect, Rule, RuleContext } from './types.ts'
