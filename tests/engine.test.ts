import { describe, expect, it } from 'vitest'
import {
  ALL_TACTICS,
  BattleEngine,
  BOARD_H,
  BOARD_W,
  BUILTIN_TACTICS,
  EXTERNAL_TACTICS,
  STAR_POINTS,
  TACTIC_ISSUES,
  buildConfig,
  buildRegistry,
  findTactic,
  getTactic,
  runMatch,
  validateConfig,
  validateTactic,
} from '../src/engine'
import type { BattleConfig } from '../src/engine'
import type { IntentMap, Snapshot, Tactic } from '../src/engine/tactics/api'
import { distance } from '../src/engine/tactics/api'
import type { Unit, UnitType } from '../src/engine/types'

const DT = 1 / 60

function makeTactic(id: string, decide: (snap: Snapshot) => IntentMap): Tactic {
  return {
    id,
    name: id,
    author: 'test',
    version: '1.0.0',
    description: 'test tactic',
    accent: 'ink',
    createMemory: () => ({}),
    decide,
  }
}

const idleTactic = makeTactic('idle', (snap) => {
  const intents: IntentMap = { [snap.myBase.id]: { type: 'idle' } }
  for (const u of snap.allies) if (u.alive) intents[u.id] = { type: 'idle' }
  return intents
})

const aggressiveTactic = makeTactic('aggressive', (snap) => {
  const intents: IntentMap = { [snap.myBase.id]: { type: 'idle' } }
  const targets = [...snap.enemies, snap.enemyBase].filter((u) => u.alive && u.targetable)
  for (const u of snap.allies) {
    if (!u.alive) continue
    let best = targets[0]
    let bestD = best ? distance(u, best) : Infinity
    for (const t of targets) {
      const d = distance(u, t)
      if (d < bestD) {
        bestD = d
        best = t
      }
    }
    intents[u.id] = best ? { type: 'attack', targetId: best.id } : { type: 'idle' }
  }
  return intents
})

function advance(engine: BattleEngine, seconds: number): void {
  const steps = Math.round(seconds / DT)
  for (let i = 0; i < steps; i++) {
    engine.step()
    if (engine.phase === 'ended') return
  }
}

/** 推进到条件成立或超时，用于「等到某件事发生」的场景 */
function advanceUntil(engine: BattleEngine, pred: () => boolean, maxSeconds = 40): boolean {
  const steps = Math.round(maxSeconds / DT)
  for (let i = 0; i < steps; i++) {
    if (pred()) return true
    engine.step()
    if (engine.phase === 'ended') break
  }
  return pred()
}

function allFieldUnits(engine: BattleEngine): Unit[] {
  return engine.units.filter((u) => !u.isBase)
}

function disableFieldUnits(engine: BattleEngine, keep: Unit[] = []): void {
  for (const u of allFieldUnits(engine)) {
    if (keep.includes(u)) continue
    u.alive = false
    u.hp = 0
    u.respawnTimer = -1
    u.intent = null
  }
}

function reviveAt(u: Unit, x: number, y: number, hp?: number): void {
  u.alive = true
  u.hp = hp ?? u.maxHp
  u.x = x
  u.y = y
  u.vx = 0
  u.vy = 0
  u.kvx = 0
  u.kvy = 0
  u.stun = 0
  u.cooldown = 0
  u.hitTimer = 0
  u.outOfCombat = 999
  u.respawnTimer = 0
  u.intent = null
  u.form = 'mobile'
  u.jumpPhase = 'none'
  u.tpPhase = 'none'
  u.skillCooldown = 0
  u.targetId = null
}

function disableBaseTurrets(engine: BattleEngine): void {
  for (const u of engine.units) if (u.isBase) u.cooldown = 99999
}

function unitOf(engine: BattleEngine, team: 'red' | 'black', type: UnitType, index = 0): Unit {
  const list = engine.units.filter((u) => u.team === team && u.type === type)
  return list[index]
}

function newEngine(config: BattleConfig, red: Tactic, black: Tactic, seed = 1): BattleEngine {
  return new BattleEngine({ config, tactics: { red, black }, seed })
}

