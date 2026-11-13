import type { RegisteredTactic, Tactic, TacticSource } from './api'

const ACCENTS: readonly string[] = ['vermilion', 'jade', 'gold', 'ink']
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/

export interface TacticGroup {
  source: TacticSource
  tactics: readonly Tactic[]
}

export interface RegistryResult {
  tactics: RegisteredTactic[]
  issues: string[]
}

/**
 * 校验一套策略的元数据与接口。
 * 返回人类可读的问题列表；空数组表示可以注册。
 * 只做静态形状检查，不执行 decide —— 策略的行为正确性由对局本身暴露。
 */
export function validateTactic(input: unknown, path = 'tactic'): string[] {
  if (!input || typeof input !== 'object') return [`${path}: 必须是一个对象`]
  const t = input as Record<string, unknown>
  const at = (k: string): string => `${path}.${k}`
  const issues: string[] = []

  const text = (k: string): void => {
    const v = t[k]
    if (typeof v !== 'string' || v.trim().length === 0) issues.push(`${at(k)}: 必须是非空字符串`)
  }

  text('id')
  if (typeof t.id === 'string' && !ID_PATTERN.test(t.id)) {
    issues.push(`${at('id')}: 只能用小写字母、数字、连字符与下划线，且以字母或数字开头`)
  }
  text('name')
  text('author')
  text('version')
  text('description')

  if (typeof t.accent !== 'string' || !ACCENTS.includes(t.accent)) {
    issues.push(`${at('accent')}: 必须是 ${ACCENTS.join(' / ')} 之一`)
  }
  if (t.glyph !== undefined) {
    if (typeof t.glyph !== 'string' || [...t.glyph].length !== 1) {
      issues.push(`${at('glyph')}: 必须是单个字符（缺省则取名字首字）`)
    }
  }
  if (typeof t.createMemory !== 'function') issues.push(`${at('createMemory')}: 必须是函数`)
  if (typeof t.decide !== 'function') issues.push(`${at('decide')}: 必须是函数`)

  return issues
}

/**
 * 把多组策略拍平成一个注册表。
 * - 非法策略被跳过，问题写进 issues
 * - 重复 id 保留先注册的那个（内置在前，所以内置优先），后者被跳过并记问题
 */
export function buildRegistry(groups: readonly TacticGroup[]): RegistryResult {
  const tactics: RegisteredTactic[] = []
  const issues: string[] = []
  const seen = new Map<string, TacticSource>()

  for (const group of groups) {
    group.tactics.forEach((t, i) => {
      const path = `${group.source}[${i}]${t && typeof t.id === 'string' ? `(${t.id})` : ''}`
      const found = validateTactic(t, path)
      if (found.length > 0) {
        issues.push(...found)
        return
      }
      const owner = seen.get(t.id)
      if (owner) {
        issues.push(
          `${path}.id: 与已注册的${owner === 'builtin' ? '内置' : '外部'}策略「${t.id}」重复，已跳过`,
        )
        return
      }
      seen.set(t.id, group.source)
      tactics.push({ ...t, source: group.source })
    })
  }

  return { tactics, issues }
}
