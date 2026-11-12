/**
 * 无头批量仿真：无渲染、无音频，验证一局能否跑完并输出统计。
 *
 * pnpm sim --matches 20 --seed 1 --red charge --black counter
 */
import { buildConfig, getTactic, runBatch, runMatch } from '../src/engine'
import { BUILTIN_TACTICS } from '../src/engine/tactics'

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const matches = Number(arg('matches', '1'))
const seed = Number(arg('seed', '1'))
const redId = arg('red', 'charge')
const blackId = arg('black', 'counter')
const duration = Number(arg('duration', '120'))
const config = buildConfig({ duration })

console.log(
  `策略：红方 ${getTactic(redId).name} vs 黑方 ${getTactic(blackId).name} · 局时 ${duration}s · 种子 ${seed}`,
)
console.log(`内置策略：${BUILTIN_TACTICS.map((t) => `${t.name}(${t.id})`).join('、')}`)

if (matches <= 1) {
  const t0 = Date.now()
  const run = runMatch(config, getTactic(redId), getTactic(blackId), seed)
  const s = run.summary
  console.log(
    `结果：${s.winner === 'red' ? '红胜' : '黑胜'} · ${s.reason} · ${s.duration.toFixed(1)}s · 物理步 ${run.steps}`,
  )
  console.log(
    `基地：红 ${s.redBaseHp.toFixed(0)}/${s.redBaseMax} · 黑 ${s.blackBaseHp.toFixed(0)}/${s.blackBaseMax} · 兵力 红 ${s.redAlive} / 黑 ${s.blackAlive}`,
  )
  for (const team of ['red', 'black'] as const) {
    const st = s.stats[team]
    console.log(
      `\n[${team}] 伤害 ${st.damage.toFixed(0)} 攻城 ${st.siege.toFixed(0)} 击杀 ${st.kills} 阵亡 ${st.deaths} 拒绝 ${st.rejections} 异常 ${st.errors}`,
    )
    for (const [type, ts] of Object.entries(st.byType)) {
      if (ts.initial === 0) continue
      console.log(
        `  ${type.padEnd(9)} 存活 ${ts.alive}/${ts.initial}  伤害 ${ts.damage.toFixed(0)}  攻城 ${ts.siege.toFixed(0)}  复活 ${ts.respawns}  跃击 ${ts.jumpHits}/${ts.jumpCasts}`,
      )
    }
    if (st.rejectSamples.length) console.log(`  拒绝样本：${JSON.stringify(st.rejectSamples.slice(0, 3))}`)
  }
  console.log(`\n耗时 ${Date.now() - t0}ms`)
} else {
  const t0 = Date.now()
  const r = runBatch(config, redId, blackId, matches, seed)
  console.log(
    `完成 ${r.matches.length} 局：红 ${r.redWins} 胜 / 黑 ${r.blackWins} 胜 · 加时 ${r.overtimeCount} 局`,
  )
  console.log(
    `平均时长 ${r.avgDuration.toFixed(1)}s · 加时平均 ${r.avgOvertime.toFixed(1)}s · 用时 ${Date.now() - t0}ms`,
  )
  const reasons = new Map<string, number>()
  for (const m of r.matches) reasons.set(m.reason ?? 'none', (reasons.get(m.reason ?? 'none') ?? 0) + 1)
  console.log(`结束原因：${[...reasons.entries()].map(([k, v]) => `${k}×${v}`).join(' ')}`)
}
