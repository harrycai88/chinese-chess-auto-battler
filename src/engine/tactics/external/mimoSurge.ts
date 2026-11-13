import type { Intent, IntentMap, Snapshot, Tactic, TacticMemory, UnitView } from '../api'
import { clamp, distance, dpsOf, normalize, valueOf } from '../api'

/**
 * 破浪 —— MiMo 策略（米诺潮锋）。
 *
 * 打法核心是「打赢团 → 抓窗口砸基地 → 拉回回血」的脉冲节奏，而不是持续平推：
 *  · 局势：每 tick 重算兵力权重、基地威胁、攻防窗口，五种姿态（固守/推进/回防/死守/换家）
 *  · 集火：全局伤害预算把火力压到同一两个目标上，先打残血与炮，避免输出摊薄
 *  · 窗口：敌方兵力残破时全体压上砸基地（攻城倍率 ×1.8），窗口关闭立刻撤出
 *  · 兵种：炮找集群与基地架起、马跃杀炮与残血、象传送落点震晕来犯、士巡防护卫、兵眩晕锁前排
 *  · 保命：残血且能跑回底座才撤退，精英绝不轻易换命；阵亡比治疗更贵
 *  · 加时：领先缩防吃流血，落后无视防守全力换家；基地血量差就是加时的起跑线
 */

type Stance = 'hold' | 'push' | 'defend' | 'turtle' | 'allin'

interface Mem {
  initialized: boolean
  stance: Stance
  cand: Stance
  candSince: number
  retreat: Record<number, boolean>
}

interface Ctx {
  snap: Snapshot
  mem: Mem
  me: UnitView[]
  foe: UnitView[]
  base: UnitView
  ebase: UnitView
  stance: Stance
  forward: number
  assigned: Map<number, number>
  reserved: Set<string>
  baseThreat: number
  baseEmergency: boolean
  powerUs: number
  powerThem: number
  killWindow: boolean
  racing: boolean
  /** 侦察/游击：负责持续给敌方基地上压力的单位 */
  raiders: Set<number>
  centroid: { x: number; y: number }
}

/** 兵种战场权重：越重越不该白送 */
const W: Record<string, number> = {
  rook: 1.7,
  horse: 1.3,
  cannon: 1.5,
  pawn: 0.85,
  advisor: 1.2,
  elephant: 1.8,
  base: 0,
}

const TYPE_ORDER: Record<string, number> = {
  cannon: 0,
  rook: 1,
  horse: 2,
  elephant: 3,
  pawn: 4,
  advisor: 5,
  base: 6,
}

/** 固守/推进时的横向铺开系数（按兵种） */
const SPREAD: Record<string, number> = {
  pawn: 6.2,
  rook: 4.4,
  horse: 3.0,
  cannon: 2.6,
  elephant: 0,
  advisor: 0,
}

/** 红方基准阵型线（y），黑方按 y = 9 - y 镜像 */
const LINE_Y: Record<Stance, Record<string, number>> = {
  hold: { pawn: 5.35, rook: 5.85, horse: 5.6, cannon: 6.35 },
  push: { pawn: 2.6, rook: 2.15, horse: 2.4, cannon: 4.05 },
  defend: { pawn: 6.75, rook: 7.2, horse: 7.0, cannon: 7.55 },
  turtle: { pawn: 7.4, rook: 7.7, horse: 7.5, cannon: 8.1 },
  allin: { pawn: 2.2, rook: 1.85, horse: 2.05, cannon: 3.7 },
}

const RETREAT_ENTER: Record<string, number> = {
  rook: 0.38,
  horse: 0.34,
  cannon: 0.48,
  pawn: 0.26,
}
const RETREAT_EXIT = 0.66

function powerOf(u: UnitView): number {
  const w = W[u.type] ?? 1
  return w * (0.35 + 0.65 * clamp(u.hp / u.maxHp, 0, 1))
}

function inRange(u: UnitView, t: UnitView, extra = 0): boolean {
  return distance(u, t) <= u.attackRange + t.radius + extra
}

function enemiesWithin(list: UnitView[], p: { x: number; y: number }, r: number): UnitView[] {
  return list.filter((e) => e.alive && distance(e, p) <= r)
}

