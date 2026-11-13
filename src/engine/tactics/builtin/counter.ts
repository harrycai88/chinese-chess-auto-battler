import type { Intent, IntentMap, Snapshot, Tactic, TacticMemory, UnitView } from '../api'
import { clamp, distance, dpsOf, normalize, valueOf } from '../api'

/**
 * 防守反击 —— 复杂策略。
 *
 * 它不是「低于 30% 血就回城」的阈值脚本，而是一套每 125ms 重算一次的战场判断：
 *  · 局势：读基地血量差、兵力差、兵线位置、入侵者数量，决定 防守 / 拉锯 / 推进 / 孤注一掷
 *  · 威胁：按每个敌人的持续输出与距离估算「还能站多久」，决定谁该退、谁该顶
 *  · 阵型：不同姿态有不同的站位线；全队向威胁方向偏移，远程保持在肉盾之后
 *  · 集火：按战术价值、残血、对基地的威胁、对己方炮位的威胁评分，并扣除过量击杀
 *  · 走位：近战从侧翼包抄而不是叠在一起；炮位横向错开形成交叉火力；被贴脸则收炮转移
 *  · 技能：马只在高价值目标且落点不算自杀时跃击；象只传送到「落地震击有收益」的星位
 *  · 加时：领先就收缩死守（双方等速流血，守住即赢），落后就全军压上换家
 */

type Stance = 'defend' | 'contest' | 'push' | 'allin'
type LineType = 'pawn' | 'rook' | 'horse' | 'cannon'

interface CounterMemory {
  stance: Stance
  candidate: Stance
  candidateSince: number
  retreat: Record<number, boolean>
  initialized: boolean
}

interface Ctx {
  snap: Snapshot
  mem: CounterMemory
  enemies: UnitView[]
  allies: UnitView[]
  base: UnitView
  enemyBase: UnitView
  stance: Stance
  forward: number
  baseThreat: number
  baseEmergency: boolean
  enemyCentroidX: number
  threatDir: { x: number; y: number }
  assigned: Map<number, number>
  retreating: Set<number>
  raiders: Set<number>
  reservedStars: Set<string>
  advantage: number
}

/** 红方基准站位线；黑方按 y = 9 - y 镜像 */
const LINE_Y: Record<Stance, Record<LineType, number>> = {
  defend: { pawn: 6.0, rook: 6.4, horse: 6.2, cannon: 6.6 },
  contest: { pawn: 5.3, rook: 5.8, horse: 5.6, cannon: 6.0 },
  push: { pawn: 3.4, rook: 2.9, horse: 3.2, cannon: 4.55 },
  allin: { pawn: 2.3, rook: 1.9, horse: 2.1, cannon: 4.3 },
}

const SPREAD: Record<LineType, number> = {
  pawn: 6.4,
  rook: 4.6,
  horse: 3.2,
  cannon: 2.4,
}

const TYPE_ORDER: Record<string, number> = {
  cannon: 0,
  rook: 1,
  horse: 2,
  pawn: 3,
  elephant: 4,
  advisor: 5,
  base: 6,
}

function rowY(snap: Snapshot, stance: Stance, type: LineType): number {
  const redY = LINE_Y[stance][type]
  return snap.team === 'red' ? redY : 9 - redY
}

function laneX(ctx: Ctx, u: UnitView): number {
  const group = ctx.allies.filter((a) => a.type === u.type).sort((a, b) => a.id - b.id)
  const i = Math.max(0, group.findIndex((a) => a.id === u.id))
  const n = group.length
  const spread = SPREAD[u.type as LineType] * (ctx.stance === 'defend' ? 0.78 : 1)
  const offset = n > 1 ? (i - (n - 1) / 2) * (spread / (n - 1)) : 0
  const shiftScale = ctx.stance === 'defend' ? 0.45 : 0.8
  const shift = clamp((ctx.enemyCentroidX - 4) * shiftScale, -1.4, 1.4)
  return clamp(4 + offset + shift, 0.7, 7.3)
}