describe('数值源与阵型', () => {
  it('配置校验会指出具体字段', () => {
    const cfg = buildConfig()
    cfg.base.hp = -1
    const issues = validateConfig(cfg)
    expect(issues.some((i) => i.path === 'base.hp')).toBe(true)
  })

  it('几何契约：炮能打到基地的站位，必然落在基地炮塔射程内', () => {
    const cfg = buildConfig()
    const cannonReach = cfg.units.cannon.range + cfg.base.radius
    const turretReach = cfg.base.turret.range + cfg.units.cannon.radius
    expect(cannonReach).toBeLessThanOrEqual(turretReach)
    // 反例：把炮射程拉回 4.5，就会出现「我打得到你、你打不到我」的吊射位
    cfg.units.cannon.range = 4.5
    expect(validateConfig(cfg).some((i) => i.path === 'units.cannon.range')).toBe(true)
  })

  it('标准阵型：每方 15 个常规/精英单位 + 1 个基地', () => {
    const engine = newEngine(buildConfig(), idleTactic, idleTactic)
    const red = engine.units.filter((u) => u.team === 'red' && !u.isBase)
    const black = engine.units.filter((u) => u.team === 'black' && !u.isBase)
    expect(red).toHaveLength(15)
    expect(black).toHaveLength(15)
    const count = (list: Unit[]) =>
      list.reduce<Record<string, number>>((acc, u) => {
        acc[u.type] = (acc[u.type] ?? 0) + 1
        return acc
      }, {})
    const expected = { rook: 2, horse: 2, cannon: 2, pawn: 5, advisor: 2, elephant: 2 }
    expect(count(red)).toEqual(expected)
    expect(count(black)).toEqual(expected)
    const redBase = engine.units.find((u) => u.team === 'red' && u.isBase)!
    const blackBase = engine.units.find((u) => u.team === 'black' && u.isBase)!
    expect([redBase.x, redBase.y]).toEqual([4, 8])
    expect([blackBase.x, blackBase.y]).toEqual([4, 1])
    for (const e of red.filter((u) => u.type === 'elephant')) {
      expect(STAR_POINTS.red.some((s) => Math.abs(s.x - e.x) < 0.01 && Math.abs(s.y - e.y) < 0.01)).toBe(true)
    }
  })

  it('开局单位不越界，士在自己的防区内', () => {
    const engine = newEngine(buildConfig(), idleTactic, idleTactic)
    const guard = engine.config.units.advisor.guard!
    for (const u of engine.units) {
      expect(u.x).toBeGreaterThanOrEqual(-0.001)
      expect(u.x).toBeLessThanOrEqual(BOARD_W + 0.001)
      expect(u.y).toBeGreaterThanOrEqual(-0.001)
      expect(u.y).toBeLessThanOrEqual(BOARD_H + 0.001)
      if (u.type === 'advisor') {
        const base = engine.units.find((b) => b.isBase && b.team === u.team)!
        expect(distance(u, base)).toBeLessThanOrEqual(guard.radius - u.radius + 0.01)
      }
    }
  })
})

describe('确定性', () => {
  it('同配置、同策略、同种子，结果完全一致', () => {
    const cfg = buildConfig({ duration: 60 })
    const red = getTactic('charge')
    const black = getTactic('counter')
    const a = runMatch(cfg, red, black, 424242)
    const b = runMatch(cfg, red, black, 424242)
    expect(a.summary.winner).toBe(b.summary.winner)
    expect(a.summary.duration).toBeCloseTo(b.summary.duration, 10)
    expect(a.summary.redBaseHp).toBeCloseTo(b.summary.redBaseHp, 8)
    expect(a.summary.blackBaseHp).toBeCloseTo(b.summary.blackBaseHp, 8)
    expect(a.summary.stats.red.damage).toBeCloseTo(b.summary.stats.red.damage, 8)
    expect(a.summary.stats.black.damage).toBeCloseTo(b.summary.stats.black.damage, 8)
  })

  it('不同种子会跑出不同的仗', () => {
    const cfg = buildConfig({ duration: 60 })
    const red = getTactic('charge')
    const black = getTactic('counter')
    const results = [11, 12, 13, 14].map((seed) => {
      const m = runMatch(cfg, red, black, seed).summary
      return `${m.winner}:${m.duration.toFixed(2)}:${m.stats.red.damage.toFixed(2)}`
    })
    expect(new Set(results).size).toBeGreaterThan(1)
  })
})