function nearestOf(list: UnitView[], p: { x: number; y: number }): UnitView | null {
  let best: UnitView | null = null
  let bestD = Infinity
  for (const e of list) {
    if (!e.alive) continue
    const d = distance(e, p)
    if (d < bestD) {
      bestD = d
      best = e
    }
  }
  return best
}

function move(x: number, y: number): Intent {
  return { type: 'move', x, y }
}

function idle(): Intent {
  return { type: 'idle' }
}

function attack(id: number): Intent {
  return { type: 'attack', targetId: id }
}

/** 单位被多少火力压着（估算还能站多久） */
function incomingDps(u: UnitView, ctx: Ctx): number {
  let sum = 0
  for (const e of ctx.foe) {
    const reach = e.type === 'cannon' ? 3.6 : e.type === 'advisor' ? 2.6 : e.type === 'elephant' ? 1.6 : 2.7
    const d = distance(u, e)
    if (d < reach) sum += dpsOf(e) * (1 - d / reach)
  }
  if (ctx.ebase.alive) {
    const d = distance(u, ctx.ebase)
    if (d < ctx.snap.rules.baseTurretRange + 0.6) sum += 30
  }
  return sum
}

function rowY(snap: Snapshot, stance: Stance, type: string): number {
  const redY = LINE_Y[stance][type] ?? 5.5
  return snap.team === 'red' ? redY : 9 - redY
}

function laneX(ctx: Ctx, u: UnitView): number {
  const group = ctx.me.filter((a) => a.type === u.type).sort((a, b) => a.id - b.id)
  const i = Math.max(0, group.findIndex((a) => a.id === u.id))
  const n = group.length
  const spread = SPREAD[u.type] ?? 2
  const offset = n > 1 ? (i - (n - 1) / 2) * (spread / (n - 1)) : 0
  const shiftScale = ctx.stance === 'defend' || ctx.stance === 'turtle' ? 0.4 : 0.85
  const enemyX = ctx.foe.length
    ? ctx.foe.reduce((s, e) => s + e.x, 0) / ctx.foe.length
    : 4
  const shift = clamp((enemyX - 4) * shiftScale, -1.5, 1.5)
  return clamp(4 + offset + shift, 0.6, 7.4)
}

function slotFor(ctx: Ctx, u: UnitView): { x: number; y: number } {
  if (u.type === 'advisor') return advisorSlot(ctx, u)
  if (u.type === 'elephant') return { x: u.x, y: u.y }
  return { x: laneX(ctx, u), y: rowY(ctx.snap, ctx.stance, u.type) }
}

function advisorSlot(ctx: Ctx, u: UnitView): { x: number; y: number } {
  const dir = ctx.foe.length
    ? normalize(
        ctx.foe.reduce((s, e) => s + e.x, 0) / ctx.foe.length - ctx.base.x,
        ctx.foe.reduce((s, e) => s + e.y, 0) / ctx.foe.length - ctx.base.y,
      )
    : { x: 0, y: ctx.forward, len: 1 }
  const perp = { x: -dir.y, y: dir.x }
  const group = ctx.me.filter((a) => a.type === 'advisor').sort((a, b) => a.id - b.id)
  const i = Math.max(0, group.findIndex((a) => a.id === u.id))
  const side = i === 0 ? 1 : -1
  const guard = Math.max(0.8, ctx.snap.rules.advisorGuardRadius - u.radius - 0.1)
  let ox = dir.x * 1.4 + perp.x * side * 0.6
  let oy = dir.y * 1.4 + perp.y * side * 0.6
  const len = Math.hypot(ox, oy)
  if (len > guard) {
    ox = (ox / len) * guard
    oy = (oy / len) * guard
  }
  return { x: ctx.base.x + ox, y: ctx.base.y + oy }
}

// ───────────────────────────── 局势 ─────────────────────────────

function computeBaseThreat(enemies: UnitView[], base: UnitView): number {
  let t = 0
  for (const e of enemies) {
    const d = distance(e, base)
    if (d < 5.4) t += dpsOf(e) * (1 - d / 5.4) * 1.3
  }
  return t
}

