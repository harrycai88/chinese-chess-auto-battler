import {
  BASE_POS,
  BOARD_H,
  BOARD_W,
  PALACE,
  RIVER_Y,
  STAR_POINTS,
  clampPointToBoard,
  clampPointToPalace,
  formationFor,
  starAt,
} from './board'
import type { BattleConfig, UnitDef } from './config'
import { validateConfig } from './config'
import { Rng, hashString } from './rng'
import type {
  BattleEvent,
  BattlePhase,
  BattleSummary,
  EndReason,
  FieldUnitType,
  Intent,
  Projectile,
  Team,
  TeamStats,
  TypeStats,
  Unit,
  UnitType,
} from './types'
import { TEAMS } from './types'
import type { IntentMap, Snapshot, StarView, Tactic, TacticMemory, UnitView } from './tactics/api'
import { clamp, distance, normalize } from './tactics/api'

export interface BattleSetup {
  config: BattleConfig
  tactics: Record<Team, Tactic>
  seed: number
}

const other = (team: Team): Team => (team === 'red' ? 'black' : 'red')
const approach = (current: number, target: number, maxDelta: number): number => {
  if (current < target) return Math.min(target, current + maxDelta)
  return Math.max(target, current - maxDelta)
}

function emptyTypeStats(initial = 0): TypeStats {
  return {
    initial,
    alive: initial,
    damage: 0,
    siege: 0,
    kills: 0,
    deaths: 0,
    respawns: 0,
    jumpCasts: 0,
    jumpHits: 0,
    deployedDeaths: 0,
  }
}

function emptyTeamStats(): TeamStats {
  const byType = {} as Record<UnitType, TypeStats>
  for (const t of ['base', 'rook', 'horse', 'cannon', 'pawn', 'advisor', 'elephant'] as UnitType[]) {
    byType[t] = emptyTypeStats()
  }
  return {
    damage: 0,
    siege: 0,
    kills: 0,
    deaths: 0,
    rejections: 0,
    decisions: 0,
    errors: 0,
    lastDecisionMs: 0,
    byType,
    rejectSamples: [],
  }
}

/**
 * 确定性战斗内核：固定步长、可播种随机、零 DOM / 零框架依赖。
 * 对外只有：推进、取事件、取快照、取结算。
 */
export class BattleEngine {
  readonly config: BattleConfig
  readonly seed: number
  readonly units: Unit[] = []
  readonly projectiles: Projectile[] = []
  readonly tactics: Record<Team, Tactic>
  readonly memories: Record<Team, TacticMemory>
  readonly fingerprint: string

  phase: BattlePhase = 'normal'
  time = 0
  remaining: number
  overtimeElapsed = 0
  winner: Team | null = null
  reason: EndReason | null = null
  readonly stats: Record<Team, TeamStats>

  private readonly baseUnits: Record<Team, Unit>
  private readonly turnOrder: Unit[] = []
  private readonly byId = new Map<number, Unit>()
  private readonly rng: Rng
  private events: BattleEvent[] = []
  private decisionTimer: number
  private nextUnitId = 10
  private nextProjectileId = 1
  private bleedEventTimer = 0
  private rejectIndex: Record<Team, Map<string, { reason: string; detail: string; count: number }>>

