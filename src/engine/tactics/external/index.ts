import type { Tactic } from '../api'
import { gemini4HydrogenTactic } from './gemini4Hydrogen'

/**
 * 外部策略登记处 —— 与内置策略分开存放，不进 builtin/。
 *
 * 加一套外部策略：
 *   1. 在本目录放一个 `xxx.ts`，导出一个 `Tactic` 对象；
 *   2. 在下面 import 并加入数组。
 * 其它代码（引擎、配置页、仿真脚本）都不用改，界面会自动按「外部策略」分组列出。
 *
 * 注意：
 *   - `id` 必须全局唯一，和内置策略撞名的那套会被跳过并在控制台报错；
 *   - `decide` 里请勿使用 `Math.random()` / `Date.now()`，否则同一种子无法复现对局；
 *   - `decide` 同步运行在决策循环里，单个 tick 的耗时直接算进对局，别写重活。
 */
export const EXTERNAL_TACTIC_DEFS: readonly Tactic[] = [gemini4HydrogenTactic]
