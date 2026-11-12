import { BattleEngine } from './battle'
import type { BattleConfig } from './config'
import type { BattleSummary, Team } from './types'
import type { Tactic } from './tactics/api'
import { getTactic } from './tactics/index'

export interface MatchRun {
  summary: BattleSummary
  steps: number
  engine: BattleEngine
}

export function runMatch(
  config: BattleConfig,
  red: Tactic,
  black: Tactic,
  seed: number,
): MatchRun {
  const engine = new BattleEngine({ config, tactics: { red, black }, seed })
  const maxSteps = Math.ceil(config.match.safetyCap / config.physics.step) + 10
  let steps = 0
  while (engine.phase !== 'ended' && steps < maxSteps) {
    engine.step()
    steps++
  }
  if (engine.phase !== 'ended') {
    // 兜底：安全上限本应在引擎内裁决，这里只是防死循环
    const redHp = engine.units.find((u) => u.isBase && u.team === 'red')?.hp ?? 0
    const blackHp = engine.units.find((u) => u.isBase && u.team === 'black')?.hp ?? 0
    engine.winner = redHp >= blackHp ? 'red' : 'black'
    engine.reason = 'safety-cap'
    engine.phase = 'ended'
  }
  return { summary: engine.getSummary(), steps, engine }
}

export interface BatchResult {
  matches: BattleSummary[]
  redWins: number
  blackWins: number
  overtimeCount: number
  avgDuration: number
  avgOvertime: number
}

export function runBatch(
  config: BattleConfig,
  redId: string,
  blackId: string,
  count: number,
  seed = 1,
): BatchResult {
  const red = getTactic(redId)
  const black = getTactic(blackId)
  const matches: BattleSummary[] = []
  let redWins = 0
  let blackWins = 0
  let overtimeCount = 0
  let totalDuration = 0
  let totalOvertime = 0
  for (let i = 0; i < count; i++) {
    const run = runMatch(config, red, black, (seed * 7919 + i * 104729) >>> 0)
    const s = run.summary
    matches.push(s)
    if (s.winner === 'red') redWins++
    else if (s.winner === 'black') blackWins++
    if (s.reason === 'overtime-bleed') {
      overtimeCount++
      totalOvertime += s.duration - (config.match.duration ?? 0)
    }
    totalDuration += s.duration
  }
  return {
    matches,
    redWins,
    blackWins,
    overtimeCount,
    avgDuration: totalDuration / Math.max(1, count),
    avgOvertime: totalOvertime / Math.max(1, overtimeCount),
  }
}

export function mirror(team: Team): Team {
  return team === 'red' ? 'black' : 'red'
}