function slotFor(ctx: Ctx, u: UnitView): { x: number; y: number } {
  if (u.type === 'advisor') return advisorSlot(ctx, u)
  if (u.type === 'cannon' || u.type === 'rook' || u.type === 'horse' || u.type === 'pawn') {
    return { x: laneX(ctx, u), y: rowY(ctx.snap, ctx.stance, u.type) }
  }
  return { x: u.x, y: u.y }
}

function advisorSlot(ctx: Ctx, u: UnitView): { x: number; y: number } {
  const dir = ctx.threatDir
  const perp = { x: -dir.y, y: dir.x }
  const group = ctx.allies.filter((a) => a.type === 'advisor').sort((a, b) => a.id - b.id)
  const i = group.findIndex((a) => a.id === u.id)
  const side = i === 0 ? 1 : -1
  // 士只在基地周围巡防：站位是防区内偏向威胁方向的一个点，具体轨迹由引擎的巡游环决定
  const guard = Math.max(0.8, ctx.snap.rules.advisorGuardRadius - u.radius - 0.1)
  let ox = dir.x * 1.5 + perp.x * side * 0.55
  let oy = dir.y * 1.5 + perp.y * side * 0.55
  const len = Math.hypot(ox, oy)
  if (len > guard) {
    ox = (ox / len) * guard
    oy = (oy / len) * guard
  }
  return { x: ctx.base.x + ox, y: ctx.base.y + oy }
}

function moveIntent(x: number, y: number): Intent {
  return { type: 'move', x, y }
}

function idle(): Intent {
  return { type: 'idle' }
}

function inRange(u: UnitView, t: UnitView, extra = 0): boolean {
  return distance(u, t) <= u.attackRange + t.radius + extra
}

function enemiesWithin(enemies: UnitView[], p: { x: number; y: number }, r: number): UnitView[] {
  return enemies.filter((e) => e.alive && distance(e, p) <= r)
}

function nearestEnemy(enemies: UnitView[], p: { x: number; y: number }): UnitView | null {
  let best: UnitView | null = null
  let bestD = Infinity
  for (const e of enemies) {
    if (!e.alive || !e.targetable) continue
    const d = distance(e, p)
    if (d < bestD) {
      bestD = d
      best = e
    }
  }
  return best
}

function incomingDps(u: UnitView, ctx: Ctx): number {
  let sum = 0
  for (const e of ctx.enemies) {
    if (!e.alive) continue
    const reach =
      e.type === 'cannon' ? 3.7 : e.type === 'advisor' ? 2.7 : e.type === 'elephant' ? 1.6 : 2.8
    const d = distance(u, e)
    if (d < reach) sum += dpsOf(e) * (1 - d / reach)
  }
  if (ctx.enemyBase.alive) {
    const d = distance(u, ctx.enemyBase)
    if (d < ctx.snap.rules.baseTurretRange + 0.6) sum += 26
  }
  return sum
}

function cannonsOf(ctx: Ctx): UnitView[] {
  return ctx.allies.filter((a) => a.type === 'cannon' && a.alive)
}

function divingOurCannon(e: UnitView, ctx: Ctx): boolean {
  for (const c of cannonsOf(ctx)) {
    if (distance(e, c) < 1.9) return true
  }
  return false
}

