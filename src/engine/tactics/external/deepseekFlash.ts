import type { Intent, IntentMap, Snapshot, StarView, Tactic, TacticMemory, UnitView } from '../api'
import { clamp, distance, valueOf } from '../api'

/**
 * 重锋压境 —— 直取型打法。
 *
 * 骨架只有一句话：每个单位都去打“最值得打、又够得着”的目标，绝不在原地挨打。
 * 在此之上是四条明确增益：
 *  1) 开局守河：前 15 秒不越河追击，把对手的第一波放进自家炮塔与士的杀伤区；
 *  2) 集火：按价值、残血、炮优先评分，并扣掉过量击杀，先打掉最贵的那几个；
 *  3) 转换：贴到基地边且身边无敌人就直接砸基地；基地空门、残血、加时落后时全军拆家；
 *  4) 偷家：固定一辆车走边路（家里被压时自动回防），把野战优势换成基地血量。
 *
 * 炮位永远在己方锋线后 2.15 格：既不会落进自己的盲区，也不会脱离子弹伞。
 * 这一版刻意不做残血回城——实测保持前线人数比回城治疗更划算。
 */

interface Mem {
  init: boolean
  /** 上一 tick 的目标，用于稳定集火 */
  target: Record<number, number>
  /** 炮连续没有目标的起始时间 */
  drySince: Record<number, number>
  /** 象的落点预约，避免两只象抢同一个星位 */
  reserved: string[]
  /** 指定偷家的车 */
  raiderId: number
}

interface Ctx {
  snap: Snapshot
  mem: Mem
  allies: UnitView[]
  enemies: UnitView[]
  base: UnitView
  enemyBase: UnitView
  /** 红方 -1（向 y 减小方向进攻），黑方 +1 */
  sign: 1 | -1
  assigned: Map<number, number>
  /** 敌方基地处于“没人守”的状态 */
  baseOpen: boolean
  /** 加时且落后：必须换家 */
  desperate: boolean
  /** 家里已经被压进来：此时不拆家、不偷家，先回防 */
  invaded: boolean
}

/** 集火权重：价值 / 残血 / 炮的额外权重 */
const VALUE_W = 0.65
const MISSING_W = 2.2
const CANNON_W = 2.0
/** 开局守河时长 */
const OPEN_HOLD = 15
/** 偷家车的最低血量比例 */
const RAID_HP = 0.55

const CANNON_X = [2.7, 5.3]
const CANNON_STANDOFF = 2.15

const worldY = (ctx: Ctx, redY: number): number => (ctx.sign < 0 ? redY : 9 - redY)

const dpsOf = (u: UnitView): number => u.attackDamage / Math.max(0.2, u.attackInterval)

function nearestEnemy(u: { x: number; y: number }, list: UnitView[], maxD = Infinity): UnitView | null {
  let best: UnitView | null = null
  let bestD = maxD
  for (const e of list) {
    if (!e.alive || !e.targetable) continue
    const d = distance(u, e)
    if (d < bestD) {
      bestD = d
      best = e
    }
  }
  return best
}

function laneIndex(ctx: Ctx, u: UnitView): number {
  const group = ctx.allies.filter((a) => a.type === u.type).sort((a, b) => a.id - b.id)
  return Math.max(0, group.findIndex((a) => a.id === u.id))
}

/** 我方近战锋线（红方坐标） */
function frontRedY(ctx: Ctx): number {
  const melee = ctx.allies.filter((a) => a.type === 'pawn' || a.type === 'rook')
  if (melee.length === 0) return 5.2
  const ys = melee.map((a) => (ctx.sign < 0 ? a.y : 9 - a.y)).sort((a, b) => a - b)
  const k = Math.min(3, ys.length)
  return ys.slice(0, k).reduce((s, v) => s + v, 0) / k
}

