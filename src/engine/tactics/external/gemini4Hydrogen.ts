import type { Intent, IntentMap, Snapshot, StarView, Tactic, TacticMemory, UnitView } from '../api'
import { clamp, distance, dpsOf, normalize, valueOf } from '../api'

/**
 * Gemini 4 Hydrogen · 天枢算阵
 *
 * 外部高强度战术（v2）。核心机制：
 * 1. 炮阵零虚耗：正常架设在己方前沿纵深（depth ~3.25），覆盖整片河界并安全脱离敌方炮塔；
 *    仅在己方前排已深入敌阵扛塔时才前压轰击基地。贴脸撤炮交给引擎自带的加速急撤（0.7x 收炮 + 2.15 移速），
 *    避免手动 undeploy 丢失加速且白吃 1.32x 易伤。
 * 2. 兵车防线与护炮：开局两翼兵略微内收聚阵，接战后兵专盯高威胁近战与切炮刺客（0.32s 眩晕 + 3.4 击退），
 *    车优先打击人群触发 0.92 半径 55% 劈砍；一旦杀入敌方腹地且守军稀疏或进入强攻态，果断用 88 攻城 DPS 拆基地。
 * 3. 马匹狙炮与防溢出：全队按顺序共享本 tick 预估集火伤害，避免过量追击残血；马精准跃击易伤敌炮或人堆。
 * 4. 象位前置群控与保 60s 命：开局抢占河口星位 (2,5)/(6,5) 打满 0.9s 群控，低血果断后跳自愈。
 * 5. 士近距最大扇伤：优先锁死已进入射程且贴近己方基地/炮阵的目标，最大化贴脸 38 扇形伤害与击退。
 */

interface G4HMemory extends TacticMemory {
  elephantWindupStars: Record<number, string>
  cannonIdleTicks: Record<number, number>
  pushMode: boolean
  modeHoldUntil: number
}

interface Ctx {
  snap: Snapshot
  mem: G4HMemory
  allies: UnitView[]
  enemies: UnitView[]
  myBase: UnitView
  enemyBase: UnitView
  cannons: UnitView[]
  pushing: boolean
  emergencyDefend: boolean
  deepFrontlineCount: number
  assignedDps: Map<number, number>
  reservedStars: Set<string>
  threatToCannon: Map<number, number>
}

const depthOf = (snap: Snapshot, y: number): number =>
  snap.team === 'red' ? snap.board.height - y : y

const yFromDepth = (snap: Snapshot, depth: number): number =>
  snap.team === 'red' ? snap.board.height - depth : depth

function isCannonVulnerable(u: UnitView): boolean {
  return (
    u.type === 'cannon' &&
    (u.form === 'siege' || u.form === 'deploying' || u.form === 'packing')
  )
}

function enemiesInRadius(
  enemies: UnitView[],
  p: { x: number; y: number },
  r: number,
  includeExtraRadius = false,
): UnitView[] {
  const out: UnitView[] = []
  for (const e of enemies) {
    if (!e.alive) continue
    const limit = includeExtraRadius ? r + e.radius : r
    if (distance(e, p) <= limit) out.push(e)
  }
  return out
}

