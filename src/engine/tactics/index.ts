import type { Tactic } from './api'
import { chargeTactic } from './builtin/charge'
import { counterTactic } from './builtin/counter'

export const BUILTIN_TACTICS: readonly Tactic[] = [chargeTactic, counterTactic]

export function getTactic(id: string): Tactic {
  return BUILTIN_TACTICS.find((t) => t.id === id) ?? chargeTactic
}

export type { Tactic } from './api'