function pickStance(ctx: Ctx): Stance {
  const { snap, enemies, allies, base, enemyBase } = ctx
  if (snap.phase === 'overtime') {
    const diff = base.hp - enemyBase.hp
    if (diff > 40) return 'defend'
    if (diff < -40) return 'allin'
    return ctx.mem.stance === 'push' || ctx.mem.stance === 'allin' ? 'allin' : 'defend'
  }
  const nearBase = enemies.filter((e) => distance(e, base) < 3.8).length
  const intruders = enemies.filter((e) => distance(e, base) < 5.2).length
  if (
    nearBase >= 2 ||
    (nearBase >= 1 && base.hp < base.maxHp * 0.7) ||
    (intruders >= 3 && allies.length < 6) ||
    ctx.baseThreat > 95
  ) {
    return 'defend'
  }
  const hpBalance =
    allies.reduce((s, u) => s + u.hp / u.maxHp, 0) -
    enemies.reduce((s, u) => s + u.hp / u.maxHp, 0)
  if (snap.team === 'black' && snap.time < 0.4) {
  }
  const baseBalance = ((base.hp - enemyBase.hp) / Math.max(1, base.maxHp)) * 3.2
  const numBalance = (allies.length - enemies.length) * 1.15
  const advantage = hpBalance * 0.9 + baseBalance + numBalance
  const canPush =
    allies.length >= 4 &&
    allies.length >= enemies.length - 1 &&
    (advantage > 1.9 || enemies.length <= 3)
  if (canPush && intruders <= allies.length + 2) return 'push'
  if (enemies.length <= 2 && allies.length >= 4 && base.hp > enemyBase.hp * 0.5) return 'push'
  if (base.hp < enemyBase.hp * 0.55 && allies.length <= 3) return 'defend'
  return 'contest'
}

function updateStance(ctx: Ctx): void {
  const want = pickStance(ctx)
  const mem = ctx.mem
  const cleared =
    want === 'push' &&
    mem.stance === 'defend' &&
    ctx.enemies.filter((e) => distance(e, ctx.base) < 4.2).length === 0
  const immediate =
    (want === 'defend' && ctx.baseThreat > 95) ||
    ctx.snap.phase === 'overtime' ||
    want === 'allin' ||
    cleared
  if (want === mem.stance) {
    mem.candidate = want
    mem.candidateSince = ctx.snap.time
    return
  }
  if (immediate) {
    mem.stance = want
    mem.candidate = want
    mem.candidateSince = ctx.snap.time
    return
  }
  if (mem.candidate !== want) {
    mem.candidate = want
    mem.candidateSince = ctx.snap.time
    return
  }
  if (ctx.snap.time - mem.candidateSince > 1.1) {
    mem.stance = want
    mem.candidate = want
  }
}

function computeRetreat(ctx: Ctx): void {
  for (const u of ctx.allies) {
    if (!u.alive) continue
    if (u.type !== 'rook' && u.type !== 'horse' && u.type !== 'cannon') continue
    if (ctx.stance === 'allin') {
      ctx.mem.retreat[u.id] = false
      continue
    }
    const hp = u.hp / u.maxHp
    const was = ctx.mem.retreat[u.id] ?? false
    const dmg = incomingDps(u, ctx)
    const ttd = u.hp / Math.max(8, dmg)
    const nearBase = distance(u, ctx.base) < 4.6
    const threshold = u.type === 'cannon' ? 0.4 : u.type === 'horse' ? 0.3 : 0.32
    let now = was
    if (!was) {
      const exposed = u.type === 'cannon' ? dmg > 16 : dmg > 24
      if (hp < threshold && exposed && ttd < 4.2 && !ctx.baseEmergency && !nearBase) now = true
      if (u.type === 'cannon' && hp < 0.55 && dmg > 34 && !ctx.baseEmergency) now = true
    } else if (hp > 0.7 || ctx.baseEmergency) {
      now = false
    }
    ctx.mem.retreat[u.id] = now
    if (now) ctx.retreating.add(u.id)
  }
}

