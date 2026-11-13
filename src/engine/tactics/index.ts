import type { RegisteredTactic } from './api'
import { BUILTIN_TACTIC_DEFS } from './builtin'
import { EXTERNAL_TACTIC_DEFS } from './external'
import { buildRegistry } from './registry'

/**
 * 策略注册表：内置与外部合流后的唯一真相。
 * 校验问题（非法元数据、重复 id）在加载时就打到控制台，并在界面上以角标提示，
 * 不会静默地丢掉或顶替某套策略。
 */
const registry = buildRegistry([
  { source: 'builtin', tactics: BUILTIN_TACTIC_DEFS },
  { source: 'external', tactics: EXTERNAL_TACTIC_DEFS },
])

export const TACTIC_ISSUES: readonly string[] = registry.issues

for (const issue of TACTIC_ISSUES) {
  console.error(`[tactics] ${issue}`)
}

export const ALL_TACTICS: readonly RegisteredTactic[] = registry.tactics

export const BUILTIN_TACTICS: readonly RegisteredTactic[] = ALL_TACTICS.filter(
  (t) => t.source === 'builtin',
)

export const EXTERNAL_TACTICS: readonly RegisteredTactic[] = ALL_TACTICS.filter(
  (t) => t.source === 'external',
)

export function findTactic(id: string): RegisteredTactic | undefined {
  return ALL_TACTICS.find((t) => t.id === id)
}

/**
 * 取策略，取不到就抛错。
 * 这里刻意不回落：id 打错时宁可炸在调用点，也不要悄悄换成另一套策略打完一局。
 */
export function getTactic(id: string): RegisteredTactic {
  const found = findTactic(id)
  if (found) return found
  const available = ALL_TACTICS.map((t) => `${t.id}(${t.name})`).join('、')
  throw new Error(`未知策略 id「${id}」；已注册的策略：${available || '（空）'}`)
}

export { buildRegistry, validateTactic } from './registry'
export type { RegisteredTactic, Tactic, TacticAccent, TacticSource } from './api'