function cannonSlot(ctx: Ctx, u: UnitView): { x: number; y: number } {
  const i = Math.min(laneIndex(ctx, u), 1)
  const x = CANNON_X[i]
  // 攻城时前移到河界，正好够得着对方基地
  if (ctx.enemyBase.alive && (ctx.baseOpen || ctx.desperate)) {
    const targetY = 4.45
    const far = Math.hypot(x - ctx.enemyBase.x, worldY(ctx, targetY) - ctx.enemyBase.y)
    if (far <= u.attackRange + ctx.enemyBase.radius - 0.05) return { x, y: worldY(ctx, targetY) }
  }
  const standoffY = clamp(frontRedY(ctx) + CANNON_STANDOFF, 7.0, 8.05)
  return { x, y: worldY(ctx, standoffY) }
}

// ───────────────────────────── 目标选择 ─────────────────────────────

function scoreEnemy(ctx: Ctx, u: UnitView, e: UnitView): number {
  const d = distance(u, e)
  let s = -d
  s += valueOf(e) * VALUE_W
  s += (1 - e.hp / Math.max(1, e.maxHp)) * MISSING_W
  if (e.type === 'cannon') s += CANNON_W
  if (e.type === 'elephant') s -= VALUE_W * 2.2
  // 打到我家门口的优先处理
  const db = distance(e, ctx.base)
  if (db < 5) s += (5 - db) * 0.9
  // 稳定集火：上一 tick 的目标加一点惯性
  if (ctx.mem.target[u.id] === e.id) s += 0.45
  // 过量击杀惩罚：已经有人在打、且伤害够了就换目标
  const assigned = ctx.assigned.get(e.id) ?? 0
  if (assigned > e.hp * 0.9) s -= 1.3 + (assigned - e.hp) / Math.max(1, e.hp)
  else if (assigned > 0) s += 0.5
  return s
}

function pickTarget(ctx: Ctx, u: UnitView): UnitView | null {
  let best: UnitView | null = null
  let bestScore = -Infinity
  for (const e of ctx.enemies) {
    if (!e.alive || !e.targetable) continue
    const s = scoreEnemy(ctx, u, e)
    if (s > bestScore) {
      bestScore = s
      best = e
    }
  }
  // 基地也是目标：空门、残血、加时落后时都值得直接拆
  if (ctx.enemyBase.alive && (!ctx.invaded || ctx.desperate || ctx.enemyBase.hp < 500)) {
    const d = distance(u, ctx.enemyBase)
    let s = -d + 0.4
    if (ctx.baseOpen) s += 3.2
    if (ctx.enemyBase.hp < 700) s += 2.4
    if (ctx.desperate) s += 12
    if (s > bestScore) {
      bestScore = s
      best = ctx.enemyBase
    }
  }
  if (best) ctx.mem.target[u.id] = best.id
  return best
}

/** 炮：优先打“一炮能覆盖最多价值”的落点 */
function pickCannonTarget(ctx: Ctx, u: UnitView): UnitView | null {
  const min = ctx.snap.rules.cannonMinRange
  const splash = 1.12
  let best: UnitView | null = null
  let bestScore = -Infinity
  for (const e of ctx.enemies) {
    if (!e.alive || !e.targetable) continue
    const d = distance(u, e)
    if (d < min || d > u.attackRange + e.radius) continue
    let s = 0
    for (const o of ctx.enemies) {
      if (!o.alive || !o.targetable) continue
      const dd = distance(o, e)
      if (dd > splash + o.radius) continue
      s +=
        (valueOf(o) * 0.3 + (1 - o.hp / Math.max(1, o.maxHp)) * 0.6) *
        (1 - 0.4 * clamp(dd / splash, 0, 1))
    }
    s -= d * 0.02
    if (s > bestScore) {
      bestScore = s
      best = e
    }
  }
  if (ctx.enemyBase.alive && (ctx.desperate || ctx.enemyBase.hp < 700 || (ctx.baseOpen && !ctx.invaded))) {
    const d = distance(u, ctx.enemyBase)
    if (d >= min && d <= u.attackRange + ctx.enemyBase.radius) {
      const s = 4.2 - d * 0.05 + (1 - ctx.enemyBase.hp / Math.max(1, ctx.enemyBase.maxHp)) * 2.5
      if (s > bestScore) return ctx.enemyBase
    }
  }
  return best
}