function pickStance(ctx: Ctx): Stance {
  const { snap, me, foe, base, ebase } = ctx
  if (snap.phase === 'overtime') {
    const diff = base.hp - ebase.hp
    if (diff > 30) return 'turtle'
    if (diff < -30) return 'allin'
    return base.hp >= ebase.hp ? 'turtle' : 'allin'
  }
  const homeThreats = foe.filter((e) => e.type !== 'advisor' && distance(e, base) < 4.2)
  const heavy = homeThreats.some((e) => e.type === 'rook' || e.type === 'horse' || e.type === 'cannon')
  const intruders = foe.filter((e) => e.type !== 'advisor' && distance(e, base) < 5.6).length
  // 换家时回防只会两头空：对攻到底
  if (!ctx.racing) {
    if (heavy || homeThreats.length >= 2 || (intruders >= 3 && me.length < 7) || ctx.baseThreat > 62) {
      return 'defend'
    }
  }
  // 快赢：敌方基地见底且我们还有牙，直接换家
  if (ebase.alive && ebase.hp < ebase.maxHp * 0.22 && me.length >= 3 && ctx.powerUs >= ctx.powerThem * 0.72) {
    return 'allin'
  }
  const advantage = ctx.powerUs - ctx.powerThem
  const lead = me.length - foe.length
  if (
    me.length >= 4 &&
    lead >= 1 &&
    advantage > 1.5 &&
    intruders <= 1 &&
    (base.hp > base.maxHp * 0.5 || advantage > 2.8)
  ) {
    return 'push'
  }
  if (foe.length <= 2 && me.length >= 4 && base.hp > ebase.hp * 0.6) return 'push'
  return 'hold'
}

function updateStance(ctx: Ctx): void {
  const want = pickStance(ctx)
  const mem = ctx.mem
  const immediate =
    want === 'allin' ||
    want === 'turtle' ||
    ctx.snap.phase === 'overtime' ||
    (want === 'defend' && ctx.baseThreat > 92) ||
    (want === 'push' && mem.stance !== 'push' && ctx.killWindow)
  if (want === mem.stance) {
    mem.cand = want
    mem.candSince = ctx.snap.time
    return
  }
  if (immediate) {
    mem.stance = want
    mem.cand = want
    mem.candSince = ctx.snap.time
    return
  }
  if (mem.cand !== want) {
    mem.cand = want
    mem.candSince = ctx.snap.time
    return
  }
  if (ctx.snap.time - mem.candSince > 1.0) {
    mem.stance = want
    mem.cand = want
  }
}

/** 攻坚窗口：优势明显、敌方老家空虚或敌方基地见底时，全军压上 */
function computeKillWindow(ctx: Ctx): boolean {
  const { me, foe, ebase } = ctx
  if (!ebase.alive) return false
  if (ctx.snap.phase === 'overtime') return ctx.stance === 'allin'
  // 守军功率：士永远在基地旁巡防，不算机动守军
  const defenderPower = foe
    .filter((e) => e.type !== 'advisor' && distance(e, ebase) < 3.2)
    .reduce((s, e) => s + powerOf(e), 0)
  const lead = me.length - foe.length
  // 敌方机动守军撑不住家：全军压上（回防前的窗口期就是要吃下的红利）
  const open = defenderPower < 1.4 && me.length >= 4
  // 兵力明显优势：从战场压过去
  const crushed = lead >= 1 && me.length >= 4 && ctx.powerUs > ctx.powerThem * 1.15
  const finish = ebase.hp < ebase.maxHp * 0.32 && me.length >= 3 && ctx.powerUs >= ctx.powerThem * 0.68
  return open || crushed || finish || ctx.racing
}

// ───────────────────────────── 集火 ─────────────────────────────

