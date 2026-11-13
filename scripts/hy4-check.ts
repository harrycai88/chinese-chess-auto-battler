/**
 * HY4 策略验收脚本：只与内置 tactics（charge / counter）约战。
 *
 * 直接 import 规则内核与 builtin 登记表，不经过 tactics/index.ts，
 * 因此不会加载 external/ 下的其它策略实现，也不会把它们当作对手或基准。
 *
 * pnpm tsx scripts/hy4-check.ts --matches 20 --seed 1
 */
import { BattleEngine } from '../src/engine/battle'
import { buildConfig } from '../src/engine/config'
import { BUILTIN_TACTIC_DEFS } from '../src/engine/tactics/builtin'
import { hy4DominionTactic } from '../src/engine/tactics/external/hy4Dominion'
import type { Tactic } from '../src/engine/tactics/api'
import type { Team } from '../src/engine/types'

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const count = Math.max(1, Number(arg('matches', '20')))
const seed = Number(arg('seed', '1'))
const duration = Number(arg('duration', '120'))
const detail = process.argv.includes('--detail')
const showLosses = process.argv.includes('--losses')

const builtins: Record<string, Tactic> = {}
for (const t of BUILTIN_TACTIC_DEFS) builtins[t.id] = t
const all: Record<string, Tactic> = { ...builtins, [hy4DominionTactic.id]: hy4DominionTactic }

interface One {
  winner: Team | null
  reason: string | null
  time: number
  myBaseHp: number
  foeBaseHp: number
  mySiege: number
  foeSiege: number
  myRejects: number
  myErrors: number
  myAlive: number
  foeAlive: number
  rejectSamples: Array<{ reason: string; detail: string; count: number }>
}

function play(redId: string, blackId: string, s: number): One {
  const cfg = buildConfig({ duration })
  const engine = new BattleEngine({
    config: cfg,
    tactics: { red: all[redId], black: all[blackId] },
    seed: s >>> 0,
  })
  const maxSteps = Math.ceil(cfg.match.safetyCap / cfg.physics.step) + 10
  let steps = 0
  while (engine.phase !== 'ended' && steps < maxSteps) {
    engine.step()
    steps++
  }
  const sum = engine.getSummary()
  const mine: Team = redId === hy4DominionTactic.id ? 'red' : 'black'
  const foe: Team = mine === 'red' ? 'black' : 'red'
  return {
    winner: sum.winner,
    reason: sum.reason,
    time: sum.duration,
    myBaseHp: mine === 'red' ? sum.redBaseHp : sum.blackBaseHp,
    foeBaseHp: mine === 'red' ? sum.blackBaseHp : sum.redBaseHp,
    mySiege: sum.stats[mine].siege,
    foeSiege: sum.stats[foe].siege,
    myRejects: sum.stats[mine].rejections,
    myErrors: sum.stats[mine].errors,
    myAlive: mine === 'red' ? sum.redAlive : sum.blackAlive,
    foeAlive: mine === 'red' ? sum.blackAlive : sum.redAlive,
    rejectSamples: engine.stats[mine].rejectSamples.map((s) => ({ ...s })),
  }
}

interface Row {
  label: string
  wins: number
  games: number
  avgTime: number
  avgMyBase: number
  avgFoeBase: number
  avgSiege: number
  rejects: number
  errors: number
  reasons: Map<string, number>
}

function series(label: string, redId: string, blackId: string): Row {
  const row: Row = {
    label,
    wins: 0,
    games: 0,
    avgTime: 0,
    avgMyBase: 0,
    avgFoeBase: 0,
    avgSiege: 0,
    rejects: 0,
    errors: 0,
    reasons: new Map(),
  }
  const mine: Team = redId === hy4DominionTactic.id ? 'red' : 'black'
  for (let i = 0; i < count; i++) {
    const r = play(redId, blackId, seed * 7919 + i * 104729)
    row.games++
    if (r.winner === mine) row.wins++
    row.avgTime += r.time
    row.avgMyBase += r.myBaseHp
    row.avgFoeBase += r.foeBaseHp
    row.avgSiege += r.mySiege
    row.rejects += r.myRejects
    row.errors += r.myErrors
    const k = r.reason ?? 'none'
    row.reasons.set(k, (row.reasons.get(k) ?? 0) + 1)
    if (showLosses && r.winner !== mine) {
      console.log(
        `  败局 ${label} #${i} seed=${(seed * 7919 + i * 104729) >>> 0}：${r.reason} · ${r.time.toFixed(1)}s · 基地 ${r.myBaseHp.toFixed(0)}/${r.foeBaseHp.toFixed(0)} · 攻城 ${r.mySiege.toFixed(0)}/${r.foeSiege.toFixed(0)} · 兵力 ${r.myAlive}/${r.foeAlive}`,
      )
    }
    if (detail && i === 0) {
      console.log(
        `  样本 ${label}：${r.winner === mine ? '胜' : '负'} · ${r.reason} · ${r.time.toFixed(1)}s · 基地 ${r.myBaseHp.toFixed(0)}/${r.foeBaseHp.toFixed(0)} · 攻城 ${r.mySiege.toFixed(0)}/${r.foeSiege.toFixed(0)} · 兵力 ${r.myAlive}/${r.foeAlive} · 拒绝 ${r.myRejects} · 异常 ${r.myErrors}`,
      )
      if (r.rejectSamples.length) {
        console.log(`  拒绝样本：${JSON.stringify(r.rejectSamples.slice(0, 5))}`)
      }
    }
  }
  row.avgTime /= row.games
  row.avgMyBase /= row.games
  row.avgFoeBase /= row.games
  row.avgSiege /= row.games
  return row
}

const mine = hy4DominionTactic.id
const rows: Row[] = []
for (const foeId of Object.keys(builtins)) {
  rows.push(series(`我方红 vs ${foeId}`, mine, foeId))
  rows.push(series(`我方黑 vs ${foeId}`, foeId, mine))
}

console.log(`\n对手仅限内置策略：${Object.keys(builtins).join('、')} · 每格 ${count} 局 · 种子 ${seed} · 局时 ${duration}s`)
let totalWins = 0
let totalGames = 0
for (const r of rows) {
  totalWins += r.wins
  totalGames += r.games
  const reasons = [...r.reasons.entries()].map(([k, v]) => `${k}×${v}`).join(' ')
  console.log(
    `${r.label.padEnd(20)} ${String(r.wins).padStart(2)}/${r.games}  ${((r.wins / r.games) * 100).toFixed(0)}%  ` +
      `时长 ${r.avgTime.toFixed(1)}s  基地 我 ${r.avgMyBase.toFixed(0)} / 敌 ${r.avgFoeBase.toFixed(0)}  ` +
      `攻城 ${r.avgSiege.toFixed(0)}  拒绝 ${r.rejects}  异常 ${r.errors}  [${reasons}]`,
  )
}
console.log(`\n总胜率 ${totalWins}/${totalGames} = ${((totalWins / totalGames) * 100).toFixed(1)}%`)