function pickJumpTarget(ctx: Ctx, u: UnitView): UnitView | null {
  const min = ctx.snap.rules.jumpMin
  const max = ctx.snap.rules.jumpMax
  let best: UnitView | null = null
  let bestScore = -Infinity
  for (const e of ctx.enemies) {
    if (!e.alive || !e.targetable) continue
    const d = distance(u, e)
    if (d < min + 0.05 || d > max - 0.05) continue
    let s = valueOf(e) * 0.45 + (1 - e.hp / Math.max(1, e.maxHp)) * 3.0
    if (e.type === 'cannon') s += 2.6
    if (e.type === 'advisor') s += 0.9
    const cluster = ctx.enemies.filter((o) => distance(o, e) < 1.5).length
    if (cluster >= 3 && u.hp / Math.max(1, u.maxHp) < 0.7) s -= 2.4
    if (distance(e, ctx.base) < 5) s += 0.8
    if (s > bestScore) {
      bestScore = s
      best = e
    }
  }
  return best
}

// ───────────────────────────── 兵种意图 ─────────────────────────────

function normalizeTo(x: number, y: number): { x: number; y: number } {
  const len = Math.hypot(x, y)
  if (len < 1e-6) return { x: 0, y: 0 }
  return { x: x / len, y: y / len }
}

function cannonIntent(ctx: Ctx, u: UnitView): Intent {
  if (u.form === 'deploying' || u.form === 'packing' || u.form === 'fleeing') return { type: 'idle' }
  const threat = nearestEnemy(u, ctx.enemies, 4)
  const threatD = threat ? distance(u, threat) : Infinity
  const slot = cannonSlot(ctx, u)
  const slotD = Math.hypot(slot.x - u.x, slot.y - u.y)

  if (u.form === 'siege') {
    if (threatD < 1.9) return { type: 'undeploy' }
    const t = pickCannonTarget(ctx, u)
    if (t) {
      ctx.mem.drySince[u.id] = ctx.snap.time
      return { type: 'attack', targetId: t.id }
    }
    const dry = ctx.mem.drySince[u.id]
    if (dry === undefined) ctx.mem.drySince[u.id] = ctx.snap.time
    else if (ctx.snap.time - dry > 2.2) {
      ctx.mem.drySince[u.id] = ctx.snap.time
      return { type: 'undeploy' }
    }
    if (slotD > 2.2) return { type: 'undeploy' }
    return { type: 'idle' }
  }

  if (threat && threatD < 1.75) {
    const away = normalizeTo(u.x - threat.x, u.y - threat.y)
    const home = normalizeTo(u.homeX - u.x, u.homeY - u.y)
    return {
      type: 'move',
      x: u.x + away.x * 2.4 + home.x * 0.9,
      y: u.y + away.y * 2.4 + home.y * 0.9,
    }
  }
  if (slotD > 0.55) return { type: 'move', x: slot.x, y: slot.y }
  const t = pickCannonTarget(ctx, u)
  if (t && threatD > 2.0) return { type: 'deploy' }
  if (t) return { type: 'attack', targetId: t.id }
  return { type: 'idle' }
}

function starScore(ctx: Ctx, u: UnitView, s: StarView): number {
  let score = s.nearbyEnemies * 0.85
  for (const e of ctx.enemies) {
    if (!e.alive || !e.targetable) continue
    const d = distance(e, s)
    if (d > 1.5 + e.radius) continue
    score += 0.9 + valueOf(e) * 0.18 + (1 - e.hp / Math.max(1, e.maxHp)) * 0.6
  }
  // 守家：基地附近有敌人就往回跳
  const nearBase = distance(s, ctx.base)
  const threats = ctx.enemies.filter((e) => distance(e, ctx.base) < 4.6).length
  if (threats > 0 && nearBase < 2.8) score += 1.8 + threats * 0.5
  // 没事干时往前压，象的肉度不用白不用
  const fwd = ctx.sign < 0 ? 9 - s.y : s.y
  score += fwd * 0.22
  if (u.hp / Math.max(1, u.maxHp) < 0.35 && nearBase > 2.4) score -= 1.0
  return score
}