function pickMeleeTarget(ctx: Ctx, u: UnitView): UnitView | null {
  const { enemies, enemyBase, stance, base, snap } = ctx
  if (stance === 'allin' && enemyBase.alive) return enemyBase
  if (ctx.raiders.has(u.id) && enemyBase.alive) {
    const nearest = nearestEnemy(enemies, u)
    if (distance(u, enemyBase) < 3.6 || !nearest || distance(u, nearest) > 2.2) return enemyBase
  }
  const leash =
    stance === 'defend'
      ? 4.6
      : stance === 'contest'
        ? u.type === 'pawn'
          ? 4.2
          : 5.4
        : 8
  let best: UnitView | null = null
  let bestScore = -Infinity
  for (const e of enemies) {
    if (!e.alive || !e.targetable) continue
    const d = distance(u, e)
    if (d > leash) continue
    let score = valueOf(e) * 0.55 + (1 - e.hp / e.maxHp) * 3.4 - d * 0.42
    if (e.type === 'cannon') score += 1.8
    if (e.type === 'elephant') score -= 0.9
    if (distance(e, base) < 4.2) score += 2.2
    if (divingOurCannon(e, ctx)) score += 2.1
    if (stance === 'defend' && distance(e, base) > 6) score -= 2.4
    const assigned = ctx.assigned.get(e.id) ?? 0
    if (assigned > e.hp * 0.92) score -= 1.4
    else if (assigned > 0) score += 1.2
    if (e.hp / e.maxHp < 0.3) score += 1.1
    if (score > bestScore) {
      bestScore = score
      best = e
    }
  }
  const baseAttackable =
    stance === 'push' &&
    (enemies.length <= 2 || ctx.advantage >= 3) &&
    distance(u, enemyBase) < 8 &&
    distance(enemyBase, base) > 4
  const desperation = enemyBase.hp / enemyBase.maxHp < 0.16
  if (enemyBase.alive && (baseAttackable || desperation)) {
    let score = 5.5 + (1 - enemyBase.hp / enemyBase.maxHp) * 8 - distance(u, enemyBase) * 0.25
    const guards = enemies.filter((e) => distance(e, enemyBase) < 3.2).length
    score -= guards * 1.8
    const assigned = ctx.assigned.get(enemyBase.id) ?? 0
    if (assigned > enemyBase.hp * 0.9) score -= 3
    if (score > bestScore) {
      best = enemyBase
      bestScore = score
    }
  }
  if (best && snap.phase === 'overtime' && ctx.stance !== 'allin') {
    // 领先死守时，不要追出基地太远
    if (distance(best, base) > 6.5 && distance(u, base) > 2.5) return null
  }
  return best
}

function pickCannonTarget(ctx: Ctx, u: UnitView): UnitView | null {
  const { enemies, enemyBase, stance } = ctx
  const min = ctx.snap.rules.cannonMinRange
  const max = u.attackRange
  const candidates: UnitView[] = []
  for (const e of enemies) {
    if (!e.alive || !e.targetable) continue
    const d = distance(u, e)
    if (d >= min && d <= max + e.radius) candidates.push(e)
  }
  const baseOkay =
    enemyBase.alive &&
    distance(u, enemyBase) >= min &&
    distance(u, enemyBase) <= max + enemyBase.radius &&
    (stance === 'push' || stance === 'allin' || enemies.filter((e) => distance(e, enemyBase) < 4).length <= 1)
  if (baseOkay) candidates.push(enemyBase)
  let best: UnitView | null = null
  let bestScore = -Infinity
  for (const e of candidates) {
    let cluster = 0
    for (const o of enemies) {
      if (!o.alive) continue
      if (distance(o, e) <= 1.1) cluster += valueOf(o) * 0.3
    }
    let score = cluster + valueOf(e) * 0.18 + (1 - e.hp / e.maxHp) * 0.7
    if (e.isBase) score += 1.4
    score -= distance(u, e) * 0.05
    if (score > bestScore) {
      bestScore = score
      best = e
    }
  }
  return best
}

function pickJumpTarget(ctx: Ctx, u: UnitView): UnitView | null {
  if (!u.skillReady || u.jumpPhase !== 'none' || u.stun > 0) return null
  const min = ctx.snap.rules.jumpMin
  const max = ctx.snap.rules.jumpMax
  let best: UnitView | null = null
  let bestScore = 4.6
  for (const e of ctx.enemies) {
    if (!e.alive || !e.targetable) continue
    const d = distance(u, e)
    if (d < min + 0.05 || d > max - 0.05) continue
    let score = valueOf(e) * 0.52 + (1 - e.hp / e.maxHp) * 3.6
    if (e.type === 'cannon') score += 2.8
    if (e.type === 'advisor') score += 0.8
    const cluster = enemiesWithin(ctx.enemies, e, 1.45).length
    if (cluster >= 3) score -= 3.4
    if (distance(e, ctx.base) < 4) score += 1.6
    if (u.hp / u.maxHp < 0.38) score -= 2.2
    if (score > bestScore) {
      bestScore = score
      best = e
    }
  }
  return best
}