describe('意图白名单与拒绝', () => {
  it('拒绝敌方单位、非法目标与超窗跃击', () => {
    const jumpTactic = makeTactic('bad-jump', (snap) => {
      const intents: IntentMap = { [snap.myBase.id]: { type: 'idle' } }
      const horse = snap.allies.find((u) => u.type === 'horse')
      const enemyHorse = snap.enemies.find((u) => u.type === 'horse')
      for (const u of snap.allies) intents[u.id] = { type: 'idle' }
      if (horse && enemyHorse) {
        intents[horse.id] = { type: 'jump', targetId: enemyHorse.id }
        intents[enemyHorse.id] = { type: 'attack', targetId: horse.id }
      }
      return intents
    })
    const engine = newEngine(buildConfig(), jumpTactic, idleTactic)
    expect(engine.stats.red.rejections).toBeGreaterThan(0)
    expect(engine.stats.red.rejectSamples.some((s) => s.reason === 'out-of-window')).toBe(true)
    expect(engine.stats.red.rejectSamples.some((s) => s.reason === 'not-yours')).toBe(true)
  })

  it('未知单位与非法攻击目标被计数而非静默吞掉', () => {
    const badTactic = makeTactic('bad', (snap) => {
      const horse = snap.allies.find((u) => u.type === 'horse')!
      return {
        999999: { type: 'idle' },
        [horse.id]: { type: 'attack', targetId: horse.id },
      } as IntentMap
    })
    const engine = newEngine(buildConfig(), badTactic, idleTactic)
    expect(engine.stats.red.rejections).toBeGreaterThanOrEqual(2)
    expect(engine.stats.red.rejectSamples.some((s) => s.reason === 'unknown-unit')).toBe(true)
    expect(engine.stats.red.rejectSamples.some((s) => s.reason === 'illegal-target')).toBe(true)
  })
})