  constructor(setup: BattleSetup) {
    const issues = validateConfig(setup.config)
    if (issues.length) {
      throw new Error(
        `配置校验失败：${issues.map((i) => `${i.path} ${i.message}`).join('；')}`,
      )
    }
    this.config = setup.config
    this.seed = setup.seed >>> 0
    this.rng = new Rng(this.seed)
    this.tactics = setup.tactics
    this.memories = {
      red: setup.tactics.red.createMemory(),
      black: setup.tactics.black.createMemory(),
    }
    this.remaining = setup.config.match.duration ?? 0
    this.stats = { red: emptyTeamStats(), black: emptyTeamStats() }
    this.rejectIndex = { red: new Map(), black: new Map() }
    this.decisionTimer = setup.config.physics.decisionInterval
    this.fingerprint = hashString(
      JSON.stringify({
        config: setup.config,
        red: setup.tactics.red.id,
        black: setup.tactics.black.id,
      }),
    ).toString(36)

    const redBase = this.createBase('red', 1)
    const blackBase = this.createBase('black', 2)
    this.baseUnits = { red: redBase, black: blackBase }

    for (const team of TEAMS) {
      const formation = formationFor(team)
      for (const entry of formation) {
        this.createFieldUnit(team, entry.type, entry.x, entry.y)
      }
    }

    // 极小幅度、可复现的开局扰动：破坏完美镜像，让同一种子之外的对局真正不同
    for (const u of this.units) {
      if (u.isBase || u.type === 'elephant') continue
      u.x += (this.rng.next() - 0.5) * 0.07
      u.y += (this.rng.next() - 0.5) * 0.07
      const p =
        u.type === 'advisor'
          ? clampPointToPalace(u.team, u.x, u.y, u.radius)
          : clampPointToBoard(u.x, u.y, u.radius)
      u.x = p.x
      u.y = p.y
    }

    // 每步按播种后的顺序处理，避免红方永远先手
    const order = [...this.units]
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng.next() * (i + 1))
      const tmp = order[i]
      order[i] = order[j]
      order[j] = tmp
    }
    this.turnOrder.push(...order)

    for (const team of TEAMS) {
      for (const u of this.units) {
        if (u.team === team) this.stats[team].byType[u.type].initial++
      }
      // base 的 initial 单独计一次
      this.stats[team].byType.base.initial = 1
      this.stats[team].byType.base.alive = 1
    }

    this.runDecisions()
  }

  // ───────────────────────────── 初始化 ─────────────────────────────

  private createBase(team: Team, id: number): Unit {
    const p = BASE_POS[team]
    const maxHp = this.config.base.hp
    const u: Unit = {
      id,
      team,
      type: 'base',
      x: p.x,
      y: p.y,
      vx: 0,
      vy: 0,
      kvx: 0,
      kvy: 0,
      hp: maxHp,
      maxHp,
      radius: this.config.base.radius,
      mass: 1000,
      facing: team === 'red' ? -Math.PI / 2 : Math.PI / 2,
      cooldown: 0,
      attackAnim: 0,
      hitTimer: 0,
      healTimer: 0,
      stun: 0,
      outOfCombat: 999,
      alive: true,
      respawnTimer: 0,
      spawnX: p.x,
      spawnY: p.y,
      homeX: p.x,
      homeY: p.y,
      form: 'mobile',
      formTimer: 0,
      pendingFlee: false,
      jumpPhase: 'none',
      jumpTimer: 0,
      jumpTargetId: null,
      jumpFromX: 0,
      jumpFromY: 0,
      jumpToX: 0,
      jumpToY: 0,
      skillCooldown: 0,
      tpPhase: 'none',
      tpTimer: 0,
      tpStarId: null,
      tpToX: 0,
      tpToY: 0,
      intent: null,
      targetId: null,
      damageDealt: 0,
      siegeDamage: 0,
      kills: 0,
      deaths: 0,
      respawns: 0,
      jumpCasts: 0,
      jumpHits: 0,
      deployedDeaths: 0,
      isElite: false,
      isBase: true,
    }
    this.units.push(u)
    this.byId.set(u.id, u)
    return u
  }

  private createFieldUnit(team: Team, type: FieldUnitType, x: number, y: number): Unit {
    const def = this.config.units[type]
    const u: Unit = {
      id: this.nextUnitId++,
      team,
      type,
      x,
      y,
      vx: 0,
      vy: 0,
      kvx: 0,
      kvy: 0,
      hp: def.hp,
      maxHp: def.hp,
      radius: def.radius,
      mass: def.mass,
      facing: team === 'red' ? -Math.PI / 2 : Math.PI / 2,
      cooldown: 0,
      attackAnim: 0,
      hitTimer: 0,
      healTimer: 0,
      stun: 0,
      outOfCombat: 999,
      alive: true,
      respawnTimer: 0,
      spawnX: x,
      spawnY: y,
      homeX: x,
      homeY: y,
      form: 'mobile',
      formTimer: 0,
      pendingFlee: false,
      jumpPhase: 'none',
      jumpTimer: 0,
      jumpTargetId: null,
      jumpFromX: 0,
      jumpFromY: 0,
      jumpToX: 0,
      jumpToY: 0,
      skillCooldown: 0,
      tpPhase: 'none',
      tpTimer: 0,
      tpStarId: null,
      tpToX: 0,
      tpToY: 0,
      intent: null,
      targetId: null,
      damageDealt: 0,
      siegeDamage: 0,
      kills: 0,
      deaths: 0,
      respawns: 0,
      jumpCasts: 0,
      jumpHits: 0,
      deployedDeaths: 0,
      isElite: def.elite,
      isBase: false,
    }
    this.units.push(u)
    this.byId.set(u.id, u)
    return u
  }

  // ───────────────────────────── 主循环 ─────────────────────────────

  step(): void {
    if (this.phase === 'ended') return
    const dt = this.config.physics.step
    this.time += dt

    if (this.phase === 'normal' && this.config.match.duration !== null) {
      this.remaining = Math.max(0, this.remaining - dt)
      if (this.remaining <= 0) this.startOvertime()
    } else if (this.phase === 'overtime') {
      this.overtimeElapsed += dt
    }

    this.decisionTimer -= dt
    if (this.decisionTimer <= 0) {
      this.decisionTimer += this.config.physics.decisionInterval
      if (this.decisionTimer < 0) this.decisionTimer = this.config.physics.decisionInterval
      this.runDecisions()
    }

    for (const u of this.turnOrder) {
      u.cooldown = Math.max(0, u.cooldown - dt)
      u.attackAnim = Math.max(0, u.attackAnim - dt)
      u.hitTimer = Math.max(0, u.hitTimer - dt)
      u.healTimer = Math.max(0, u.healTimer - dt)
      u.stun = Math.max(0, u.stun - dt)
      u.outOfCombat = Math.min(999, u.outOfCombat + dt)
      u.skillCooldown = Math.max(0, u.skillCooldown - dt)
      if (!u.alive && u.respawnTimer > 0) u.respawnTimer = Math.max(0, u.respawnTimer - dt)
    }

    for (const u of this.turnOrder) {
      if (!u.alive) continue
      this.updateJump(u, dt)
      this.updateTeleport(u, dt)
      this.updateCannon(u, dt)
    }

    for (const u of this.turnOrder) {
      if (!u.alive) continue
      this.tryAttack(u)
    }
    if ((this.phase as BattlePhase) === 'ended') return

    for (const u of this.turnOrder) {
      if (!u.alive) continue
      this.moveUnit(u, dt)
    }

    this.separate()

    for (const u of this.turnOrder) {
      if (u.alive) this.updateFacing(u)
    }

    this.updateProjectiles(dt)
    if ((this.phase as BattlePhase) === 'ended') return

    this.updateHealing(dt)
    this.updateRespawn()
    this.updateOvertimeBleed(dt)

    if ((this.phase as BattlePhase) !== 'ended' && this.time >= this.config.match.safetyCap) {
      this.resolveSafetyCap()
    }
  }

  /** 取出并清空事件流 */
  drainEvents(): BattleEvent[] {
    const out = this.events
    this.events = []
    return out
  }

  private emit(event: BattleEvent): void {
    if (this.events.length < 3000) this.events.push(event)
  }

  // ───────────────────────────── 决策 ─────────────────────────────

  private runDecisions(): void {
    for (const team of TEAMS) {
      const tactic = this.tactics[team]
      const snapshot = this.buildSnapshot(team)
      for (const u of this.units) {
        if (u.team === team) u.intent = null
      }
      let intents: IntentMap = {}
      try {
        intents = tactic.decide(snapshot, this.memories[team])
      } catch (err) {
        const s = this.stats[team]
        s.errors++
        s.decisions++
        this.emit({
          type: 'reject',
          team,
          reason: '策略异常',
          meta: err instanceof Error ? err.message : String(err),
        })
        continue
      }
      for (const [key, raw] of Object.entries(intents ?? {})) {
        const unit = this.byId.get(Number(key))
        if (!unit) {
          this.reject(team, 'unknown-unit', `未知单位 ${key}`)
          continue
        }
        if (unit.team !== team) {
          this.reject(team, 'not-yours', `单位 ${unit.id} 不属于本阵营`)
          continue
        }
        if (!unit.alive) {
          this.reject(team, 'dead', `单位 ${unit.id} 已阵亡`)
          continue
        }
        this.acceptIntent(unit, raw)
      }
      this.stats[team].decisions++
    }
  }

  private reject(team: Team, reason: string, detail: string): void {
    const stats = this.stats[team]
    stats.rejections++
    const key = `${reason}::${detail}`
    const map = this.rejectIndex[team]
    const entry = map.get(key)
    if (entry) {
      entry.count++
      const sample = stats.rejectSamples.find((s) => s.reason === entry.reason && s.detail === entry.detail)
      if (sample) sample.count = entry.count
    } else if (map.size < 12) {
      map.set(key, { reason, detail, count: 1 })
      stats.rejectSamples.push({ reason, detail, count: 1 })
    }
  }

  private acceptIntent(unit: Unit, intent: Intent): void {
    if (!intent || typeof intent !== 'object' || typeof (intent as Intent).type !== 'string') {
      this.reject(unit.team, 'unknown-action', '缺少意图类型')
      return
    }
    switch (intent.type) {
      case 'move': {
        if (!Number.isFinite(intent.x) || !Number.isFinite(intent.y)) {
          this.reject(unit.team, 'bad-param', 'MOVE_TO 坐标非法')
          return
        }
        if (unit.isBase || unit.type === 'elephant') {
          this.reject(unit.team, 'immobile', `${unit.type} 不可移动`)
          return
        }
        const p = clampPointToBoard(intent.x, intent.y, unit.radius)
        unit.intent = { type: 'move', x: p.x, y: p.y }
        return
      }
      case 'moveDir': {
        if (!Number.isFinite(intent.x) || !Number.isFinite(intent.y)) {
          this.reject(unit.team, 'bad-param', 'MOVE_DIR 方向非法')
          return
        }
        if (Math.hypot(intent.x, intent.y) < 1e-4) {
          this.reject(unit.team, 'bad-param', 'MOVE_DIR 方向为零')
          return
        }
        if (unit.isBase || unit.type === 'elephant') {
          this.reject(unit.team, 'immobile', `${unit.type} 不可移动`)
          return
        }
        const n = normalize(intent.x, intent.y)
        unit.intent = { type: 'moveDir', x: n.x, y: n.y }
        return
      }
      case 'attack': {
        if (!Number.isFinite(intent.targetId)) {
          this.reject(unit.team, 'missing-param', 'ATTACK_TARGET 缺少目标')
          return
        }
        const target = this.byId.get(intent.targetId)
        if (!target || !target.alive || target.team === unit.team) {
          this.reject(unit.team, 'illegal-target', `攻击目标 ${intent.targetId} 非法`)
          return
        }
        if (!this.isTargetable(target)) {
          this.reject(unit.team, 'illegal-target', `攻击目标 ${intent.targetId} 腾空中`)
          return
        }
        unit.intent = { type: 'attack', targetId: target.id }
        return
      }
      case 'deploy': {
        if (unit.type !== 'cannon') {
          this.reject(unit.team, 'form-not-allowed', '只有炮可以架起')
          return
        }
        if (unit.form !== 'mobile') {
          this.reject(unit.team, 'form-not-allowed', `炮当前形态 ${unit.form} 不能架起`)
          return
        }
        unit.intent = { type: 'deploy' }
        return
      }
      case 'undeploy': {
        if (unit.type !== 'cannon') {
          this.reject(unit.team, 'form-not-allowed', '只有炮可以收起')
          return
        }
        if (unit.form !== 'siege') {
          this.reject(unit.team, 'form-not-allowed', `炮当前形态 ${unit.form} 不能收起`)
          return
        }
        unit.intent = { type: 'undeploy' }
        return
      }
      case 'jump': {
        if (unit.type !== 'horse') {
          this.reject(unit.team, 'form-not-allowed', '只有马可以跃击')
          return
        }
        if (unit.stun > 0) {
          this.reject(unit.team, 'busy', '硬直中无法跃击')
          return
        }
        if (unit.jumpPhase !== 'none' || unit.tpPhase !== 'none') {
          this.reject(unit.team, 'busy', '正在位移技中')
          return
        }
        if (unit.skillCooldown > 0) {
          this.reject(unit.team, 'cooldown', `跃击冷却 ${unit.skillCooldown.toFixed(1)}s`)
          return
        }
        const target = this.byId.get(intent.targetId)
        if (!target || !target.alive || target.team === unit.team || !this.isTargetable(target)) {
          this.reject(unit.team, 'illegal-target', `跃击目标 ${intent.targetId} 非法`)
          return
        }
        const jump = this.config.units.horse.jump!
        const d = distance(unit, target)
        if (d < jump.minRange || d > jump.maxRange) {
          this.reject(unit.team, 'out-of-window', `跃击距离 ${d.toFixed(2)} 不在窗口内`)
          return
        }
        unit.intent = { type: 'jump', targetId: target.id }
        return
      }
      case 'teleport': {
        if (unit.type !== 'elephant') {
          this.reject(unit.team, 'form-not-allowed', '只有象可以传送')
          return
        }
        if (unit.stun > 0) {
          this.reject(unit.team, 'busy', '硬直中无法传送')
          return
        }
        if (unit.tpPhase !== 'none' || unit.jumpPhase !== 'none') {
          this.reject(unit.team, 'busy', '正在位移技中')
          return
        }
        if (unit.skillCooldown > 0) {
          this.reject(unit.team, 'cooldown', `传送冷却 ${unit.skillCooldown.toFixed(1)}s`)
          return
        }
        const star = STAR_POINTS[unit.team].find((s) => s.id === intent.starId)
        if (!star) {
          this.reject(unit.team, 'illegal-target', `未知星位 ${intent.starId}`)
          return
        }
        const current = starAt(unit.team, unit.x, unit.y)
        if (!current || !current.neighbors.includes(star.id)) {
          this.reject(unit.team, 'star-not-adjacent', `星位 ${star.id} 与当前星位不相邻`)
          return
        }
        if (this.starOccupied(star.id, unit)) {
          this.reject(unit.team, 'star-occupied', `星位 ${star.id} 已被占据`)
          return
        }
        unit.intent = { type: 'teleport', starId: star.id }
        return
      }
      case 'idle': {
        unit.intent = { type: 'idle' }
        return
      }
      default: {
        this.reject(unit.team, 'unknown-action', `未知动作 ${(intent as { type: string }).type}`)
      }
    }
  }

  // ───────────────────────────── 单位机制 ─────────────────────────────

  private defOf(u: Unit): UnitDef {
    if (u.type === 'base') throw new Error('基地没有单位数值')
    return this.config.units[u.type]
  }

  private isTargetable(u: Unit): boolean {
    return u.alive && !(u.type === 'horse' && u.jumpPhase === 'dash')
  }

  private starOccupied(starId: string, self: Unit): boolean {
    const star = STAR_POINTS[self.team].find((s) => s.id === starId)
    if (!star) return false
    for (const u of this.units) {
      if (!u.alive || u.id === self.id || u.type !== 'elephant') continue
      if (Math.hypot(u.x - star.x, u.y - star.y) < 0.25) return true
      if (u.tpPhase === 'windup' && u.tpStarId === starId) return true
    }
    return false
  }

  private updateJump(u: Unit, dt: number): void {
    if (u.jumpPhase === 'none' && u.tpPhase === 'none' && u.intent?.type === 'jump') {
      if (!Number.isFinite(u.intent.targetId)) {
        this.reject(u.team, 'missing-param', '跃击缺少目标')
        return
      }
    }
    if (u.type !== 'horse') return
    const jump = this.config.units.horse.jump!
    if (u.jumpPhase === 'none') {
      if (u.stun > 0 || u.skillCooldown > 0) return
      if (u.intent?.type !== 'jump') return
      const target = this.byId.get(u.intent.targetId)
      if (!target || !target.alive || !this.isTargetable(target)) return
      const d = distance(u, target)
      if (d < jump.minRange || d > jump.maxRange) return
      u.jumpPhase = 'windup'
      u.jumpTimer = jump.windup
      u.jumpTargetId = target.id
      u.jumpToX = target.x
      u.jumpToY = target.y
      u.skillCooldown = jump.cooldown
      u.vx = 0
      u.vy = 0
      this.emit({ type: 'jump', phase: 'windup', unitId: u.id, team: u.team, x: u.x, y: u.y })
      return
    }
    if (u.jumpPhase === 'windup') {
      if (u.stun > 0) {
        u.jumpPhase = 'none'
        u.skillCooldown = Math.max(u.skillCooldown, 2)
        return
      }
      u.jumpTimer -= dt
      if (u.jumpTimer > 0) return
      const target = u.jumpTargetId !== null ? this.byId.get(u.jumpTargetId) : undefined
      if (target && target.alive) {
        u.jumpToX = target.x
        u.jumpToY = target.y
      }
      const p = clampPointToBoard(u.jumpToX, u.jumpToY, u.radius)
      u.jumpToX = p.x
      u.jumpToY = p.y
      u.jumpFromX = u.x
      u.jumpFromY = u.y
      u.jumpPhase = 'dash'
      u.jumpTimer = jump.dash
      u.jumpCasts++
      this.stats[u.team].byType.horse.jumpCasts++
      this.emit({
        type: 'jump',
        phase: 'dash',
        unitId: u.id,
        team: u.team,
        x: u.jumpFromX,
        y: u.jumpFromY,
        tx: u.jumpToX,
        ty: u.jumpToY,
      })
      return
    }
    if (u.jumpPhase === 'dash') {
      u.jumpTimer -= dt
      const t = clamp(1 - u.jumpTimer / jump.dash, 0, 1)
      u.x = u.jumpFromX + (u.jumpToX - u.jumpFromX) * t
      u.y = u.jumpFromY + (u.jumpToY - u.jumpFromY) * t
      if (u.jumpTimer > 0) return
      u.x = u.jumpToX
      u.y = u.jumpToY
      u.jumpPhase = 'recover'
      u.jumpTimer = jump.recover
      let hits = 0
      for (const e of this.units) {
        if (!e.alive || e.team === u.team || e.isBase) continue
        if (distance(e, u) <= jump.radius + e.radius) {
          hits++
          this.hurt(e, jump.damage, u)
          e.stun = Math.max(e.stun, jump.stun)
          this.knock(e, u, 2.6)
        }
      }
      if (this.baseInRadius(u.team, u, jump.radius)) {
        const enemyBase = this.baseUnits[other(u.team)]
        if (distance(enemyBase, u) <= jump.radius + enemyBase.radius) {
          this.hurt(enemyBase, jump.damage, u)
        }
      }
      if (hits > 0) {
        u.jumpHits++
        this.stats[u.team].byType.horse.jumpHits++
      }
      this.emit({ type: 'jump', phase: 'land', unitId: u.id, team: u.team, x: u.x, y: u.y })
      return
    }
    if (u.jumpPhase === 'recover') {
      u.jumpTimer -= dt
      if (u.jumpTimer <= 0) u.jumpPhase = 'none'
    }
  }

  private baseInRadius(team: Team, u: Unit, radius: number): boolean {
    const enemyBase = this.baseUnits[other(team)]
    return enemyBase.alive && distance(enemyBase, u) <= radius + enemyBase.radius
  }

  private updateTeleport(u: Unit, dt: number): void {
    if (u.type !== 'elephant') return
    const def = this.config.units.elephant.teleport!
    if (u.tpPhase === 'none') {
      if (u.stun > 0 || u.skillCooldown > 0) return
      if (u.intent?.type !== 'teleport') return
      const starId = u.intent.starId
      const star = STAR_POINTS[u.team].find((s) => s.id === starId)
      if (!star) return
      const current = starAt(u.team, u.x, u.y)
      if (!current || !current.neighbors.includes(star.id) || this.starOccupied(star.id, u)) return
      u.tpPhase = 'windup'
      u.tpTimer = def.windup
      u.tpStarId = star.id
      u.tpToX = star.x
      u.tpToY = star.y
      u.skillCooldown = def.cooldown
      this.emit({ type: 'teleport', phase: 'windup', unitId: u.id, team: u.team, x: u.x, y: u.y })
      return
    }
    if (u.stun > 0) {
      u.tpPhase = 'none'
      u.tpStarId = null
      u.skillCooldown = Math.max(u.skillCooldown, 2)
      return
    }
    u.tpTimer -= dt
    if (u.tpTimer > 0) return
    u.x = u.tpToX
    u.y = u.tpToY
    u.tpPhase = 'none'
    u.tpStarId = null
    u.vx = 0
    u.vy = 0
    for (const e of this.units) {
      if (!e.alive || e.team === u.team || e.isBase) continue
      if (distance(e, u) <= def.radius + e.radius) {
        this.hurt(e, def.damage, u)
        e.stun = Math.max(e.stun, def.stun)
        this.knock(e, u, 2.8)
      }
    }
    const enemyBase = this.baseUnits[other(u.team)]
    if (enemyBase.alive && distance(enemyBase, u) <= def.radius + enemyBase.radius) {
      this.hurt(enemyBase, def.damage, u)
    }
    this.emit({ type: 'teleport', phase: 'land', unitId: u.id, team: u.team, x: u.x, y: u.y })
  }

  private updateCannon(u: Unit, dt: number): void {
    if (u.type !== 'cannon' || !u.alive) return
    const deploy = this.config.units.cannon.deploy!
    const nearest = this.nearestEnemy(u)
    const tooClose = nearest ? distance(u, nearest) < deploy.minRange * 0.95 : false

    switch (u.form) {
      case 'mobile': {
        if (u.stun > 0) return
        if (u.intent?.type === 'deploy') {
          u.form = 'deploying'
          u.formTimer = deploy.deployTime
          u.vx = 0
          u.vy = 0
          this.emit({ type: 'deploy', phase: 'start', unitId: u.id, team: u.team, x: u.x, y: u.y })
        }
        return
      }
      case 'deploying': {
        u.formTimer -= dt
        if (tooClose) {
          u.form = 'packing'
          u.formTimer = deploy.packTime * 0.7
          u.pendingFlee = true
          this.emit({ type: 'flee', unitId: u.id, team: u.team, x: u.x, y: u.y })
          return
        }
        if (u.formTimer <= 0) {
          u.form = 'siege'
          this.emit({ type: 'deploy', phase: 'done', unitId: u.id, team: u.team, x: u.x, y: u.y })
        }
        return
      }
      case 'siege': {
        if (u.stun > 0 && !tooClose) return
        const wantsMove =
          u.intent?.type === 'move' ||
          u.intent?.type === 'moveDir' ||
          u.intent?.type === 'undeploy'
        if (wantsMove || tooClose) {
          u.form = 'packing'
          u.formTimer = deploy.packTime
          u.pendingFlee = tooClose
          this.emit({ type: 'pack', unitId: u.id, team: u.team, x: u.x, y: u.y })
        }
        return
      }
      case 'packing': {
        u.formTimer -= dt
        if (u.formTimer <= 0) {
          if (u.pendingFlee) {
            u.form = 'fleeing'
            u.formTimer = deploy.fleeTime
            u.pendingFlee = false
            this.emit({ type: 'flee', unitId: u.id, team: u.team, x: u.x, y: u.y })
          } else {
            u.form = 'mobile'
          }
        }
        return
      }
      case 'fleeing': {
        u.formTimer -= dt
        if (u.formTimer <= 0) u.form = 'mobile'
        return
      }
    }
  }

  private tryAttack(u: Unit): void {
    if (!u.alive || u.stun > 0 || u.cooldown > 0) return
    if (u.jumpPhase !== 'none' || u.tpPhase === 'windup') return
    if (u.type === 'cannon' && u.form !== 'siege') return
    if (u.type === 'base') {
      const target = this.pickBaseTarget(u)
      if (!target) return
      this.fireProjectile(u, target, 'bolt', this.config.base.turret.projectileSpeed, this.config.base.turret.damage, 0)
      u.cooldown = this.config.base.turret.cooldown
      u.facing = Math.atan2(target.y - u.y, target.x - u.x)
      u.attackAnim = 0.26
      return
    }
    const target = this.pickTarget(u)
    if (!target) return
    const def = this.defOf(u)
    u.facing = Math.atan2(target.y - u.y, target.x - u.x)
    u.targetId = target.id
    u.cooldown = def.cooldown
    u.attackAnim = 0.3
    u.outOfCombat = 0

    if (u.type === 'cannon') {
      const proj = def.projectile!
      this.fireProjectile(u, target, 'shell', proj.speed, def.damage, proj.splash)
      this.emit({
        type: 'shoot',
        unitId: u.id,
        team: u.team,
        unitType: u.type,
        x: u.x,
        y: u.y,
        tx: target.x,
        ty: target.y,
      })
      return
    }

    if (u.type === 'rook' && def.cleave) {
      this.hurt(target, def.damage, u)
      this.knock(target, u, def.knockback)
      for (const e of this.units) {
        if (!e.alive || e.team === u.team || e.isBase || e.id === target.id) continue
        if (distance(e, target) <= def.cleave.radius + e.radius) {
          this.hurt(e, def.damage * def.cleave.factor, u)
          this.knock(e, u, def.knockback * 0.7)
        }
      }
      this.emit({
        type: 'attack',
        unitId: u.id,
        targetId: target.id,
        team: u.team,
        unitType: u.type,
        x: u.x,
        y: u.y,
        tx: target.x,
        ty: target.y,
        meta: 'cleave',
      })
      return
    }

    if (u.type === 'advisor' && def.cone) {
      const half = def.cone.angle / 2
      const hits: Unit[] = []
      for (const e of this.units) {
        if (!e.alive || e.team === u.team) continue
        const d = distance(u, e)
        if (d > def.range + e.radius) continue
        const ang = Math.atan2(e.y - u.y, e.x - u.x)
        if (Math.abs(angleDelta(ang, u.facing)) > half) continue
        const falloff = 1 - (1 - def.cone.minFactor) * clamp(d / def.range, 0, 1)
        this.hurt(e, def.damage * falloff, u)
        this.knock(e, u, def.knockback)
        hits.push(e)
      }
      this.emit({
        type: 'attack',
        unitId: u.id,
        targetId: target.id,
        team: u.team,
        unitType: u.type,
        x: u.x,
        y: u.y,
        tx: target.x,
        ty: target.y,
        meta: `cone:${def.cone.angle}`,
        amount: hits.length,
      })
      return
    }

    this.hurt(target, def.damage, u)
    this.knock(target, u, def.knockback)
    if (def.stun > 0) target.stun = Math.max(target.stun, def.stun)
    this.emit({
      type: 'attack',
      unitId: u.id,
      targetId: target.id,
      team: u.team,
      unitType: u.type,
      x: u.x,
      y: u.y,
      tx: target.x,
      ty: target.y,
      meta: def.stun > 0 ? 'stun' : undefined,
    })
  }

  private pickTarget(u: Unit): Unit | null {
    const def = u.type === 'base' ? null : this.defOf(u)
    let desired: Unit | undefined
    if (u.intent?.type === 'attack') desired = this.byId.get(u.intent.targetId)
    if (desired && this.inAttackRange(u, desired)) return desired
    let best: Unit | null = null
    let bestD = Infinity
    for (const e of this.units) {
      if (!e.alive || e.team === u.team || !this.isTargetable(e)) continue
      const d = distance(u, e)
      if (!this.inAttackRange(u, e)) continue
      if (d < bestD) {
        bestD = d
        best = e
      }
    }
    return best
  }

  private pickBaseTarget(u: Unit): Unit | null {
    const range = this.config.base.turret.range
    let desired: Unit | undefined
    if (u.intent?.type === 'attack') desired = this.byId.get(u.intent.targetId)
    if (desired && desired.alive && desired.team !== u.team && this.isTargetable(desired)) {
      if (distance(u, desired) <= range + desired.radius) return desired
    }
    let best: Unit | null = null
    let bestScore = -Infinity
    for (const e of this.units) {
      if (!e.alive || e.team === u.team || e.isBase || !this.isTargetable(e)) continue
      const d = distance(u, e)
      if (d > range + e.radius) continue
      const score = 10 - d + (e.type === 'cannon' ? 3 : 0) + (e.hp / e.maxHp < 0.35 ? 2 : 0)
      if (score > bestScore) {
        bestScore = score
        best = e
      }
    }
    return best
  }

  private inAttackRange(u: Unit, e: Unit): boolean {
    if (u.type === 'base') {
      return distance(u, e) <= this.config.base.turret.range + e.radius
    }
    const def = this.defOf(u)
    const d = distance(u, e)
    if (u.type === 'cannon') {
      return d >= def.deploy!.minRange && d <= def.range + e.radius
    }
    return d <= def.range + e.radius
  }

  private fireProjectile(
    u: Unit,
    target: Unit,
    kind: 'shell' | 'bolt',
    speed: number,
    damage: number,
    splash: number,
  ): void {
    this.projectiles.push({
      id: this.nextProjectileId++,
      ownerId: u.id,
      team: u.team,
      kind,
      x: u.x,
      y: u.y,
      targetX: target.x,
      targetY: target.y,
      targetId: target.id,
      speed,
      damage,
      splashRadius: splash,
      startX: u.x,
      startY: u.y,
      alive: true,
    })
  }

  private hurt(target: Unit, amount: number, source: Unit): void {
    if (!target.alive || this.phase === 'ended' || amount <= 0) return
    let mult = 1
    if (target.isBase && !source.isBase) mult *= this.config.combat.siegeMultiplier
    if (target.type === 'cannon' && (target.form === 'deploying' || target.form === 'siege' || target.form === 'packing')) {
      mult *= this.config.combat.cannonVulnerable
    }
    if (target.type === 'elephant' && target.tpPhase === 'windup') {
      mult *= this.config.combat.elephantVulnerable
    }
    const variance = 0.9 + this.rng.next() * 0.2
    const final = amount * mult * variance
    target.hp -= final
    target.hitTimer = 0.22
    target.outOfCombat = 0
    source.outOfCombat = 0
    source.damageDealt += final
    const teamStats = this.stats[source.team]
    teamStats.damage += final
    teamStats.byType[source.type].damage += final
    if (target.isBase) {
      source.siegeDamage += final
      teamStats.siege += final
      teamStats.byType[source.type].siege += final
      this.emit({
        type: 'base-hit',
        team: target.team,
        unitId: source.id,
        unitType: source.type,
        x: target.x,
        y: target.y,
        amount: final,
      })
    }
    const lethal = target.hp <= 0
    this.emit({
      type: 'hit',
      unitId: target.id,
      targetId: source.id,
      team: target.team,
      unitType: target.type,
      x: target.x,
      y: target.y,
      amount: final,
      lethal,
      meta: target.isBase ? 'base' : undefined,
    })
    if (lethal) this.killUnit(target, source)
  }

  private knock(target: Unit, source: Unit, force: number): void {
    if (target.isBase || target.type === 'elephant') return
    const dx = target.x - source.x
    const dy = target.y - source.y
    const n = normalize(dx, dy)
    const impulse = (force * 2) / Math.max(0.6, target.mass)
    target.kvx += n.x * impulse
    target.kvy += n.y * impulse
  }

  private killUnit(target: Unit, source: Unit): void {
    if (!target.alive) return
    target.alive = false
    target.hp = 0
    target.vx = 0
    target.vy = 0
    target.kvx = 0
    target.kvy = 0
    target.stun = 0
    target.intent = null
    target.jumpPhase = 'none'
    target.tpPhase = 'none'
    target.targetId = null
    target.deaths++
    this.stats[target.team].deaths++
    this.stats[target.team].byType[target.type].deaths++
    if (target.type === 'cannon' && (target.form === 'siege' || target.form === 'deploying' || target.form === 'packing')) {
      target.deployedDeaths++
      this.stats[target.team].byType.cannon.deployedDeaths++
    }
    target.form = 'mobile'
    source.kills++
    this.stats[source.team].kills++
    this.stats[source.team].byType[source.type].kills++
    this.emit({
      type: 'death',
      unitId: target.id,
      team: target.team,
      unitType: target.type,
      x: target.x,
      y: target.y,
      meta: source.type,
    })
    if (target.isBase) {
      this.endGame(other(target.team), 'base-destroyed')
      return
    }
    if (target.isElite) {
      target.respawnTimer = -1
    } else {
      const def = target.type === 'base' ? null : this.defOf(target)
      const baseTime = def?.respawn ?? 0
      target.respawnTimer =
        this.phase === 'overtime' ? baseTime * this.config.match.overtimeRespawnScale : baseTime
    }
  }

  // ───────────────────────────── 移动 ─────────────────────────────

  private moveUnit(u: Unit, dt: number): void {
    if (u.isBase || u.type === 'elephant') {
      u.vx = 0
      u.vy = 0
      return
    }
    if ((u.type === 'horse' && u.jumpPhase !== 'none') || u.tpPhase === 'windup') {
      u.vx = 0
      u.vy = 0
      u.kvx = 0
      u.kvy = 0
      return
    }
    const desired = this.desiredVelocity(u)
    const maxDelta = this.config.physics.acceleration * dt
    u.vx = approach(u.vx, desired.x, maxDelta)
    u.vy = approach(u.vy, desired.y, maxDelta)
    u.x += (u.vx + u.kvx) * dt
    u.y += (u.vy + u.kvy) * dt
    const decay = Math.exp(-this.config.physics.knockbackDecay * dt)
    u.kvx *= decay
    u.kvy *= decay
    this.clampUnit(u)
  }

  private desiredVelocity(u: Unit): { x: number; y: number } {
    if (!u.alive || u.stun > 0 || u.jumpPhase !== 'none' || u.tpPhase !== 'none') {
      return { x: 0, y: 0 }
    }
    if (u.isBase || u.type === 'elephant') return { x: 0, y: 0 }
    if (u.type === 'cannon') {
      const deploy = this.config.units.cannon.deploy!
      if (u.form === 'deploying' || u.form === 'siege' || u.form === 'packing') {
        return { x: 0, y: 0 }
      }
      if (u.form === 'fleeing') {
        const threat = this.nearestEnemy(u)
        let dx = 0
        let dy = 0
        if (threat) {
          const n = normalize(u.x - threat.x, u.y - threat.y)
          dx = n.x
          dy = n.y
        }
        const home = normalize(u.homeX - u.x, u.homeY - u.y)
        dx += home.x * 0.55
        dy += home.y * 0.55
        const n = normalize(dx, dy)
        return { x: n.x * deploy.fleeSpeed, y: n.y * deploy.fleeSpeed }
      }
    }
    const intent = u.intent
    if (!intent || intent.type === 'idle') return { x: 0, y: 0 }

    let speed = this.defOf(u).speed
    if (u.cooldown > 0) speed *= this.config.physics.combatSlow

    if (intent.type === 'move') {
      const dx = intent.x - u.x
      const dy = intent.y - u.y
      const d = Math.hypot(dx, dy)
      if (d < 0.06) return { x: 0, y: 0 }
      const arrive = clamp(d / 0.75, 0.22, 1)
      const n = normalize(dx, dy)
      return { x: n.x * speed * arrive, y: n.y * speed * arrive }
    }
    if (intent.type === 'moveDir') {
      return { x: intent.x * speed, y: intent.y * speed }
    }
    if (intent.type === 'attack') {
      const target = this.byId.get(intent.targetId)
      if (!target || !target.alive) return { x: 0, y: 0 }
      const d = distance(u, target)
      let stop = this.defOf(u).range + target.radius - 0.03
      if (u.type === 'cannon') {
        stop = this.config.units.cannon.range * 0.82 + target.radius
      }
      if (d <= stop) return { x: 0, y: 0 }
      const n = normalize(target.x - u.x, target.y - u.y)
      return { x: n.x * speed, y: n.y * speed }
    }
    return { x: 0, y: 0 }
  }

  private updateFacing(u: Unit): void {
    if (u.vx * u.vx + u.vy * u.vy > 0.004) {
      u.facing = Math.atan2(u.vy, u.vx)
      return
    }
    const target = u.targetId !== null ? this.byId.get(u.targetId) : undefined
    if (target && target.alive) {
      u.facing = Math.atan2(target.y - u.y, target.x - u.x)
    }
  }

  private clampUnit(u: Unit): void {
    if (u.type === 'advisor') {
      const p = clampPointToPalace(u.team, u.x, u.y, u.radius)
      u.x = p.x
      u.y = p.y
      return
    }
    const p = clampPointToBoard(u.x, u.y, u.radius)
    u.x = p.x
    u.y = p.y
  }

  private separate(): void {
    const sep = this.config.physics.separation
    for (let i = 0; i < this.turnOrder.length; i++) {
      const a = this.turnOrder[i]
      if (!a.alive) continue
      for (let j = i + 1; j < this.turnOrder.length; j++) {
        const b = this.turnOrder[j]
        if (!b.alive) continue
        const min = a.radius + b.radius
        let dx = b.x - a.x
        let dy = b.y - a.y
        let d2 = dx * dx + dy * dy
        if (d2 >= min * min) continue
        if (d2 < 1e-8) {
          const idb = (a.id * 13 + b.id * 7) % 17
          dx = Math.cos(idb) * 0.01
          dy = Math.sin(idb) * 0.01
          d2 = dx * dx + dy * dy
        }
        const d = Math.sqrt(d2)
        const overlap = min - d
        const nx = dx / d
        const ny = dy / d
        const aMov = !a.isBase && a.type !== 'elephant'
        const bMov = !b.isBase && b.type !== 'elephant'
        if (aMov && bMov) {
          const invA = 1 / a.mass
          const invB = 1 / b.mass
          const sum = invA + invB
          a.x -= nx * overlap * (invA / sum) * sep
          a.y -= ny * overlap * (invA / sum) * sep
          b.x += nx * overlap * (invB / sum) * sep
          b.y += ny * overlap * (invB / sum) * sep
        } else if (aMov) {
          a.x -= nx * overlap * sep
          a.y -= ny * overlap * sep
        } else if (bMov) {
          b.x += nx * overlap * sep
          b.y += ny * overlap * sep
        }
      }
    }
    for (const base of [this.baseUnits.red, this.baseUnits.black]) {
      if (!base.alive) continue
      for (const u of this.units) {
        if (u.isBase || !u.alive || u.type === 'elephant') continue
        let dx = u.x - base.x
        let dy = u.y - base.y
        let d = Math.hypot(dx, dy)
        const min = u.radius + base.radius
        if (d >= min) continue
        if (d < 1e-6) {
          dx = 0
          dy = 1
          d = 1
        }
        u.x = base.x + (dx / d) * min
        u.y = base.y + (dy / d) * min
      }
    }
    for (const u of this.units) {
      if (u.alive && !u.isBase && u.type !== 'elephant') this.clampUnit(u)
    }
  }

  private nearestEnemy(u: Unit): Unit | null {
    let best: Unit | null = null
    let bestD = Infinity
    for (const e of this.units) {
      if (!e.alive || e.team === u.team || !this.isTargetable(e)) continue
      const d = distance(u, e)
      if (d < bestD) {
        bestD = d
        best = e
      }
    }
    return best
  }

  // ───────────────────────────── 弹体 · 回血 · 复活 ─────────────────────────────

  private updateProjectiles(dt: number): void {
    for (const p of this.projectiles) {
      if (!p.alive) continue
      const target = p.targetId !== null ? this.byId.get(p.targetId) : undefined
      if (target && target.alive) {
        p.targetX = target.x
        p.targetY = target.y
      }
      const dx = p.targetX - p.x
      const dy = p.targetY - p.y
      const d = Math.hypot(dx, dy)
      const step = p.speed * dt
      if (d <= step + 0.02) {
        p.x = p.targetX
        p.y = p.targetY
        p.alive = false
        this.impact(p)
      } else {
        p.x += (dx / d) * step
        p.y += (dy / d) * step
      }
    }
    if (this.projectiles.length > 0) {
      for (let i = this.projectiles.length - 1; i >= 0; i--) {
        if (!this.projectiles[i].alive) this.projectiles.splice(i, 1)
      }
    }
  }

  private impact(p: Projectile): void {
    const owner = this.byId.get(p.ownerId)
    if (!owner) return
    this.emit({
      type: 'impact',
      team: p.team,
      x: p.x,
      y: p.y,
      meta: p.kind,
      unitType: p.kind === 'shell' ? 'cannon' : 'base',
    })
    if (p.kind === 'shell') {
      for (const e of this.units) {
        if (!e.alive || e.team === p.team) continue
        const d = distance({ x: p.x, y: p.y }, e)
        if (d > p.splashRadius + e.radius) continue
        const falloff = 1 - 0.45 * clamp(d / p.splashRadius, 0, 1)
        this.hurt(e, p.damage * falloff, owner)
        this.knock(e, owner, 1.6)
      }
      return
    }
    const target = p.targetId !== null ? this.byId.get(p.targetId) : undefined
    if (target && target.alive) {
      this.hurt(target, p.damage, owner)
    }
  }

  private updateHealing(dt: number): void {
    for (const u of this.turnOrder) {
      if (!u.alive || u.isBase) continue
      if (u.hp >= u.maxHp) continue
      let rate = 0
      if (u.isElite) {
        const def = this.defOf(u)
        if (def.regen && u.outOfCombat > def.regen.delay) rate = def.regen.rate
      } else if (
        u.outOfCombat > this.config.combat.healDelay &&
        distance(u, { x: u.homeX, y: u.homeY }) <= this.config.combat.healRadius
      ) {
        rate = this.config.combat.healRate
      }
      if (rate <= 0) continue
      const before = u.hp
      u.hp = Math.min(u.maxHp, u.hp + rate * dt)
      if (u.hp > before && u.healTimer <= 0) {
        u.healTimer = 0.7
        this.emit({ type: 'heal', unitId: u.id, team: u.team, x: u.x, y: u.y, amount: u.hp - before })
      }
    }
  }

  private updateRespawn(): void {
    for (const u of this.turnOrder) {
      if (u.alive || u.isBase) continue
      if (u.respawnTimer > 0) continue
      if (u.respawnTimer === 0) {
        if (u.isElite) continue
        this.respawn(u)
      }
    }
  }

  private respawn(u: Unit): void {
    u.alive = true
    u.hp = u.maxHp
    u.x = u.homeX + (u.type === 'elephant' ? 0 : (this.rng.next() - 0.5) * 0.16)
    u.y = u.homeY + (u.type === 'elephant' ? 0 : (this.rng.next() - 0.5) * 0.16)
    u.vx = 0
    u.vy = 0
    u.kvx = 0
    u.kvy = 0
    u.stun = 0
    u.outOfCombat = 0
    u.cooldown = 0
    u.attackAnim = 0
    u.hitTimer = 0
    u.form = 'mobile'
    u.formTimer = 0
    u.pendingFlee = false
    u.jumpPhase = 'none'
    u.tpPhase = 'none'
    u.targetId = null
    u.intent = null
    u.respawnTimer = 0
    u.respawns++
    this.stats[u.team].byType[u.type].respawns++
    this.emit({ type: 'respawn', unitId: u.id, team: u.team, unitType: u.type, x: u.x, y: u.y })
  }

  // ───────────────────────────── 加时 · 胜负 ─────────────────────────────

  private startOvertime(): void {
    if (this.phase !== 'normal') return
    this.phase = 'overtime'
    this.remaining = 0
    this.overtimeElapsed = 0
    this.emit({ type: 'overtime', x: BOARD_W / 2, y: RIVER_Y })
    for (const u of this.units) {
      if (u.alive || u.isBase) continue
      if (u.isElite) {
        this.respawn(u)
      } else if (u.respawnTimer > 0) {
        u.respawnTimer *= this.config.match.overtimeRespawnScale
      }
    }
  }

  private updateOvertimeBleed(dt: number): void {
    if (this.phase !== 'overtime') return
    const dmg = this.config.match.overtimeBleed * dt
    const red = this.baseUnits.red
    const black = this.baseUnits.black
    const preRed = red.hp
    const preBlack = black.hp
    red.hp -= dmg
    black.hp -= dmg
    this.bleedEventTimer -= dt
    if (this.bleedEventTimer <= 0) {
      this.bleedEventTimer = 0.6
      this.emit({ type: 'base-hit', team: 'red', x: red.x, y: red.y, amount: dmg * 0.6, meta: 'bleed' })
      this.emit({ type: 'base-hit', team: 'black', x: black.x, y: black.y, amount: dmg * 0.6, meta: 'bleed' })
    }
    if (red.hp <= 0 && black.hp <= 0) {
      const winner = this.bleedTiebreak(preRed, preBlack)
      red.hp = 0
      black.hp = 0
      red.alive = false
      black.alive = false
      this.endGame(winner, 'overtime-bleed')
      return
    }
    if (red.hp <= 0) {
      red.hp = 0
      red.alive = false
      this.endGame('black', 'overtime-bleed')
      return
    }
    if (black.hp <= 0) {
      black.hp = 0
      black.alive = false
      this.endGame('red', 'overtime-bleed')
    }
  }

  private bleedTiebreak(preRed: number, preBlack: number): Team {
    if (preRed !== preBlack) return preRed > preBlack ? 'red' : 'black'
    const sr = this.armyScore('red')
    const sb = this.armyScore('black')
    if (sr !== sb) return sr > sb ? 'red' : 'black'
    return this.rng.next() < 0.5 ? 'red' : 'black'
  }

  private armyScore(team: Team): number {
    let score = 0
    for (const u of this.units) {
      if (u.team !== team || !u.alive || u.isBase) continue
      score += u.hp + (u.maxHp * 0.4)
    }
    return score
  }

  private resolveSafetyCap(): void {
    const red = this.baseUnits.red
    const black = this.baseUnits.black
    let winner: Team
    if (red.hp !== black.hp) {
      winner = red.hp > black.hp ? 'red' : 'black'
    } else {
      const sr = this.armyScore('red')
      const sb = this.armyScore('black')
      if (sr !== sb) winner = sr > sb ? 'red' : 'black'
      else winner = this.rng.next() < 0.5 ? 'red' : 'black'
    }
    const loser = this.baseUnits[other(winner)]
    loser.hp = 0
    loser.alive = false
    this.endGame(winner, 'safety-cap')
  }

  private endGame(winner: Team, reason: EndReason): void {
    if (this.phase === 'ended') return
    this.phase = 'ended'
    this.winner = winner
    this.reason = reason
    this.emit({ type: 'end', winner, reason, x: BOARD_W / 2, y: RIVER_Y })
  }

  // ───────────────────────────── 快照与结算 ─────────────────────────────

  private viewOf(u: Unit): UnitView {
    const def = u.type === 'base' ? null : this.config.units[u.type]
    let cdMax = 0
    if (u.type === 'horse') cdMax = this.config.units.horse.jump?.cooldown ?? 0
    if (u.type === 'elephant') cdMax = this.config.units.elephant.teleport?.cooldown ?? 0
    return {
      id: u.id,
      team: u.team,
      type: u.type,
      x: u.x,
      y: u.y,
      hp: u.hp,
      maxHp: u.maxHp,
      radius: u.radius,
      mass: u.mass,
      speed: def?.speed ?? 0,
      attackRange: def?.range ?? this.config.base.turret.range,
      attackDamage: def?.damage ?? this.config.base.turret.damage,
      attackCooldown: u.cooldown,
      attackInterval: def?.cooldown ?? this.config.base.turret.cooldown,
      form: u.form,
      jumpPhase: u.jumpPhase,
      teleportPhase: u.tpPhase,
      stun: u.stun,
      alive: u.alive,
      respawnIn: u.alive ? 0 : u.respawnTimer > 0 ? u.respawnTimer : -1,
      outOfCombat: u.outOfCombat,
      skillReady: cdMax > 0 && u.skillCooldown <= 0 && u.alive,
      skillCooldown: u.skillCooldown,
      skillCooldownMax: cdMax,
      isElite: u.isElite,
      isBase: u.isBase,
      targetable: this.isTargetable(u),
      facing: u.facing,
      targetId: u.targetId,
      homeX: u.homeX,
      homeY: u.homeY,
    }
  }

  buildSnapshot(team: Team): Snapshot {
    const enemy = other(team)
    const allies: UnitView[] = []
    const enemies: UnitView[] = []
    for (const u of this.units) {
      if (u.team === team) {
        if (!u.isBase) allies.push(this.viewOf(u))
      } else if (u.alive && !u.isBase) {
        enemies.push(this.viewOf(u))
      }
    }
    const teleRadius = this.config.units.elephant.teleport?.radius ?? 1.5
    const stars: StarView[] = STAR_POINTS[team].map((s) => {
      let occupiedBy: number | null = null
      for (const u of this.units) {
        if (!u.alive || u.type !== 'elephant' || u.team !== team) continue
        if (Math.hypot(u.x - s.x, u.y - s.y) < 0.25) occupiedBy = u.id
      }
      let nearbyEnemies = 0
      for (const e of this.units) {
        if (!e.alive || e.team === team) continue
        if (Math.hypot(e.x - s.x, e.y - s.y) <= teleRadius) nearbyEnemies++
      }
      return {
        id: s.id,
        x: s.x,
        y: s.y,
        neighbors: [...s.neighbors],
        occupiedBy,
        nearbyEnemies,
      }
    })
    return {
      time: this.time,
      phase: this.phase,
      duration: this.config.match.duration,
      remaining: this.remaining,
      overtimeElapsed: this.overtimeElapsed,
      team,
      enemyTeam: enemy,
      board: {
        width: this.config.board.width,
        height: this.config.board.height,
        riverY: this.config.board.riverY,
      },
      palace: { ...PALACE[team] },
      myBase: this.viewOf(this.baseUnits[team]),
      enemyBase: this.viewOf(this.baseUnits[enemy]),
      allies,
      enemies,
      stars,
      rules: {
        siegeMultiplier: this.config.combat.siegeMultiplier,
        healRate: this.config.combat.healRate,
        healDelay: this.config.combat.healDelay,
        healRadius: this.config.combat.healRadius,
        eliteRegenDelay: this.config.combat.eliteRegenDelay,
        overtimeBleed: this.config.match.overtimeBleed,
        overtimeRespawnScale: this.config.match.overtimeRespawnScale,
        baseTurretRange: this.config.base.turret.range,
        baseTurretDamage: this.config.base.turret.damage,
        baseTurretCooldown: this.config.base.turret.cooldown,
        cannonMinRange: this.config.units.cannon.deploy!.minRange,
        cannonRange: this.config.units.cannon.range,
        jumpMin: this.config.units.horse.jump!.minRange,
        jumpMax: this.config.units.horse.jump!.maxRange,
        respawn: {
          rook: this.config.units.rook.respawn,
          horse: this.config.units.horse.respawn,
          cannon: this.config.units.cannon.respawn,
          pawn: this.config.units.pawn.respawn,
          advisor: this.config.units.advisor.respawn,
          elephant: this.config.units.elephant.respawn,
        },
      },
    }
  }

  getSummary(): BattleSummary {
    const redBase = this.baseUnits.red
    const blackBase = this.baseUnits.black
    let redAlive = 0
    let blackAlive = 0
    for (const u of this.units) {
      if (u.isBase || !u.alive) continue
      if (u.team === 'red') redAlive++
      else blackAlive++
      this.stats[u.team].byType[u.type].alive++
    }
    for (const team of TEAMS) {
      for (const t of ['base', 'rook', 'horse', 'cannon', 'pawn', 'advisor', 'elephant'] as UnitType[]) {
        const stat = this.stats[team].byType[t]
        if (t !== 'base') {
          stat.alive = this.units.filter((u) => u.team === team && u.type === t && u.alive).length
        }
      }
    }
    this.stats.red.byType.base.alive = redBase.alive ? 1 : 0
    this.stats.black.byType.base.alive = blackBase.alive ? 1 : 0
    return {
      winner: this.winner,
      reason: this.reason,
      duration: this.time,
      phase: this.phase,
      redBaseHp: Math.max(0, redBase.hp),
      blackBaseHp: Math.max(0, blackBase.hp),
      redBaseMax: redBase.maxHp,
      blackBaseMax: blackBase.maxHp,
      redAlive,
      blackAlive,
      seed: this.seed,
      configFingerprint: this.fingerprint,
      stats: this.stats,
    }
  }
}

function angleDelta(a: number, b: number): number {
  let d = a - b
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return d
}