function starScore(ctx: Ctx, u: UnitView, s: { x: number; y: number }): number {
  let score = 0
  const near = enemiesWithin(ctx.enemies, s, 2.3)
  for (const e of near) {
    const d = distance(e, s)
    score += valueOf(e) * 0.3 + (1 - e.hp / e.maxHp) * 0.55 + (2.3 - d) * 0.18
  }
  const danger = enemiesWithin(ctx.enemies, s, 2.5).length
  if (u.hp / u.maxHp < 0.55) score -= danger * 0.75
  if (ctx.baseThreat > 0 && distance(s, ctx.base) < 3.4) score += Math.min(2.2, ctx.baseThreat * 0.018)
  if (ctx.enemies.length === 0) {
    const ownDepth = ctx.snap.team === 'red' ? 9 - s.y : s.y
    score += ownDepth * 0.28
  }
  return score
}

function elephantIntent(ctx: Ctx, u: UnitView): Intent {
  if (u.teleportPhase === 'windup') return idle()
  const near = pickMeleeTarget(ctx, u)
  const inReach = near && inRange(u, near)
  if (!u.skillReady) return inReach && near ? { type: 'attack', targetId: near.id } : idle()

  let current: { id: string; x: number; y: number; neighbors: string[] } | null = null
  let currentD = Infinity
  for (const s of ctx.snap.stars) {
    const d = Math.hypot(s.x - u.x, s.y - u.y)
    if (d < currentD) {
      currentD = d
      current = s
    }
  }
  if (!current) return idle()
  const curScore = starScore(ctx, u, current)
  let best: (typeof ctx.snap.stars)[number] | null = null
  let bestScore = curScore + 0.75
  for (const s of ctx.snap.stars) {
    if (!current.neighbors.includes(s.id)) continue
    if (s.occupiedBy !== null && s.occupiedBy !== u.id) continue
    if (ctx.reservedStars.has(s.id)) continue
    const sc = starScore(ctx, u, s)
    if (sc > bestScore) {
      bestScore = sc
      best = s
    }
  }
  if (best) {
    ctx.reservedStars.add(best.id)
    return { type: 'teleport', starId: best.id }
  }
  if (inReach && near) return { type: 'attack', targetId: near.id }
  return idle()
}

function advisorIntent(ctx: Ctx, u: UnitView): Intent {
  const target = nearestEnemy(ctx.enemies, u)
  const guard = ctx.snap.rules.advisorGuardRadius
  // 士会巡防出击：防区内的敌人直接压上去，引擎负责绕圈走位
  if (target && target.targetable && distance(target, ctx.base) < guard + u.attackRange) {
    return { type: 'attack', targetId: target.id }
  }
  const slot = advisorSlot(ctx, u)
  const d = Math.hypot(slot.x - u.x, slot.y - u.y)
  if (d > 0.28) return moveIntent(slot.x, slot.y)
  return idle()
}