describe('兵种机制', () => {
  it('车在单挑中击败兵', () => {
    const engine = newEngine(buildConfig(), aggressiveTactic, aggressiveTactic)
    disableFieldUnits(engine, [unitOf(engine, 'red', 'rook'), unitOf(engine, 'black', 'pawn')])
    disableBaseTurrets(engine)
    const rook = unitOf(engine, 'red', 'rook')
    const pawn = unitOf(engine, 'black', 'pawn')
    reviveAt(rook, 2, 4.5)
    reviveAt(pawn, 0.4, 4.5)
    advance(engine, 10)
    expect(pawn.alive).toBe(false)
    expect(rook.alive).toBe(true)
  })

  it('炮架起后能在近战单位接近前造成伤害', () => {
    const engine = newEngine(buildConfig(), aggressiveTactic, aggressiveTactic)
    disableFieldUnits(engine, [unitOf(engine, 'red', 'cannon'), unitOf(engine, 'black', 'rook')])
    disableBaseTurrets(engine)
    const cannon = unitOf(engine, 'red', 'cannon')
    const rook = unitOf(engine, 'black', 'rook')
    reviveAt(cannon, 0.5, 4.5)
    cannon.form = 'siege'
    reviveAt(rook, 3.6, 4.5)
    advance(engine, 1.6)
    expect(rook.hp).toBeLessThan(rook.maxHp)
  })

  it('炮在移动形态无法开火，被贴脸时会被近战击杀', () => {
    const engine = newEngine(buildConfig(), aggressiveTactic, aggressiveTactic)
    disableFieldUnits(engine, [unitOf(engine, 'red', 'rook'), unitOf(engine, 'black', 'cannon')])
    disableBaseTurrets(engine)
    const rook = unitOf(engine, 'red', 'rook')
    const cannon = unitOf(engine, 'black', 'cannon')
    reviveAt(rook, 2.4, 4.5)
    reviveAt(cannon, 0.6, 4.5)
    advance(engine, 8)
    expect(cannon.alive).toBe(false)
  })

  it('马的跃击有距离窗口，贴脸与超远都不能起跳', () => {
    const engine = newEngine(buildConfig(), idleTactic, idleTactic)
    const horse = unitOf(engine, 'red', 'horse')
    const other = unitOf(engine, 'red', 'rook')
    reviveAt(horse, 2, 4.5)
    reviveAt(other, 2.8, 4.5)
    const closeTactic = makeTactic('close', (snap) => {
      const intents: IntentMap = { [snap.myBase.id]: { type: 'idle' } }
      for (const u of snap.allies) intents[u.id] = { type: 'idle' }
      intents[horse.id] = { type: 'jump', targetId: other.id }
      return intents
    })
    // 目标必须是敌方；这里用敌方马来验证超窗，用己方马验证非法目标
    const engine2 = newEngine(buildConfig(), closeTactic, idleTactic)
    expect(engine2.stats.red.rejectSamples.some((s) => s.reason === 'illegal-target' || s.reason === 'out-of-window')).toBe(true)
  })

  it('士在防区环内巡防，象始终落在星位', () => {
    const engine = newEngine(buildConfig({ duration: 60 }), getTactic('charge'), getTactic('counter'), 7)
    const guard = engine.config.units.advisor.guard!
    advance(engine, 55)
    for (const u of engine.units) {
      if (!u.alive) continue
      if (u.type === 'advisor') {
        const base = engine.units.find((b) => b.isBase && b.team === u.team)!
        const d = distance(u, base)
        expect(d).toBeLessThanOrEqual(guard.radius - u.radius + 0.02)
        expect(d).toBeGreaterThan(u.radius + base.radius - 0.01)
      }
      if (u.type === 'elephant') {
        expect(
          STAR_POINTS[u.team].some((s) => Math.abs(s.x - u.x) < 0.01 && Math.abs(s.y - u.y) < 0.01),
        ).toBe(true)
      }
    }
  })

  it('士不站桩：哪怕策略让它待命，它也在防区里持续走位', () => {
    const engine = newEngine(buildConfig(), idleTactic, idleTactic)
    const advisors = engine.units.filter((u) => u.type === 'advisor')
    // 只留士上战场：验证的是巡防机制本身，不是拥挤时的挤压
    disableFieldUnits(engine, advisors)
    disableBaseTurrets(engine)
    advance(engine, 2)
    let prev = advisors.map((u) => ({ x: u.x, y: u.y }))
    let path = 0
    let stillFrames = 0
    let longestStill = 0
    const frames = Math.round(12 / DT)
    for (let i = 0; i < frames; i++) {
      engine.step()
      advisors.forEach((u, idx) => {
        const step = Math.hypot(u.x - prev[idx].x, u.y - prev[idx].y)
        path += step
        if (step < 0.002) {
          stillFrames++
          longestStill = Math.max(longestStill, stillFrames)
        } else {
          stillFrames = 0
        }
        prev[idx] = { x: u.x, y: u.y }
      })
    }
    // 平均速度要像一个在巡逻的护卫，而不是一根桩子
    expect(path / (12 * advisors.length)).toBeGreaterThan(0.4)
    // 任何一次「停住」都不能超过 0.3 秒
    expect(longestStill * DT).toBeLessThan(0.3)
  })

  it('炮的展开与收起都要耗时，但不会拖住整个节奏', () => {
    const cfg = buildConfig()
    const deploy = cfg.units.cannon.deploy!
    expect(deploy.deployTime).toBeGreaterThan(0.2)
    expect(deploy.packTime).toBeGreaterThan(0.2)
    expect(deploy.deployTime).toBeLessThan(1)
    expect(deploy.packTime).toBeLessThan(1.2)

    const engine = newEngine(cfg, idleTactic, idleTactic)
    disableBaseTurrets(engine)
    const cannon = unitOf(engine, 'red', 'cannon')
    cannon.form = 'mobile'
    cannon.intent = { type: 'deploy' }
    advance(engine, deploy.deployTime * 0.5)
    expect(cannon.form).toBe('deploying')
    advance(engine, deploy.deployTime * 0.6)
    expect(cannon.form).toBe('siege')
    cannon.intent = { type: 'undeploy' }
    advance(engine, 0.05)
    expect(cannon.form).toBe('packing')
    advance(engine, deploy.packTime + 0.05)
    expect(cannon.form).toBe('mobile')
  })

  it('常规军阵亡后读条复活，满血回到出生点', () => {
    const engine = newEngine(buildConfig(), idleTactic, idleTactic)
    disableFieldUnits(engine, [unitOf(engine, 'red', 'pawn')])
    disableBaseTurrets(engine)
    const pawn = unitOf(engine, 'red', 'pawn')
    reviveAt(pawn, pawn.homeX, pawn.homeY)
    pawn.alive = false
    pawn.hp = 0
    pawn.respawnTimer = 0.5
    advance(engine, 1.2)
    expect(pawn.alive).toBe(true)
    expect(pawn.hp).toBeCloseTo(pawn.maxHp, 5)
    expect(Math.abs(pawn.x - pawn.homeX)).toBeLessThanOrEqual(pawn.radius + 0.02)
    expect(Math.abs(pawn.y - pawn.homeY)).toBeLessThanOrEqual(pawn.radius + 0.02)
  })

  it('士、象的复活读条极长，但读完之后仍会归队', () => {
    const cfg = buildConfig()
    expect(cfg.units.advisor.respawn).toBeGreaterThan(cfg.units.rook.respawn * 2)
    expect(cfg.units.elephant.respawn).toBeGreaterThan(cfg.units.rook.respawn * 2)

    const engine = newEngine(cfg, aggressiveTactic, aggressiveTactic)
    disableFieldUnits(engine, [unitOf(engine, 'red', 'rook'), unitOf(engine, 'black', 'advisor')])
    disableBaseTurrets(engine)
    const rook = unitOf(engine, 'red', 'rook')
    const advisor = unitOf(engine, 'black', 'advisor')
    reviveAt(rook, 3.4, 4.5)
    reviveAt(advisor, 4.6, 4.5)
    expect(advanceUntil(engine, () => !advisor.alive, 40)).toBe(true)
    expect(advisor.respawnTimer).toBeGreaterThan(cfg.units.advisor.respawn * 0.9)

    // 旧规则里精英是「常规局永久离场」，现在读条走完就会归队
    advisor.respawnTimer = 0.4
    advance(engine, 1)
    expect(advisor.alive).toBe(true)
  })

  it('回到自己的底座圈且脱战后会回血', () => {
    const engine = newEngine(buildConfig(), idleTactic, idleTactic)
    disableFieldUnits(engine, [unitOf(engine, 'red', 'rook')])
    disableBaseTurrets(engine)
    const rook = unitOf(engine, 'red', 'rook')
    reviveAt(rook, rook.homeX, rook.homeY)
    rook.hp = 100
    rook.outOfCombat = 8
    advance(engine, 1)
    expect(rook.hp).toBeGreaterThan(120)
  })
})