function nearestTargetableEnemy(enemies: UnitView[], p: { x: number; y: number }): UnitView | null {
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

function createCtx(snap: Snapshot, mem: G4HMemory): Ctx {
  const allies = snap.allies.filter((a) => a.alive)
  const enemies = snap.enemies.filter((e) => e.alive)
  const cannons = allies.filter((a) => a.type === 'cannon')

  const reservedStars = new Set<string>()
  for (const a of allies) {
    if (a.type === 'elephant' && a.teleportPhase === 'windup') {
      const sid = mem.elephantWindupStars[a.id]
      if (sid) reservedStars.add(sid)
    } else if (mem.elephantWindupStars[a.id]) {
      delete mem.elephantWindupStars[a.id]
    }
  }

  const threatToCannon = new Map<number, number>()
  for (const c of cannons) {
    for (const e of enemies) {
      if (!e.targetable) continue
      const d = distance(c, e)
      if (d < 2.4) {
        const w = (2.4 - d) * (e.type === 'rook' || e.type === 'horse' ? 2.5 : 1.5)
        threatToCannon.set(e.id, Math.max(threatToCannon.get(e.id) ?? 0, w))
      }
    }
  }

  const nearMyBase = enemies.filter((e) => distance(e, snap.myBase) < 4.5)
  const baseDanger = nearMyBase.reduce((s, e) => s + dpsOf(e), 0)
  const emergencyDefend =
    nearMyBase.length >= 3 ||
    baseDanger > 95 ||
    (nearMyBase.length >= 2 && snap.myBase.hp < snap.myBase.maxHp * 0.6)

  const deepFrontlineCount = allies.filter(
    (a) =>
      (a.type === 'rook' || a.type === 'horse' || a.type === 'pawn') &&
      depthOf(snap, a.y) >= 5.6,
  ).length

  const allyPower = allies.reduce((s, u) => s + valueOf(u) * (0.4 + 0.6 * (u.hp / u.maxHp)), 0)
  const enemyPower = enemies.reduce((s, u) => s + valueOf(u) * (0.4 + 0.6 * (u.hp / u.maxHp)), 0)
  const baseLead = (snap.myBase.hp - snap.enemyBase.hp) / Math.max(1, snap.myBase.maxHp)

  let wantPush = mem.pushMode
  if (snap.phase === 'overtime') {
    // 加时阶段：只要家里没严重危机且自身领先不是压倒性，保持主动压制和攻城压力
    if (emergencyDefend && baseLead > 0.08) {
      wantPush = false
    } else {
      wantPush = !emergencyDefend || baseLead < 0.02
    }
  } else {
    if (emergencyDefend && allyPower < enemyPower + 8) {
      wantPush = false
    } else if (
      allies.length >= 5 &&
      (allyPower >= enemyPower + 3.5 || enemies.length <= 4 || allies.length >= enemies.length + 2)
    ) {
      wantPush = true
    } else if (allyPower < enemyPower - 5) {
      wantPush = false
    }
  }

  if (wantPush !== mem.pushMode && snap.time >= mem.modeHoldUntil) {
    mem.pushMode = wantPush
    mem.modeHoldUntil = snap.time + 0.65
  }

  return {
    snap,
    mem,
    allies,
    enemies,
    myBase: snap.myBase,
    enemyBase: snap.enemyBase,
    cannons,
    pushing: mem.pushMode,
    emergencyDefend,
    deepFrontlineCount,
    assignedDps: new Map(),
    reservedStars,
    threatToCannon,
  }
}

function decideBase(ctx: Ctx): Intent {
  const range = ctx.snap.rules.baseTurretRange
  let best: UnitView | null = null
  let bestScore = -Infinity
  for (const e of ctx.enemies) {
    if (!e.alive || !e.targetable) continue
    const d = distance(ctx.myBase, e)
    if (d > range + e.radius) continue
    let score = valueOf(e) * 1.1 + (1 - e.hp / e.maxHp) * 6 - d * 0.25
    if (e.type === 'cannon') score += 5.5
    if (isCannonVulnerable(e)) score += 2.5
    if (e.hp < 90) score += 3.5
    if (score > bestScore) {
      bestScore = score
      best = e
    }
  }
  if (best) {
    ctx.assignedDps.set(best.id, (ctx.assignedDps.get(best.id) ?? 0) + 32)
    return { type: 'attack', targetId: best.id }
  }
  return { type: 'idle' }
}

function pickCannonTarget(ctx: Ctx, u: UnitView): UnitView | null {
  const minR = ctx.snap.rules.cannonMinRange
  const maxR = u.attackRange
  const candidates: UnitView[] = []
  for (const e of ctx.enemies) {
    if (!e.alive || !e.targetable) continue
    const d = distance(u, e)
    if (d >= minR && d <= maxR + e.radius) candidates.push(e)
  }
  if (ctx.enemyBase.alive) {
    const db = distance(u, ctx.enemyBase)
    if (db >= minR && db <= maxR + ctx.enemyBase.radius) {
      candidates.push(ctx.enemyBase)
    }
  }
  if (candidates.length === 0) return null

  let best: UnitView | null = null
  let bestScore = -Infinity
  for (const t of candidates) {
    let splashValue = 0
    for (const o of ctx.enemies) {
      if (!o.alive || o.id === t.id) continue
      const od = distance(o, t)
      if (od <= 1.12 + o.radius) {
        const falloff = 1 - 0.45 * clamp(od / 1.12, 0, 1)
        splashValue += valueOf(o) * 0.48 * falloff + (isCannonVulnerable(o) ? 1.8 : 0)
      }
    }
    if (ctx.enemyBase.alive && !t.isBase && distance(t, ctx.enemyBase) <= 1.12 + ctx.enemyBase.radius) {
      splashValue += 7.5
    }
    let score = splashValue + valueOf(t) * 0.35 + (1 - t.hp / t.maxHp) * 2.2
    if (t.isBase) {
      score += 6.5 + (ctx.pushing ? 4.5 : 0)
    }
    if (isCannonVulnerable(t)) score += 3.2
    const assigned = ctx.assignedDps.get(t.id) ?? 0
    if (!t.isBase && assigned > t.hp * 0.9) score -= 3.5
    score -= distance(u, t) * 0.08
    if (score > bestScore) {
      bestScore = score
      best = t
    }
  }
  return best
}

function decideCannon(ctx: Ctx, u: UnitView): Intent {
  if (u.form === 'deploying' || u.form === 'packing' || u.form === 'fleeing') {
    return { type: 'idle' }
  }
  const minR = ctx.snap.rules.cannonMinRange
  const threat = nearestTargetableEnemy(ctx.enemies, u)
  const threatD = threat ? distance(u, threat) : Infinity

  const myCannons = ctx.cannons.slice().sort((a, b) => a.id - b.id)
  const idx = Math.max(0, myCannons.findIndex((c) => c.id === u.id))
  const spreadX = myCannons.length > 1 ? (idx === 0 ? 2.55 : 5.45) : 4.0
  const enemyMeanX =
    ctx.enemies.length > 0
      ? ctx.enemies.reduce((s, e) => s + e.x, 0) / ctx.enemies.length
      : 4.0
  const targetX = clamp(spreadX + (enemyMeanX - 4) * 0.25, 1.3, 6.7)

  // 有前排深入敌阵扛塔时才进炮塔圈轰基地；平时架在 3.25 纵深安全覆射河界
  const canSiegeBase = ctx.pushing && (ctx.deepFrontlineCount >= 2 || ctx.enemies.length <= 3)
  const desiredDepth = ctx.emergencyDefend
    ? 2.0
    : canSiegeBase
      ? 4.75
      : 3.25
  const slot = { x: targetX, y: yFromDepth(ctx.snap, desiredDepth) }

  if (u.form === 'siege') {
    const target = pickCannonTarget(ctx, u)
    if (target) {
      ctx.mem.cannonIdleTicks[u.id] = 0
      ctx.assignedDps.set(target.id, (ctx.assignedDps.get(target.id) ?? 0) + 55)
      // 不主动发送 undeploy 来躲近战：让引擎在 < 1.2825 时自动触发极速收炮脱离（0.7x 收炮 + 2.15 逃逸速度）
      return { type: 'attack', targetId: target.id }
    }
    const idleCount = (ctx.mem.cannonIdleTicks[u.id] ?? 0) + 1
    ctx.mem.cannonIdleTicks[u.id] = idleCount
    if (idleCount >= 3 || (canSiegeBase && depthOf(ctx.snap, u.y) < 3.6 && threatD > 3.6)) {
      return { type: 'undeploy' }
    }
    return { type: 'idle' }
  }

  // mobile 形态
  ctx.mem.cannonIdleTicks[u.id] = 0
  if (threat && threatD < minR * 1.32) {
    const away = normalize(u.x - threat.x, u.y - threat.y)
    const home = normalize(ctx.myBase.x - u.x, ctx.myBase.y - u.y)
    return {
      type: 'move',
      x: u.x + (away.x * 1.2 + home.x * 0.6) * 1.8,
      y: u.y + (away.y * 1.2 + home.y * 0.6) * 1.8,
    }
  }

  const target = pickCannonTarget(ctx, u)
  if (target) {
    const td = distance(u, target)
    const safeToDeploy = threatD > minR * 1.2
    const comfortRange = td >= minR * 1.06 && td <= u.attackRange * 0.94 + target.radius
    if (safeToDeploy && (comfortRange || !canSiegeBase)) {
      return { type: 'deploy' }
    }
  }

  if (canSiegeBase && ctx.enemyBase.alive) {
    const db = distance(u, ctx.enemyBase)
    if (db > u.attackRange * 0.9 + ctx.enemyBase.radius) {
      return { type: 'attack', targetId: ctx.enemyBase.id }
    }
  }
  if (Math.hypot(slot.x - u.x, slot.y - u.y) > 0.4) {
    return { type: 'move', x: slot.x, y: slot.y }
  }
  return target ? { type: 'deploy' } : { type: 'idle' }
}

function decideElephant(ctx: Ctx, u: UnitView): Intent {
  if (u.teleportPhase === 'windup') return { type: 'idle' }

  const stars = ctx.snap.stars
  let current: StarView | null = null
  for (const s of stars) {
    if (Math.abs(s.x - u.x) < 0.05 && Math.abs(s.y - u.y) < 0.05) {
      current = s
      break
    }
  }

  const inMelee = ctx.enemies.filter((e) => e.targetable && distance(u, e) <= u.attackRange + e.radius)
  const lowHp = u.hp / u.maxHp < 0.36

  if (u.skillReady && u.stun <= 0 && current) {
    let bestStar: StarView | null = null
    let bestScore = -Infinity
    const curDepth = depthOf(ctx.snap, current.y)
    const curNear = enemiesInRadius(ctx.enemies, current, 1.8, true).length

    for (const sid of current.neighbors) {
      const s = stars.find((st) => st.id === sid)
      if (!s) continue
      if (s.occupiedBy !== null && s.occupiedBy !== u.id) continue
      if (ctx.reservedStars.has(s.id)) continue

      const sDepth = depthOf(ctx.snap, s.y)
      const hitList = enemiesInRadius(ctx.enemies, s, 1.5, true)
      const dangerList = enemiesInRadius(ctx.enemies, s, 2.3, true)

      let score = 0
      if (lowHp) {
        score = (curDepth - sDepth) * 2.5 - dangerList.length * 3.0 + hitList.length * 0.4
      } else {
        for (const e of hitList) {
          score += valueOf(e) * 0.78 + (e.hp / e.maxHp < 0.4 ? 1.5 : 0)
        }
        score += (sDepth - curDepth) * 1.15
        if ((s.x === 2 || s.x === 6) && sDepth >= 3.5) score += 1.4
        if (ctx.emergencyDefend && distance(s, ctx.myBase) < 3.0) score += 3.2
        if (u.hp / u.maxHp < 0.6 && dangerList.length >= 3) score -= 4.0
      }

      if (score > bestScore) {
        bestScore = score
        bestStar = s
      }
    }

    const shouldTeleport =
      bestStar !== null &&
      (lowHp
        ? bestScore > 0.5 && curNear > 0
        : bestScore >= 2.0 || (curNear === 0 && depthOf(ctx.snap, bestStar.y) > curDepth + 0.5))

    if (shouldTeleport && bestStar) {
      ctx.reservedStars.add(bestStar.id)
      ctx.mem.elephantWindupStars[u.id] = bestStar.id
      return { type: 'teleport', starId: bestStar.id }
    }
  }

  if (inMelee.length > 0) {
    let best = inMelee[0]
    let bestS = -Infinity
    for (const e of inMelee) {
      const s = valueOf(e) + (1 - e.hp / e.maxHp) * 5 - (ctx.assignedDps.get(e.id) ?? 0) * 0.02
      if (s > bestS) {
        bestS = s
        best = e
      }
    }
    ctx.assignedDps.set(best.id, (ctx.assignedDps.get(best.id) ?? 0) + 24)
    return { type: 'attack', targetId: best.id }
  }
  return { type: 'idle' }
}

function decideAdvisor(ctx: Ctx, u: UnitView): Intent {
  const guard = ctx.snap.rules.advisorGuardRadius
  let best: UnitView | null = null
  let bestScore = -Infinity
  for (const e of ctx.enemies) {
    if (!e.alive || !e.targetable) continue
    const db = distance(e, ctx.myBase)
    if (db > guard + u.attackRange + e.radius) continue
    const du = distance(u, e)
    // 士的扇形霰弹越近越痛（最高 38，远端降至 13.7），强优先锁近身目标
    const inConeReach = du <= u.attackRange + e.radius ? 4.5 : 0
    let score = inConeReach + valueOf(e) * 0.65 + (1 - e.hp / e.maxHp) * 3.0 - du * 1.5
    if (ctx.threatToCannon.has(e.id)) score += 3.0
    if (db < 2.2) score += 2.8
    if (score > bestScore) {
      bestScore = score
      best = e
    }
  }
  if (best) {
    ctx.assignedDps.set(best.id, (ctx.assignedDps.get(best.id) ?? 0) + 28)
    return { type: 'attack', targetId: best.id }
  }

  const centroidX =
    ctx.enemies.length > 0
      ? ctx.enemies.reduce((s, e) => s + e.x, 0) / ctx.enemies.length
      : 4
  const centroidY =
    ctx.enemies.length > 0
      ? ctx.enemies.reduce((s, e) => s + e.y, 0) / ctx.enemies.length
      : yFromDepth(ctx.snap, 5)
  const dir = normalize(centroidX - ctx.myBase.x, centroidY - ctx.myBase.y)
  const perp = { x: -dir.y, y: dir.x }
  const advisors = ctx.allies.filter((a) => a.type === 'advisor').sort((a, b) => a.id - b.id)
  const side = advisors[0]?.id === u.id ? 1 : -1
  const r = Math.max(1.0, guard - u.radius - 0.15)
  const gx = ctx.myBase.x + (dir.x * 1.45 + perp.x * side * 0.7) * (r / 1.6)
  const gy = ctx.myBase.y + (dir.y * 1.45 + perp.y * side * 0.7) * (r / 1.6)
  if (Math.hypot(gx - u.x, gy - u.y) > 0.3) {
    return { type: 'move', x: gx, y: gy }
  }
  return { type: 'idle' }
}

function pickHorseJump(ctx: Ctx, u: UnitView): UnitView | null {
  if (!u.skillReady || u.jumpPhase !== 'none' || u.stun > 0) return null
  const minR = ctx.snap.rules.jumpMin
  const maxR = ctx.snap.rules.jumpMax

  const candidates: UnitView[] = []
  for (const e of ctx.enemies) {
    if (!e.alive || !e.targetable) continue
    candidates.push(e)
  }
  if (ctx.enemyBase.alive) candidates.push(ctx.enemyBase)

  let best: UnitView | null = null
  let bestScore = 3.5
  for (const t of candidates) {
    const d = distance(u, t)
    if (d < minR || d > maxR) continue

    const splashHits = enemiesInRadius(ctx.enemies, t, 1.05, true)
    const dangerCount = enemiesInRadius(ctx.enemies, t, 1.85, true).length
    const nearAllies = ctx.allies.filter((a) => a.id !== u.id && distance(a, t) <= 2.3).length

    let score = 0
    for (const h of splashHits) {
      score += valueOf(h) * 0.55 + (1 - h.hp / h.maxHp) * 2.2
      if (isCannonVulnerable(h)) score += 4.2
    }
    if (t.isBase || (ctx.enemyBase.alive && distance(t, ctx.enemyBase) <= 1.05 + ctx.enemyBase.radius)) {
      score += ctx.pushing ? 7.2 : 3.5
    }
    if (distance(t, ctx.myBase) < 4.0) score += 2.2
    if (ctx.threatToCannon.has(t.id)) score += 2.5
    score += nearAllies * 1.1
    if (dangerCount >= 4 && nearAllies <= 1 && !isCannonVulnerable(t)) score -= 4.2
    if (u.hp / u.maxHp < 0.35 && dangerCount >= 2 && !isCannonVulnerable(t) && !t.isBase) {
      score -= 3.5
    }

    if (score > bestScore) {
      bestScore = score
      best = t
    }
  }
  return best
}

function decideHorse(ctx: Ctx, u: UnitView): Intent {
  if (u.jumpPhase !== 'none') return { type: 'idle' }

  const jumpTarget = pickHorseJump(ctx, u)
  if (jumpTarget) {
    ctx.assignedDps.set(jumpTarget.id, (ctx.assignedDps.get(jumpTarget.id) ?? 0) + 65)
    return { type: 'jump', targetId: jumpTarget.id }
  }

  const homeD = Math.hypot(u.homeX - u.x, u.homeY - u.y)
  const nearEnemy = nearestTargetableEnemy(ctx.enemies, u)
  if (
    u.hp / u.maxHp < 0.28 &&
    !u.skillReady &&
    homeD < 2.5 &&
    (!nearEnemy || distance(u, nearEnemy) > 1.8) &&
    !ctx.emergencyDefend &&
    ctx.snap.phase !== 'overtime'
  ) {
    return homeD > 0.35 ? { type: 'move', x: u.homeX, y: u.homeY } : { type: 'idle' }
  }

  let best: UnitView | null = null
  let bestScore = -Infinity
  for (const e of ctx.enemies) {
    if (!e.alive || !e.targetable) continue
    const d = distance(u, e)
    let score = valueOf(e) * 0.75 + (1 - e.hp / e.maxHp) * 3.8 - d * 0.65
    if (e.type === 'cannon') score += 3.6
    if (isCannonVulnerable(e)) score += 2.6
    if (ctx.threatToCannon.has(e.id)) score += 2.2
    if (distance(e, ctx.myBase) < 4.2) score += 2.4
    const assigned = ctx.assignedDps.get(e.id) ?? 0
    if (assigned > e.hp * 0.95) score -= 4.0
    else if (assigned > 0) score += 1.0
    if (score > bestScore) {
      bestScore = score
      best = e
    }
  }

  if (ctx.enemyBase.alive) {
    const db = distance(u, ctx.enemyBase)
    const enemyNearBase = enemiesInRadius(ctx.enemies, ctx.enemyBase, 2.8).length
    if (
      ctx.pushing ||
      db < 3.4 ||
      (ctx.snap.phase === 'overtime' && db < 4.8) ||
      ctx.enemies.length <= 2
    ) {
      let baseScore = (ctx.pushing ? 8.0 : 4.5) - db * 0.45 - enemyNearBase * 0.95
      if (ctx.enemyBase.hp < 850) baseScore += 5.5
      if (baseScore > bestScore) {
        best = ctx.enemyBase
        bestScore = baseScore
      }
    }
  }

  if (best) {
    ctx.assignedDps.set(best.id, (ctx.assignedDps.get(best.id) ?? 0) + 32)
    return { type: 'attack', targetId: best.id }
  }
  return { type: 'idle' }
}

function decideRook(ctx: Ctx, u: UnitView): Intent {
  let best: UnitView | null = null
  let bestScore = -Infinity

  for (const e of ctx.enemies) {
    if (!e.alive || !e.targetable) continue
    const d = distance(u, e)
    const clump = enemiesInRadius(ctx.enemies, e, 0.92, true).length - 1
    let score = valueOf(e) * 0.58 + clump * 2.1 + (1 - e.hp / e.maxHp) * 3.2 - d * 0.72
    if (e.type === 'cannon') score += 2.6
    if (isCannonVulnerable(e)) score += 1.8
    if (distance(e, ctx.myBase) < 4.2) score += 2.8
    if (ctx.threatToCannon.has(e.id)) score += 2.4
    // 士绕基地转圈时别追着跑，除非它离我们很近
    if (e.type === 'advisor' && d > 1.35) score -= 2.0
    const assigned = ctx.assignedDps.get(e.id) ?? 0
    if (assigned > e.hp * 0.95) score -= 3.2
    else if (assigned > 0) score += 1.2
    if (score > bestScore) {
      bestScore = score
      best = e
    }
  }

  if (ctx.enemyBase.alive) {
    const db = distance(u, ctx.enemyBase)
    const guards = enemiesInRadius(ctx.enemies, ctx.enemyBase, 2.4).length
    if (ctx.pushing || db < 3.4 || depthOf(ctx.snap, u.y) >= 5.6 || ctx.enemies.length <= 3) {
      // 车打基地 88 DPS，已近基地时强力拆家，避免被士风筝
      let baseScore = (ctx.pushing ? 9.6 : 6.4) - db * 0.45 - guards * 0.75
      if (db < 1.8) baseScore += 3.2
      if (ctx.enemyBase.hp < 1100) baseScore += 5.5
      if (baseScore > bestScore) {
        best = ctx.enemyBase
        bestScore = baseScore
      }
    }
  }

  if (best) {
    ctx.assignedDps.set(best.id, (ctx.assignedDps.get(best.id) ?? 0) + 48)
    return { type: 'attack', targetId: best.id }
  }
  return { type: 'idle' }
}

function decidePawn(ctx: Ctx, u: UnitView): Intent {
  // 开局前 2.2 秒两翼兵略微向中路收敛，抱团抗线护炮
  if (ctx.snap.time < 2.2 && Math.abs(u.x - 4) > 2.6) {
    const targetX = u.x < 4 ? 1.8 : 6.2
    return { type: 'move', x: targetX, y: yFromDepth(ctx.snap, 4.3) }
  }

  let best: UnitView | null = null
  let bestScore = -Infinity

  for (const e of ctx.enemies) {
    if (!e.alive || !e.targetable) continue
    const d = distance(u, e)
    let score = valueOf(e) * 0.48 + (1 - e.hp / e.maxHp) * 2.4 - d * 0.9
    if (e.type === 'rook' || e.type === 'horse') score += 1.9
    if (ctx.threatToCannon.has(e.id)) score += 3.8
    if (distance(e, ctx.myBase) < 4.2) score += 2.6
    if (e.type === 'cannon') score += 1.8
    if (e.type === 'advisor' && d > 1.2) score -= 1.8
    const assigned = ctx.assignedDps.get(e.id) ?? 0
    if (assigned > e.hp * 0.9) score -= 2.8
    if (score > bestScore) {
      bestScore = score
      best = e
    }
  }

  if (ctx.enemyBase.alive) {
    const db = distance(u, ctx.enemyBase)
    if (ctx.pushing || db < 3.4 || depthOf(ctx.snap, u.y) >= 5.5 || ctx.enemies.length <= 2) {
      let baseScore = (ctx.pushing ? 8.6 : 5.5) - db * 0.55
      if (db < 1.8) baseScore += 2.5
      if (ctx.enemyBase.hp < 1000) baseScore += 4.5
      if (baseScore > bestScore) {
        best = ctx.enemyBase
        bestScore = baseScore
      }
    }
  }

  if (best) {
    ctx.assignedDps.set(best.id, (ctx.assignedDps.get(best.id) ?? 0) + 25)
    return { type: 'attack', targetId: best.id }
  }
  return { type: 'idle' }
}

const ROLE_ORDER: Record<string, number> = {
  cannon: 0,
  elephant: 1,
  horse: 2,
  rook: 3,
  pawn: 4,
  advisor: 5,
}

export const gemini4HydrogenTactic: Tactic = {
  id: 'gemini-4-hydrogen',
  name: '天枢算阵',
  author: 'Gemini 4 Hydrogen',
  version: '1.0.0',
  description:
    '高压协同流：兵车护炮卡线、象抢星位群控、马精准跃击易伤炮阵，打出优势瞬间转入 1.8x 攻城强拆。',
  accent: 'gold',
  glyph: '氢',
  createMemory: (): TacticMemory =>
    ({
      elephantWindupStars: {},
      cannonIdleTicks: {},
      pushMode: false,
      modeHoldUntil: 0,
    }) as G4HMemory,
  decide(snap: Snapshot, memory: TacticMemory): IntentMap {
    const mem = memory as G4HMemory
    const ctx = createCtx(snap, mem)
    const intents: IntentMap = {}

    intents[snap.myBase.id] = decideBase(ctx)

    const ordered = [...ctx.allies].sort(
      (a, b) => (ROLE_ORDER[a.type] ?? 9) - (ROLE_ORDER[b.type] ?? 9) || a.id - b.id,
    )

    for (const u of ordered) {
      switch (u.type) {
        case 'cannon':
          intents[u.id] = decideCannon(ctx, u)
          break
        case 'elephant':
          intents[u.id] = decideElephant(ctx, u)
          break
        case 'advisor':
          intents[u.id] = decideAdvisor(ctx, u)
          break
        case 'horse':
          intents[u.id] = decideHorse(ctx, u)
          break
        case 'rook':
          intents[u.id] = decideRook(ctx, u)
          break
        case 'pawn':
          intents[u.id] = decidePawn(ctx, u)
          break
        default:
          intents[u.id] = { type: 'idle' }
      }
    }

    return intents
  },
}