function elephantIntent(ctx: Ctx, u: UnitView): Intent {
  if (u.teleportPhase === 'windup') return { type: 'idle' }
  let current: StarView | null = null
  let curD = Infinity
  for (const s of ctx.snap.stars) {
    const d = Math.hypot(s.x - u.x, s.y - u.y)
    if (d < curD) {
      curD = d
      current = s
    }
  }
  if (!current) return { type: 'idle' }
  if (u.skillReady) {
    let best: StarView | null = null
    let bestScore = starScore(ctx, u, current) + 0.55
    for (const s of ctx.snap.stars) {
      if (!current.neighbors.includes(s.id)) continue
      if (s.occupiedBy !== null && s.occupiedBy !== u.id) continue
      if (ctx.mem.reserved.includes(s.id)) continue
      const sc = starScore(ctx, u, s)
      if (sc > bestScore) {
        bestScore = sc
        best = s
      }
    }
    if (best) {
      ctx.mem.reserved.push(best.id)
      return { type: 'teleport', starId: best.id }
    }
  }
  const t = nearestEnemy(u, ctx.enemies, u.attackRange + 0.5)
  return t ? { type: 'attack', targetId: t.id } : { type: 'idle' }
}

function advisorIntent(ctx: Ctx, u: UnitView): Intent {
  const reach = ctx.snap.rules.advisorGuardRadius + u.attackRange
  let best: UnitView | null = null
  let bestScore = -Infinity
  for (const e of ctx.enemies) {
    if (!e.alive || !e.targetable) continue
    if (distance(e, ctx.base) > reach) continue
    const s = valueOf(e) + (1 - e.hp / Math.max(1, e.maxHp)) * 2.5 - distance(u, e) * 0.2
    if (s > bestScore) {
      bestScore = s
      best = e
    }
  }
  return best ? { type: 'attack', targetId: best.id } : { type: 'idle' }
}

/** 偷家：沿边路绕开正面，贴到基地边再拆 */
function raidIntent(ctx: Ctx, u: UnitView): Intent {
  const eb = ctx.enemyBase
  const threat = nearestEnemy(u, ctx.enemies, 1.5)
  if (threat) return { type: 'attack', targetId: threat.id }
  if (!eb.alive) return meleeIntent(ctx, u)
  if (distance(u, eb) <= 4.2) return { type: 'attack', targetId: eb.id }
  const laneX = u.id % 2 === 0 ? 0.75 : 7.25
  const wpY = worldY(ctx, distance(u, eb) > 6.2 ? 3.6 : 2.4)
  return { type: 'move', x: laneX, y: wpY }
}

function meleeIntent(ctx: Ctx, u: UnitView): Intent {
  const eb = ctx.enemyBase
  if (eb.alive) {
    const db = distance(u, eb)
    const nearestField = nearestEnemy(u, ctx.enemies, 3.4)
    const fieldNear = ctx.enemies.some((e) => e.targetable && distance(u, e) < 1.25)
    // 贴到基地边、身边又没有敌人：不必再找目标，直接砸基地
    if ((db <= 4.0 || (db < 5.3 && !nearestField)) && !fieldNear) {
      return { type: 'attack', targetId: eb.id }
    }
  }
  const target = pickTarget(ctx, u)
  if (!target) return { type: 'idle' }
  if (u.type === 'horse' && u.jumpPhase === 'none' && u.skillReady && u.stun <= 0) {
    const j = pickJumpTarget(ctx, u)
    if (j) return { type: 'jump', targetId: j.id }
  }
  const d = distance(u, target)
  // 开局先守河：不追过河，把对手的第一波放进自家炮塔与士的杀伤区
  if (ctx.snap.time < OPEN_HOLD) {
    const lineY = worldY(ctx, 4.6)
    const targetAcross = ctx.sign < 0 ? target.y < lineY : target.y > lineY
    const selfAcross = ctx.sign < 0 ? u.y < lineY : u.y > lineY
    if (targetAcross && !selfAcross && d > u.attackRange + target.radius + 0.4) {
      return { type: 'move', x: clamp(u.x, 1.0, 7.0), y: lineY }
    }
  }
  if (d <= u.attackRange + target.radius + 1.0) {
    ctx.assigned.set(target.id, (ctx.assigned.get(target.id) ?? 0) + dpsOf(u) * 1.1)
  }
  return { type: 'attack', targetId: target.id }
}