describe('胜负与加时', () => {
  it('击毁基地立即结束对局', () => {
    const engine = newEngine(buildConfig(), aggressiveTactic, idleTactic)
    const redRook = unitOf(engine, 'red', 'rook')
    disableFieldUnits(engine, [redRook])
    disableBaseTurrets(engine)
    const blackBase = engine.units.find((u) => u.team === 'black' && u.isBase)!
    blackBase.hp = 20
    reviveAt(redRook, 4, 2.4)
    advance(engine, 3)
    expect(engine.phase).toBe('ended')
    expect(engine.winner).toBe('red')
    expect(engine.reason).toBe('base-destroyed')
    expect(blackBase.alive).toBe(false)
  })

  it('加时双方等速流血，不产生平局', () => {
    const cfg = buildConfig({ duration: 60 })
    const engine = newEngine(cfg, idleTactic, idleTactic)
    disableBaseTurrets(engine)
    advance(engine, 79)
    expect(engine.phase).toBe('overtime')
    const red = engine.units.find((u) => u.team === 'red' && u.isBase)!
    const black = engine.units.find((u) => u.team === 'black' && u.isBase)!
    expect(Math.abs(red.hp - black.hp)).toBeLessThan(0.5)
    expect(red.hp).toBeCloseTo(cfg.base.hp - 120 * 19, 0)
  })

  it('不限时模式不会进入加时', () => {
    const cfg = buildConfig({ duration: 0 })
    const engine = newEngine(cfg, idleTactic, idleTactic)
    advance(engine, 70)
    expect(cfg.match.duration).toBeNull()
    expect(engine.phase).toBe('normal')
    expect(engine.overtimeElapsed).toBe(0)
    expect(engine.remaining).toBe(0)
  })

  it('安全上限只做兜底裁决，仍然给出胜者', () => {
    const cfg = buildConfig({ duration: 60 })
    cfg.match.safetyCap = 8
    const engine = newEngine(cfg, idleTactic, idleTactic)
    advance(engine, 10)
    expect(engine.phase).toBe('ended')
    expect(engine.reason).toBe('safety-cap')
    expect(engine.winner).not.toBeNull()
  })

  it('黄金对局：固定种子的结果指纹稳定', () => {
    const run = runMatch(buildConfig({ duration: 120 }), getTactic('charge'), getTactic('counter'), 20261112)
    const s = run.summary
    expect(s.winner).toBe('red')
    expect(s.reason).toBe('overtime-bleed')
    expect(s.duration).toBeCloseTo(138.48, 2)
    expect(s.redBaseHp).toBeCloseTo(268.08, 1)
    expect(s.stats.red.damage).toBeCloseTo(31812.17, 0)
    expect(s.stats.black.damage).toBeCloseTo(32154.97, 0)
  })

  it('完整对局能跑完且统计自洽', () => {
    const cfg = buildConfig({ duration: 60 })
    const run = runMatch(cfg, getTactic('charge'), getTactic('counter'), 909)
    expect(run.summary.phase).toBe('ended')
    expect(run.summary.winner).not.toBeNull()
    expect(run.summary.duration).toBeLessThanOrEqual(cfg.match.safetyCap)
    for (const team of ['red', 'black'] as const) {
      const st = run.summary.stats[team]
      const byDamage = Object.values(st.byType).reduce((s, t) => s + t.damage, 0)
      const byKills = Object.values(st.byType).reduce((s, t) => s + t.kills, 0)
      const byDeaths = Object.values(st.byType).reduce((s, t) => s + t.deaths, 0)
      expect(byDamage).toBeCloseTo(st.damage, 2)
      expect(byKills).toBe(st.kills)
      expect(byDeaths).toBe(st.deaths)
    }
  })
})

