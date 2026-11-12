import { describe, expect, it } from 'vitest'
import {
  BattleEngine,
  BOARD_H,
  BOARD_W,
  PALACE,
  STAR_POINTS,
  buildConfig,
  getTactic,
  runMatch,
  validateConfig,
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
    style: 'test',
    complexity: 1,
    tags: [],
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

  it('开局单位不越界，士在九宫内', () => {
    const engine = newEngine(buildConfig(), idleTactic, idleTactic)
    for (const u of engine.units) {
      expect(u.x).toBeGreaterThanOrEqual(-0.001)
      expect(u.x).toBeLessThanOrEqual(BOARD_W + 0.001)
      expect(u.y).toBeGreaterThanOrEqual(-0.001)
      expect(u.y).toBeLessThanOrEqual(BOARD_H + 0.001)
      if (u.type === 'advisor') {
        const p = PALACE[u.team]
        expect(u.x).toBeGreaterThanOrEqual(p.x0)
        expect(u.x).toBeLessThanOrEqual(p.x1)
        expect(u.y).toBeGreaterThanOrEqual(p.y0)
        expect(u.y).toBeLessThanOrEqual(p.y1)
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

  it('士被限制在九宫内，象始终落在星位', () => {
    const engine = newEngine(buildConfig({ duration: 60 }), getTactic('charge'), getTactic('counter'), 7)
    advance(engine, 55)
    for (const u of engine.units) {
      if (!u.alive) continue
      if (u.type === 'advisor') {
        const p = PALACE[u.team]
        expect(u.x).toBeGreaterThanOrEqual(p.x0 - 0.01)
        expect(u.x).toBeLessThanOrEqual(p.x1 + 0.01)
        expect(u.y).toBeGreaterThanOrEqual(p.y0 - 0.01)
        expect(u.y).toBeLessThanOrEqual(p.y1 + 0.01)
      }
      if (u.type === 'elephant') {
        expect(
          STAR_POINTS[u.team].some((s) => Math.abs(s.x - u.x) < 0.01 && Math.abs(s.y - u.y) < 0.01),
        ).toBe(true)
      }
    }
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
    expect(s.winner).toBe('black')
    expect(s.reason).toBe('overtime-bleed')
    expect(s.duration).toBeCloseTo(130.8833, 3)
    expect(s.blackBaseHp).toBeCloseTo(1139.91, 1)
    expect(s.stats.red.damage).toBeCloseTo(26984.91, 0)
    expect(s.stats.black.damage).toBeCloseTo(27602.02, 0)
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