function cannonIntent(ctx: Ctx, u: UnitView): Intent {
  const snap = ctx.snap
  const min = snap.rules.cannonMinRange
  const threat = nearestEnemy(ctx.enemies, u)
  const threatD = threat ? distance(u, threat) : Infinity
  const slot = slotFor(ctx, u)
  const slotD = Math.hypot(slot.x - u.x, slot.y - u.y)

  if (u.form === 'deploying' || u.form === 'packing' || u.form === 'fleeing') return idle()

  if (u.form === 'siege') {
    const wantAdvance =
      (ctx.stance === 'push' || ctx.stance === 'allin') && slotD > 2.6 && u.hp / u.maxHp > 0.45
    if (wantAdvance && threatD > 2.4) return { type: 'undeploy' }
    if (threatD < 1.7) {
      const away = normalize(u.x - (threat?.x ?? u.x), u.y - (threat?.y ?? u.y))
      return moveIntent(u.x + away.x * 2.2, u.y + away.y * 2.2)
    }
    const target = pickCannonTarget(ctx, u)
    if (target) return { type: 'attack', targetId: target.id }
    if (slotD > 1.7) return { type: 'undeploy' }
    return idle()
  }

  // mobile
  if (threatD < min * 1.3) {
    const away = normalize(u.x - (threat?.x ?? u.x), u.y - (threat?.y ?? u.y))
    const home = normalize(u.homeX - u.x, u.homeY - u.y)
    return moveIntent(u.x + (away.x + home.x * 0.5) * 2.2, u.y + (away.y + home.y * 0.5) * 2.2)
  }
  const target = pickCannonTarget(ctx, u)
  const holdHere = ctx.stance !== 'push' && ctx.stance !== 'allin'
  if (target && threatD > min * 1.35 && (holdHere || slotD < 2.2)) return { type: 'deploy' }
  if (slotD > 0.5) return moveIntent(slot.x, slot.y)
  return idle()
}

function meleeIntent(ctx: Ctx, u: UnitView): Intent {
  const target = pickMeleeTarget(ctx, u)
  if (!target) {
    const slot = slotFor(ctx, u)
    const d = Math.hypot(slot.x - u.x, slot.y - u.y)
    return d > 0.32 ? moveIntent(slot.x, slot.y) : idle()
  }
  const d = distance(u, target)
  const reach = u.attackRange + target.radius
  if (d <= reach - 0.01) {
    ctx.assigned.set(target.id, (ctx.assigned.get(target.id) ?? 0) + dpsOf(u) * 1.5)
    return { type: 'attack', targetId: target.id }
  }
  if (u.type === 'horse' && u.skillReady && u.jumpPhase === 'none') {
    const jumpTarget = pickJumpTarget(ctx, u)
    if (jumpTarget) return { type: 'jump', targetId: jumpTarget.id }
  }
  // 近距离时绕到侧翼，避免全队挤在一条直线上
  if (d < 2.6 && ctx.stance !== 'allin') {
    const bearing = Math.atan2(u.y - target.y, u.x - target.x)
    const idx = (u.id * 7) % 5
    const offset = (idx - 2) * 0.34
    const r = target.radius + u.radius + 0.12
    return moveIntent(
      clamp(target.x + Math.cos(bearing + offset) * r, 0.4, 7.6),
      clamp(target.y + Math.sin(bearing + offset) * r, 0.4, 8.6),
    )
  }
  return { type: 'attack', targetId: target.id }
}

function unitIntent(ctx: Ctx, u: UnitView): Intent {
  if (ctx.retreating.has(u.id)) {
    const d = Math.hypot(u.homeX - u.x, u.homeY - u.y)
    const threat = nearestEnemy(ctx.enemies, u)
    if (threat && distance(u, threat) < 1.35) {
      return { type: 'attack', targetId: threat.id }
    }
    if (d > 0.4) return moveIntent(u.homeX, u.homeY)
    return idle()
  }
  if (u.type === 'advisor') return advisorIntent(ctx, u)
  if (u.type === 'elephant') return elephantIntent(ctx, u)
  if (u.type === 'cannon') return cannonIntent(ctx, u)
  return meleeIntent(ctx, u)
}

function baseIntent(ctx: Ctx): Intent {
  let best: UnitView | null = null
  let bestScore = -Infinity
  for (const e of ctx.enemies) {
    if (!e.alive || !e.targetable) continue
    const d = distance(ctx.base, e)
    if (d > ctx.snap.rules.baseTurretRange + e.radius) continue
    let score = valueOf(e) + (1 - e.hp / e.maxHp) * 4 - d * 0.2
    if (e.type === 'cannon') score += 4
    if (d < 2.6) score += 1.5
    if (score > bestScore) {
      bestScore = score
      best = e
    }
  }
  return best ? { type: 'attack', targetId: best.id } : idle()
}