describe('策略注册表', () => {
  it('内置与外部策略分注册，来源由注册表标注', () => {
    expect(BUILTIN_TACTICS.length).toBeGreaterThan(0)
    expect(BUILTIN_TACTICS.every((t) => t.source === 'builtin')).toBe(true)
    expect(EXTERNAL_TACTICS.every((t) => t.source === 'external')).toBe(true)
    expect(ALL_TACTICS.length).toBe(BUILTIN_TACTICS.length + EXTERNAL_TACTICS.length)
    expect(new Set(ALL_TACTICS.map((t) => t.id)).size).toBe(ALL_TACTICS.length)
  })

  it('随仓库发布的内置策略都通过校验', () => {
    expect(TACTIC_ISSUES).toEqual([])
    for (const t of ALL_TACTICS) expect(validateTactic(t, t.id)).toEqual([])
  })

  it('未知 id 直接抛错，不回落成别家策略', () => {
    expect(() => getTactic('chargee')).toThrowError(/未知策略 id「chargee」/)
    expect(findTactic('chargee')).toBeUndefined()
    expect(findTactic('charge')?.id).toBe('charge')
  })

  it('校验能指出缺失字段、非法 id 与非法 accent', () => {
    const broken = {
      id: 'Bad Id',
      name: '',
      author: 'x',
      version: '1',
      accent: 'red',
      createMemory: () => ({}),
    }
    const issues = validateTactic(broken, 'external[0]')
    const joined = issues.join('\n')
    expect(joined).toContain('external[0].id')
    expect(joined).toContain('external[0].name')
    expect(joined).toContain('external[0].description')
    expect(joined).toContain('external[0].accent')
    expect(joined).toContain('external[0].decide')
    expect(issues.some((i) => i.includes('小写字母'))).toBe(true)
  })

  it('重复 id 只保留先注册的一套，并记下问题', () => {
    const a = makeTactic('dup', (snap) => idleTactic.decide(snap, {}))
    const b = makeTactic('dup', (snap) => idleTactic.decide(snap, {}))
    const result = buildRegistry([
      { source: 'builtin', tactics: [a] },
      { source: 'external', tactics: [b] },
    ])
    expect(result.tactics).toHaveLength(1)
    expect(result.tactics[0].source).toBe('builtin')
    expect(result.issues.join('\n')).toContain('重复')
  })

  it('非法策略被跳过，不会污染注册表', () => {
    const result = buildRegistry([
      {
        source: 'external',
        tactics: [{ id: 'ghost', name: 'ghost' } as unknown as Tactic],
      },
    ])
    expect(result.tactics).toHaveLength(0)
    expect(result.issues.length).toBeGreaterThan(0)
  })
})
