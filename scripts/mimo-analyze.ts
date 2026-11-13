/**
 * 破浪策略专用分析脚本（只读引擎，不动其他文件）。
 * 用法：pnpm tsx scripts/mimo-analyze.ts [--matches 20] [--seed 7] [--red mimo-surge] [--black counter]
 * 输出：双方基地终血、攻城差、胜负、时长的聚合。
 */
import { buildConfig, runMatch, getTactic } from '../src/engine'

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const matches = Number(arg('matches', '20'))
const seed = Number(arg('seed', '7'))
const redId = arg('red', 'mimo-surge')
const blackId = arg('black', 'counter')
const config = buildConfig({ duration: Number(arg('duration', '120')) })
const red = getTactic(redId)
const black = getTactic(blackId)

let redWins = 0
let ot = 0
let sumRedBase = 0
let sumBlackBase = 0
let sumRedSiege = 0
let sumBlackSiege = 0
let sumDur = 0
for (let i = 0; i < matches; i++) {
  const run = runMatch(config, red, black, (seed * 7919 + i * 104729) >>> 0)
  const s = run.summary
  if (s.winner === 'red') redWins++
  if (s.reason === 'overtime-bleed') ot++
  sumRedBase += s.redBaseHp
  sumBlackBase += s.blackBaseHp
  sumRedSiege += s.stats.red.siege
  sumBlackSiege += s.stats.black.siege
  sumDur += s.duration
  console.log(
    `#${i + 1} ${s.winner === 'red' ? '红胜' : '黑胜'} ${s.reason} ${s.duration.toFixed(1)}s 基地 红${s.redBaseHp.toFixed(0)} 黑${s.blackBaseHp.toFixed(0)} 攻城 红${s.stats.red.siege.toFixed(0)} 黑${s.stats.black.siege.toFixed(0)} 死亡 红${s.stats.red.deaths} 黑${s.stats.black.deaths}`,
  )
}
console.log(`\n汇总 ${matches} 局（红=${redId} 黑=${blackId} 种子${seed}）`)
console.log(`红胜 ${redWins}/${matches} · 加时 ${ot} · 平均时长 ${(sumDur / matches).toFixed(1)}s`)
console.log(`基地终血 红 ${(sumRedBase / matches).toFixed(0)} / 黑 ${(sumBlackBase / matches).toFixed(0)}`)
console.log(`攻城均值 红 ${(sumRedSiege / matches).toFixed(0)} / 黑 ${(sumBlackSiege / matches).toFixed(0)}`)
