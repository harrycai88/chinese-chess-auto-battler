import type { Tactic } from '../api'
import { chargeTactic } from './charge'
import { counterTactic } from './counter'

/**
 * 随仓库发布的内置策略。
 * 新增内置策略：在本目录加一个文件，然后在这里登记一行。
 */
export const BUILTIN_TACTIC_DEFS: readonly Tactic[] = [chargeTactic, counterTactic]