function targetScore(ctx: Ctx, u: UnitView, e: UnitView): number {
  const d = distance(u, e)
  const hpFrac = e.hp / e.maxHp
  let score = valueOf(e) * 0.5 + (1 - hpFrac) * 4.6 - d * 0.5
  if (e.type === 'cannon') score += 2.6
  if (e.type === 'horse') score += 0.6
  // 兵的击退+硬直是节奏打断器：优先锁住对面输出核心
  if (u.type === 'pawn' && (e.type === 'rook' || e.type === 'horse')) score += 1.6
  if (distance(e, ctx.base) < 4.6) score += 2.4
  if (distance(e, ctx.ebase) < 3.6 && ctx.stance === 'defend') score -= 1.2
  // 帮正在被集火的目标补刀
  const assigned = ctx.assigned.get(e.id) ?? 0
  if (assigned > 0) score += assigned >= e.hp ? -4.5 : 2.0
  return score
}

function pickMeleeTarget(ctx: Ctx, u: UnitView): UnitView | null {
  const { foe, ebase, stance, base, snap } = ctx
  if ((stance === 'allin' || ctx.killWindow) && ebase.alive) return ebase

  // 游击手：守军功率撑不住就持续上压力；被拦住或家里出事就转入正常战斗
  if (ctx.raiders.has(u.id) && ebase.alive && !ctx.baseEmergency) {
    const blocker = foe.filter((e) => e.type !== 'advisor' && distance(e, u) < 2.3)
    const guardPower = foe
      .filter((e) => e.type !== 'advisor' && distance(e, ebase) < 3.2)
      .reduce((s, e) => s + powerOf(e), 0)
    if (blocker.length === 0 && guardPower < 2.2) return ebase
  }

  // 回防拦截：基地被摸了且我们不在换家——离家近的单位先去咬它（抢在姿态切换之前）
  const homeThreats = foe
    .filter((e) => e.type !== 'advisor' && distance(e, base) < 3.6)
    .sort((a, b) => distance(a, base) - distance(b, base) || a.id - b.id)
  if (homeThreats.length > 0 && !ctx.racing && stance !== 'allin') {
    const responders = [...ctx.me]
      .filter((a) => a.type === 'rook' || a.type === 'horse' || a.type === 'pawn')
      .sort((a, b) => distance(a, base) - distance(b, base) || a.id - b.id)
    const guardIdx = responders.findIndex((a) => a.id === u.id)
    const guardCount = homeThreats.length >= 2 ? 3 : 2
    if (guardIdx >= 0 && guardIdx < guardCount) {
      return homeThreats[Math.min(guardIdx, homeThreats.length - 1)]
    }
  }

  const leash =
    stance === 'defend' || stance === 'turtle'
      ? 5.0
      : stance === 'hold'
        ? u.type === 'pawn'
          ? 4.4
          : 5.8
        : 9.5
  let best: UnitView | null = null
  let bestScore = -Infinity
  for (const e of foe) {
    const d = distance(u, e)
    if (d > leash) continue
    const score = targetScore(ctx, u, e)
    if (score > bestScore) {
      bestScore = score
      best = e
    }
  }
  // 顺手摸基地：已经贴到敌方基地、机动守军全不在 —— 免费的攻城伤害
  if (ebase.alive && !best && stance !== 'defend' && stance !== 'turtle') {
    const d = distance(u, ebase)
    const heat = foe.filter((e) => e.type !== 'advisor' && distance(e, u) < 3.4).length
    const guardPower = foe
      .filter((e) => e.type !== 'advisor' && distance(e, ebase) < 2.6)
      .reduce((s, e) => s + powerOf(e), 0)
    if (d < 4.2 && heat === 0 && guardPower < 0.8) return ebase
  }
  if (best && (stance === 'turtle' || (snap.phase === 'overtime' && stance !== 'allin'))) {
    // 死守：不追出基地防圈
    if (distance(best, base) > 5.6 && distance(u, base) > 3.2) return null
  }
  return best
}