function createContext(snap: Snapshot, memory: CounterMemory): Ctx {
  const enemies = snap.enemies.filter((e) => e.alive)
  const allies = snap.allies.filter((a) => a.alive)
  const base = snap.myBase
  const forward = snap.team === 'red' ? -1 : 1
  let weightedX = 0
  let weight = 0
  let baseThreat = 0
  for (const e of enemies) {
    const d = distance(e, base)
    const w = 1 / (1 + d * 0.25)
    weightedX += e.x * w
    weight += w
    if (d < 5.2) baseThreat += dpsOf(e) * (1 - d / 5.2) * 1.25
  }
  const enemyCentroidX = weight > 0 ? weightedX / weight : 4
  const enemyBase = snap.enemyBase
  let dirX = enemyCentroidX - base.x
  let dirY = enemies.length ? (enemies.reduce((s, e) => s + e.y, 0) / enemies.length) - base.y : forward
  const n = normalize(dirX, dirY)
  if (n.len < 1e-4) {
    dirX = 0
    dirY = forward
  } else {
    dirX = n.x
    dirY = n.y
  }
  const hpBalance =
    allies.reduce((sum, u) => sum + u.hp / u.maxHp, 0) -
    enemies.reduce((sum, u) => sum + u.hp / u.maxHp, 0)
  const ctx: Ctx = {
    snap,
    mem: memory,
    enemies,
    allies,
    base,
    enemyBase,
    stance: memory.stance,
    forward,
    baseThreat,
    baseEmergency: baseThreat > 78 || enemies.filter((e) => distance(e, base) < 3.5).length >= 3,
    enemyCentroidX,
    threatDir: { x: dirX, y: dirY },
    assigned: new Map(),
    retreating: new Set(),
    raiders: new Set(),
    reservedStars: new Set(),
    advantage: allies.length - enemies.length + hpBalance * 0.5,
  }
  updateStance(ctx)
  ctx.stance = memory.stance
  computeRetreat(ctx)
  if (ctx.stance === 'push') {
    const raiders = ctx.allies
      .filter((a) => (a.type === 'rook' || a.type === 'horse') && a.hp / a.maxHp > 0.45)
      .sort(
        (a, b) => distance(a, ctx.enemyBase) - distance(b, ctx.enemyBase) || a.id - b.id,
      )
    if (raiders[0]) ctx.raiders.add(raiders[0].id)
    if (raiders[1] && ctx.enemies.length <= 5) ctx.raiders.add(raiders[1].id)
    if (raiders[2] && ctx.advantage >= 3) ctx.raiders.add(raiders[2].id)
  }
  return ctx
}

export const counterTactic: Tactic = {
  id: 'counter',
  name: '防守反击',
  author: 'built-in',
  version: '1.0.0',
  description:
    '复杂、稳健、判断型。每 125ms 重算局势：读威胁撤退、按价值集火、按姿态布阵，加时领先死守、落后换家。',
  accent: 'jade',
  glyph: '守',
  createMemory: () =>
    ({
      stance: 'contest',
      candidate: 'contest',
      candidateSince: 0,
      retreat: {},
      initialized: false,
    }) as unknown as TacticMemory,
  decide(snap: Snapshot, memory): IntentMap {
    const mem = memory as unknown as CounterMemory
    if (!mem.initialized) {
      mem.initialized = true
      mem.stance = 'contest'
    }
    const ctx = createContext(snap, mem)
    const intents: IntentMap = {}
    intents[snap.myBase.id] = baseIntent(ctx)

    const ordered = [...ctx.allies].sort(
      (a, b) => (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9) || a.id - b.id,
    )
    for (const u of ordered) {
      intents[u.id] = unitIntent(ctx, u)
    }
    return intents
  },
}