function baseIntent(ctx: Ctx): Intent {
  const range = ctx.snap.rules.baseTurretRange
  let best: UnitView | null = null
  let bestScore = -Infinity
  for (const e of ctx.enemies) {
    if (!e.alive || !e.targetable) continue
    const d = distance(ctx.base, e)
    if (d > range + e.radius) continue
    let s = valueOf(e) + (1 - e.hp / Math.max(1, e.maxHp)) * 3.5 - d * 0.25
    if (e.type === 'cannon') s += 4
    if (s > bestScore) {
      bestScore = s
      best = e
    }
  }
  return best ? { type: 'attack', targetId: best.id } : { type: 'idle' }
}

// ───────────────────────────── 主入口 ─────────────────────────────

function buildContext(snap: Snapshot, mem: Mem): Ctx {
  const allies = snap.allies.filter((a) => a.alive)
  const enemies = snap.enemies.filter((e) => e.alive)
  const base = snap.myBase
  const enemyBase = snap.enemyBase
  const baseOpen =
    enemyBase.alive && enemies.filter((e) => e.targetable && distance(e, enemyBase) < 4.4).length <= 2
  const desperate = snap.phase === 'overtime' && base.hp <= enemyBase.hp
  const invaded = enemies.filter((e) => distance(e, base) < 4.6).length >= 2
  return {
    snap,
    mem,
    allies,
    enemies,
    base,
    enemyBase,
    sign: snap.team === 'red' ? -1 : 1,
    assigned: new Map(),
    baseOpen,
    desperate,
    invaded,
  }
}

export const deepseekFlashTactic: Tactic = {
  id: 'deepseek-flash',
  name: '重锋压境',
  author: 'DeepSeek-Flash',
  version: '1.1.0',
  description:
    '直取型打法：每个单位都去打“最值得打、又够得着”的目标，绝不在原地挨打。前 15 秒守住河界，把对手第一波放进自家炮塔与士的杀伤区；随后按价值、残血与炮优先集火，并扣掉过量击杀。贴到敌方基地且身边无敌人时直接拆家，另有一辆车走边路偷家，家里被压时自动回防。加时领先死守、落后全军换家。炮位始终保持在锋线后两格，不进盲区也不脱离掩护。',
  accent: 'gold',
  glyph: '锋',
  createMemory: () =>
    ({
      init: false,
      target: {},
      drySince: {},
      reserved: [],
      raiderId: -1,
    }) as unknown as TacticMemory,
  decide(snap: Snapshot, memory): IntentMap {
    const mem = memory as unknown as Mem
    if (!mem.init) {
      mem.init = true
      mem.reserved = []
    }
    const ctx = buildContext(snap, mem)
    mem.reserved = []

    // 固定一辆血量最高的车负责偷家
    if (mem.raiderId < 0) {
      const rook = ctx.allies
        .filter((a) => a.type === 'rook')
        .sort((a, b) => b.hp - a.hp || a.id - b.id)[0]
      if (rook) mem.raiderId = rook.id
    }

    const intents: IntentMap = {}
    intents[ctx.base.id] = baseIntent(ctx)

    const order: Record<string, number> = {
      cannon: 0,
      rook: 1,
      horse: 2,
      pawn: 3,
      elephant: 4,
      advisor: 5,
    }
    const units = [...ctx.allies].sort(
      (a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9) || a.id - b.id,
    )
    for (const u of units) {
      if (
        u.id === mem.raiderId &&
        u.type === 'rook' &&
        u.hp / Math.max(1, u.maxHp) > RAID_HP &&
        !ctx.invaded
      ) {
        intents[u.id] = raidIntent(ctx, u)
      } else if (u.type === 'advisor') {
        intents[u.id] = advisorIntent(ctx, u)
      } else if (u.type === 'elephant') {
        intents[u.id] = elephantIntent(ctx, u)
      } else if (u.type === 'cannon') {
        intents[u.id] = cannonIntent(ctx, u)
      } else {
        intents[u.id] = meleeIntent(ctx, u)
      }
    }
    return intents
  },
}