function pickCannonTarget(ctx: Ctx, u: UnitView): UnitView | null {
  const { foe, ebase, killWindow, stance } = ctx
  const min = ctx.snap.rules.cannonMinRange
  const max = u.attackRange
  const candidates: UnitView[] = []
  for (const e of foe) {
    const d = distance(u, e)
    if (d >= min && d <= max + e.radius) candidates.push(e)
  }
  const guardPower = foe
    .filter((e) => e.type !== 'advisor' && distance(e, ebase) < 3.2)
    .reduce((s, e) => s + powerOf(e), 0)
  const baseWanted =
    ebase.alive &&
    (killWindow || stance === 'allin' || stance === 'push' || guardPower < 2.0) &&
    distance(u, ebase) >= min &&
    distance(u, ebase) <= max + ebase.radius
  if (baseWanted) candidates.push(ebase)
  let best: UnitView | null = null
  let bestScore = -Infinity
  for (const e of candidates) {
    let cluster = 0
    for (const o of foe) {
      if (distance(o, e) <= 1.15) cluster += valueOf(o) * 0.32
    }
    let score = cluster + valueOf(e) * 0.2 + (1 - e.hp / e.maxHp) * 0.9
    if (e.isBase) score += killWindow || stance === 'allin' ? 8 : 1.6
    score -= distance(u, e) * 0.06
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
  const jumpDmg = 68
  let best: UnitView | null = null
  let bestScore = 5.2
  for (const e of ctx.foe) {
    const d = distance(u, e)
    if (d < min + 0.05 || d > max - 0.05) continue
    let score = valueOf(e) * 0.6 + (1 - e.hp / e.maxHp) * 4.2
    if (e.type === 'cannon') score += 3.2
    if (e.hp <= jumpDmg * 1.2) score += 2.4 // 斩杀确认
    const cluster = enemiesWithin(ctx.foe, e, 1.5).length
    if (cluster >= 2) score += 1.4 * (cluster - 1)
    if (cluster >= 4) score -= 3.6
    if (u.hp / u.maxHp < 0.36 && cluster >= 2) score -= 2.8
    if (distance(e, ctx.base) < 4.2) score += 1.8
    if (ctx.stance === 'defend' && distance(e, ctx.base) > 6) score -= 2.2
    if (score > bestScore) {
      bestScore = score
      best = e
    }
  }
  return best
}

function starScore(ctx: Ctx, u: UnitView, s: { x: number; y: number; nearbyEnemies: number }): number {
  let score = s.nearbyEnemies * 1.1
  const near = enemiesWithin(ctx.foe, s, 2.4)
  for (const e of near) {
    const d = distance(e, s)
    score += valueOf(e) * 0.34 + (1 - e.hp / e.maxHp) * 0.7 + (2.4 - d) * 0.22
    if (e.type === 'cannon') score += 0.9
  }
  const danger = enemiesWithin(ctx.foe, s, 2.6).length
  if (u.hp / u.maxHp < 0.55) score -= danger * 0.85
  if (ctx.baseThreat > 0 && distance(s, ctx.base) < 3.6) score += Math.min(2.6, ctx.baseThreat * 0.02)
  return score
}

function elephantIntent(ctx: Ctx, u: UnitView): Intent {
  if (u.teleportPhase === 'windup') return idle()
  const near = pickMeleeTarget(ctx, u)
  const inReach = near && inRange(u, near)
  if (!u.skillReady) return inReach && near ? attack(near.id) : idle()

  let current: { id: string; x: number; y: number; neighbors: string[]; nearbyEnemies: number } | null = null
  let currentD = Infinity
  for (const s of ctx.snap.stars) {
    const d = Math.hypot(s.x - u.x, s.y - u.y)
    if (d < currentD) {
      currentD = d
      current = s
    }
  }
  if (!current || currentD > 0.35) return inReach && near ? attack(near.id) : idle()
  const curScore = starScore(ctx, u, current)
  let best: (typeof ctx.snap.stars)[number] | null = null
  let bestScore = curScore + 0.35
  let bestStomp = current.nearbyEnemies
  for (const s of ctx.snap.stars) {
    if (!current.neighbors.includes(s.id)) continue
    if (s.occupiedBy !== null && s.occupiedBy !== u.id) continue
    if (ctx.reserved.has(s.id)) continue
    const sc = starScore(ctx, u, s)
    // 落点能震到 2 个以上敌人 = 直接传；否则要比当前位置明显更好才动
    if (s.nearbyEnemies >= 2 && s.nearbyEnemies >= bestStomp && sc > curScore - 1.5) {
      bestScore = sc
      best = s
      bestStomp = s.nearbyEnemies
      continue
    }
    if (sc > bestScore) {
      bestScore = sc
      best = s
    }
  }
  if (best) {
    ctx.reserved.add(best.id)
    return { type: 'teleport', starId: best.id }
  }
  return inReach && near ? attack(near.id) : idle()
}

function advisorIntent(ctx: Ctx, u: UnitView): Intent {
  const guard = ctx.snap.rules.advisorGuardRadius
  // 优先咬正在砸基地/贴脸的敌人
  let best: UnitView | null = null
  let bestScore = -Infinity
  for (const e of ctx.foe) {
    const dBase = distance(e, ctx.base)
    if (dBase > guard + u.attackRange + 0.4) continue
    const d = distance(u, e)
    let score = valueOf(e) + (1 - e.hp / e.maxHp) * 3 - d * 0.5 + Math.max(0, 5 - dBase) * 0.9
    if (e.type === 'cannon') score += 1.6
    if (score > bestScore) {
      bestScore = score
      best = e
    }
  }
  if (best) return attack(best.id)
  const slot = advisorSlot(ctx, u)
  return distance(slot, u) > 0.3 ? move(slot.x, slot.y) : idle()
}

function cannonIntent(ctx: Ctx, u: UnitView): Intent {
  const snap = ctx.snap
  const min = snap.rules.cannonMinRange
  const threat = nearestOf(ctx.foe, u)
  const threatD = threat ? distance(u, threat) : Infinity

  if (u.form === 'deploying' || u.form === 'packing' || u.form === 'fleeing') return idle()

  if (u.form === 'siege') {
    // 贴脸就收炮走人；攻坚窗口里只要还有射界就继续轰
    if (threatD < 1.55) {
      const away = normalize(u.x - (threat?.x ?? u.x), u.y - (threat?.y ?? u.y))
      return move(u.x + away.x * 2.3, u.y + away.y * 2.3)
    }
    const target = pickCannonTarget(ctx, u)
    if (target) return attack(target.id)
    const slot = slotFor(ctx, u)
    if (Math.hypot(slot.x - u.x, slot.y - u.y) > 1.8) return { type: 'undeploy' }
    return idle()
  }

  // mobile：先走位，进窗口再架起
  if (threatD < min * 1.25) {
    const away = normalize(u.x - (threat?.x ?? u.x), u.y - (threat?.y ?? u.y))
    const home = normalize(u.homeX - u.x, u.homeY - u.y)
    return move(u.x + (away.x + home.x * 0.55) * 2.3, u.y + (away.y + home.y * 0.55) * 2.3)
  }
  const target = pickCannonTarget(ctx, u)
  const inWindow = target && distance(u, target) <= u.attackRange + target.radius && distance(u, target) >= min * 1.12
  const wantHold = ctx.stance !== 'push' && ctx.stance !== 'allin' && !ctx.killWindow
  if (inWindow && (wantHold || ctx.killWindow || distance(u, target!) < u.attackRange * 0.8)) {
    return { type: 'deploy' }
  }
  // 攻坚：炮推进到能轰基地的位置
  if ((ctx.killWindow || ctx.stance === 'allin') && ctx.ebase.alive) {
    const dBase = distance(u, ctx.ebase)
    if (dBase > u.attackRange + ctx.ebase.radius - 0.35) {
      const dir = normalize(ctx.ebase.x - u.x, ctx.ebase.y - u.y)
      const lateral = ((ctx.me.filter((a) => a.type === 'cannon').findIndex((a) => a.id === u.id) % 2) * 2 - 1) * 0.9
      return move(
        clamp(u.x + dir.x * 2 + lateral * -dir.y, 0.5, 7.5),
        clamp(u.y + dir.y * 2 + lateral * dir.x, 0.5, 8.5),
      )
    }
    return { type: 'deploy' }
  }
  const slot = slotFor(ctx, u)
  if (Math.hypot(slot.x - u.x, slot.y - u.y) > 0.55) return move(slot.x, slot.y)
  return idle()
}

function meleeIntent(ctx: Ctx, u: UnitView): Intent {
  const target = pickMeleeTarget(ctx, u)
  if (!target) {
    const slot = slotFor(ctx, u)
    return Math.hypot(slot.x - u.x, slot.y - u.y) > 0.34 ? move(slot.x, slot.y) : idle()
  }
  const d = distance(u, target)
  const reach = u.attackRange + target.radius
  if (d <= reach - 0.01) {
    ctx.assigned.set(target.id, (ctx.assigned.get(target.id) ?? 0) + dpsOf(u) * 1.5)
    return attack(target.id)
  }
  if (u.type === 'horse') {
    if (u.skillReady && u.jumpPhase === 'none') {
      const jt = pickJumpTarget(ctx, u)
      if (jt) return { type: 'jump', targetId: jt.id }
    }
    if (u.jumpPhase !== 'none') return idle()
  }
  // 近身绕侧翼，围住目标，也顺带躲开炮线
  if (d < 2.7 && !target.isBase && ctx.stance !== 'allin') {
    const bearing = Math.atan2(u.y - target.y, u.x - target.x)
    const idx = (u.id * 7) % 5
    const offset = (idx - 2) * 0.36
    const r = target.radius + u.radius + 0.1
    return move(
      clamp(target.x + Math.cos(bearing + offset) * r, 0.35, 7.65),
      clamp(target.y + Math.sin(bearing + offset) * r, 0.35, 8.65),
    )
  }
  return attack(target.id)
}

// ───────────────────────────── 撤退 ─────────────────────────────

function computeRetreat(ctx: Ctx): void {
  for (const u of ctx.me) {
    if (u.type !== 'rook' && u.type !== 'horse' && u.type !== 'cannon' && u.type !== 'pawn') continue
    const hp = u.hp / u.maxHp
    const was = ctx.mem.retreat[u.id] ?? false
    let now = was
    if (ctx.stance === 'allin') {
      now = false
    } else if (was) {
      if (hp > RETREAT_EXIT || ctx.baseEmergency) now = false
    } else {
      const enter = RETREAT_ENTER[u.type] ?? 0.3
      const dmg = incomingDps(u, ctx)
      const ttd = u.hp / Math.max(10, dmg)
      const travel = distance(u, { x: u.homeX, y: u.homeY }) / Math.max(0.5, u.speed)
      const exposed = u.type === 'cannon' ? dmg > 12 : dmg > 18
      if (
        hp < enter &&
        exposed &&
        ttd < 5.2 &&
        !ctx.baseEmergency &&
        travel < ttd * 1.35 + 1.2 &&
        !(ctx.killWindow && distance(u, ctx.ebase) < 4.2)
      ) {
        now = true
      }
    }
    ctx.mem.retreat[u.id] = now
  }
}

// ───────────────────────────── 主入口 ─────────────────────────────

function createContext(snap: Snapshot, mem: Mem): Ctx {
  const me = snap.allies.filter((a) => a.alive)
  const foe = snap.enemies.filter((e) => e.alive && e.targetable)
  const base = snap.myBase
  const ebase = snap.enemyBase
  const forward = snap.team === 'red' ? -1 : 1
  const baseThreat = computeBaseThreat(foe, base)
  let powerUs = 0
  for (const u of me) powerUs += powerOf(u)
  let powerThem = 0
  for (const e of foe) powerThem += powerOf(e)
  const centroid = me.length
    ? { x: me.reduce((s, u) => s + u.x, 0) / me.length, y: me.reduce((s, u) => s + u.y, 0) / me.length }
    : { x: base.x, y: base.y }

  // 换家判定：砸他们基地的人不比来犯我们基地的人少，就对攻不回防
  const myRaiders = me.filter(
    (a) => a.type !== 'advisor' && a.type !== 'elephant' && distance(a, ebase) < 4.5,
  ).length
  const homeInvaders = foe.filter((e) => e.type !== 'advisor' && distance(e, base) < 4.2).length
  const racing = myRaiders >= 2 && homeInvaders >= 1 && myRaiders > homeInvaders

  // 游击手：挑 2 个状态好的近战持续骚扰敌方基地——稳定的攻城压力源。
  // 门槛按「守军功率」而不是人数：对面半场式布阵时守军永远「在旁边」，人数门槛会永远不开火
  const defenderPower = foe
    .filter((e) => e.type !== 'advisor' && distance(e, ebase) < 3.2)
    .reduce((s, e) => s + powerOf(e), 0)
  const raiders = new Set<number>()
  if (ebase.alive && defenderPower < 2.2) {
    const pool = me
      .filter(
        (a) =>
          (a.type === 'rook' || a.type === 'horse' || a.type === 'pawn') &&
          a.hp / a.maxHp > 0.5,
      )
      .sort((a, b) => {
        const pa = a.type === 'rook' ? 0 : a.type === 'horse' ? 1 : 2
        const pb = b.type === 'rook' ? 0 : b.type === 'horse' ? 1 : 2
        return pa - pb || distance(a, ebase) - distance(b, ebase) || a.id - b.id
      })
    for (const a of pool.slice(0, 2)) raiders.add(a.id)
  }

  const ctx: Ctx = {
    snap,
    mem,
    me,
    foe,
    base,
    ebase,
    stance: mem.stance,
    forward,
    assigned: new Map(),
    reserved: new Set(),
    baseThreat,
    baseEmergency: baseThreat > 76 || foe.filter((e) => distance(e, base) < 3.6).length >= 3,
    powerUs,
    powerThem,
    killWindow: false,
    racing,
    raiders,
    centroid,
  }
  updateStance(ctx)
  ctx.stance = mem.stance
  ctx.killWindow = computeKillWindow(ctx)
  computeRetreat(ctx)
  return ctx
}

function baseIntent(ctx: Ctx): Intent {
  let best: UnitView | null = null
  let bestScore = -Infinity
  for (const e of ctx.foe) {
    const d = distance(ctx.base, e)
    if (d > ctx.snap.rules.baseTurretRange + e.radius) continue
    let score = valueOf(e) + (1 - e.hp / e.maxHp) * 4.5 - d * 0.25
    if (e.type === 'cannon') score += 4
    if (e.type === 'horse') score += 1
    if (d < 2.6) score += 1.5
    if (score > bestScore) {
      bestScore = score
      best = e
    }
  }
  return best ? attack(best.id) : idle()
}

function unitIntent(ctx: Ctx, u: UnitView): Intent {
  if (ctx.mem.retreat[u.id]) {
    const threat = nearestOf(ctx.foe, u)
    // 太近了跑不掉，反打最脆的那个
    if (threat && distance(u, threat) < 1.3 && threat.hp < u.attackDamage * 2.2) {
      return attack(threat.id)
    }
    const d = Math.hypot(u.homeX - u.x, u.homeY - u.y)
    return d > 0.42 ? move(u.homeX, u.homeY) : idle()
  }
  if (u.type === 'advisor') return advisorIntent(ctx, u)
  if (u.type === 'elephant') return elephantIntent(ctx, u)
  if (u.type === 'cannon') return cannonIntent(ctx, u)
  return meleeIntent(ctx, u)
}

export const mimoSurgeTactic: Tactic = {
  id: "mimo-surge",
  name: '破浪',
  author: 'MiMo-V2.6-Pro',
  version: '1.0.0',
  description:
    '潮锋型判断策略。以打赢团战为纲：全局集火、残血收割、攻坚窗口全军砸基地；炮找集群架起、马跃杀炮位、象落点震晕、士巡防、兵眩晕锁前排。残血回城续命，加时领先死守吃流血、落后换家。为「打赢团战→抓住窗口→砸穿基地」而生。',
  accent: 'gold',
  glyph: '浪',
  createMemory: () =>
    ({
      initialized: false,
      stance: 'hold',
      cand: 'hold',
      candSince: 0,
      retreat: {},
    }) as unknown as TacticMemory,
  decide(snap: Snapshot, memory): IntentMap {
    const mem = memory as unknown as Mem
    if (!mem.initialized) {
      mem.initialized = true
      mem.stance = 'hold'
      mem.cand = 'hold'
      mem.candSince = snap.time
    }
    const ctx = createContext(snap, mem)
    const intents: IntentMap = {}
    intents[snap.myBase.id] = baseIntent(ctx)
    const ordered = [...ctx.me].sort(
      (a, b) => (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9) || a.id - b.id,
    )
    for (const u of ordered) {
      intents[u.id] = unitIntent(ctx, u)
    }
    return intents
  },
}
