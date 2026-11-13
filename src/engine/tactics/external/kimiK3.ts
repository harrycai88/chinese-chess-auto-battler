import type { Intent, IntentMap, Snapshot, StarView, Tactic, TacticMemory, UnitView } from '../api'
import { clamp, distance, dpsOf, normalize, valueOf } from '../api'

/**
 * 玄甲破阵：以基地为主线，以局部集火为手段。
 * 不追远处残兵，不让炮无限走位；决策只依赖快照与短时的星位预留。
 */

interface KimiMemory {
  /** 传送前摇期间锁定目标星位，避免另一只象重复提交。 */
  starHolds: Record<string, number>
}

interface Context {
  snap: Snapshot
  memory: KimiMemory
  allies: UnitView[]
  enemies: UnitView[]
  base: UnitView
  enemyBase: UnitView
  reservedStars: Set<string>
  baseEmergency: boolean
}

const IDLE: Intent = { type: 'idle' }

function aliveTargets(snap: Snapshot): UnitView[] {
  return snap.enemies.filter((e) => e.alive && e.targetable)
}

function nearest(from: UnitView, list: UnitView[]): UnitView | null {
  let best: UnitView | null = null
  let bestDistance = Infinity
  for (const target of list) {
    const d = distance(from, target)
    if (d < bestDistance) {
      best = target
      bestDistance = d
    }
  }
  return best
}

function baseIntent(ctx: Context): Intent {
  let best: UnitView | null = null
  let bestScore = -Infinity
  for (const enemy of ctx.enemies) {
    if (!enemy.targetable) continue
    const d = distance(ctx.base, enemy)
    if (d > ctx.snap.rules.baseTurretRange + enemy.radius) continue
    let score = valueOf(enemy) + (1 - enemy.hp / enemy.maxHp) * 7 - d * 0.35
    if (enemy.type === 'cannon') score += 7
    if (enemy.type === 'horse') score += 2
    if (score > bestScore) {
      best = enemy
      bestScore = score
    }
  }
  return best ? { type: 'attack', targetId: best.id } : IDLE
}

function meleeTarget(ctx: Context, u: UnitView): UnitView | null {
  const baseDistance = distance(u, ctx.enemyBase)
  const ownDepth = ctx.snap.team === 'red' ? ctx.snap.board.height - u.y : u.y
  let best: UnitView | null = null
  let bestScore = -Infinity

  for (const enemy of ctx.enemies) {
    if (!enemy.targetable) continue
    const d = distance(u, enemy)
    const invaderDistance = distance(enemy, ctx.base)
    // 基地推进时不追远处的散兵；守家时则允许回防。
    if (d > 3.1 && invaderDistance > 4.4) continue
    let score = valueOf(enemy) * 0.75 + (1 - enemy.hp / enemy.maxHp) * 4.2 - d * 0.75
    if (d < 1.65) score += 4.5
    if (enemy.type === 'cannon') score += 4.2
    if (enemy.type === 'elephant') score -= 3.8
    if (enemy.type === 'advisor' && invaderDistance > 3.2) score -= 3
    if (invaderDistance < 4.2) score += 7 + (4.2 - invaderDistance) * 1.5
    if (score > bestScore) {
      best = enemy
      bestScore = score
    }
  }

  if (!ctx.enemyBase.alive) return best
  let baseScore = 13.5 + (1 - ctx.enemyBase.hp / ctx.enemyBase.maxHp) * 10 - baseDistance * 0.16
  if (ctx.baseEmergency && ownDepth < 4.8) baseScore -= 14
  if (ctx.enemyBase.hp / ctx.enemyBase.maxHp < 0.2) baseScore += 12
  if (baseScore > bestScore) return ctx.enemyBase
  return best
}

function jumpTarget(ctx: Context, u: UnitView, preferred: UnitView | null): UnitView | null {
  if (!u.skillReady || u.jumpPhase !== 'none' || u.stun > 0) return null
  const min = ctx.snap.rules.jumpMin
  const max = ctx.snap.rules.jumpMax
  if (preferred?.isBase) {
    const d = distance(u, preferred)
    if (d >= min && d <= max) return preferred
  }

  let best: UnitView | null = null
  let bestScore = -Infinity
  for (const enemy of ctx.enemies) {
    if (!enemy.targetable) continue
    const d = distance(u, enemy)
    if (d < min || d > max) continue
    let score = valueOf(enemy) + (1 - enemy.hp / enemy.maxHp) * 4 - d * 0.2
    if (enemy.type === 'cannon') score += 5
    if (enemy.type === 'rook') score += 1.5
    if (enemy.type === 'elephant') score -= 4
    if (distance(enemy, ctx.base) < 3.8) score += 5
    if (score > bestScore) {
      best = enemy
      bestScore = score
    }
  }
  return best
}

function cannonTarget(ctx: Context, u: UnitView): UnitView | null {
  const candidates = aliveTargets(ctx.snap).filter((enemy) => {
    const d = distance(u, enemy)
    return d >= ctx.snap.rules.cannonMinRange && d <= u.attackRange + enemy.radius
  })
  const baseDistance = distance(u, ctx.enemyBase)
  if (
    ctx.enemyBase.alive &&
    baseDistance >= ctx.snap.rules.cannonMinRange &&
    baseDistance <= u.attackRange + ctx.enemyBase.radius
  ) {
    candidates.push(ctx.enemyBase)
  }

  let best: UnitView | null = null
  let bestScore = -Infinity
  for (const target of candidates) {
    let cluster = 0
    for (const enemy of ctx.enemies) {
      if (enemy.id !== target.id && distance(enemy, target) <= 1.45) cluster += valueOf(enemy) * 0.28
    }
    let score = cluster + valueOf(target) * 0.65 + (1 - target.hp / target.maxHp) * 3
    if (target.isBase) score += 10 + (1 - target.hp / target.maxHp) * 8
    if (target.type === 'cannon') score += 2
    if (score > bestScore) {
      best = target
      bestScore = score
    }
  }
  return best
}

function cannonIntent(ctx: Context, u: UnitView): Intent {
  if (u.form === 'deploying' || u.form === 'packing' || u.form === 'fleeing') return IDLE
  const threat = nearest(u, ctx.enemies)
  const threatDistance = threat ? distance(u, threat) : Infinity
  const min = ctx.snap.rules.cannonMinRange

  if (threat && threatDistance < min * 1.08) {
    const away = normalize(u.x - threat.x, u.y - threat.y)
    const home = normalize(u.homeX - u.x, u.homeY - u.y)
    return {
      type: 'move',
      x: clamp(u.x + (away.x + home.x * 0.35) * 2.4, u.radius, ctx.snap.board.width - u.radius),
      y: clamp(u.y + (away.y + home.y * 0.35) * 2.4, u.radius, ctx.snap.board.height - u.radius),
    }
  }

  const target = cannonTarget(ctx, u)
  if (u.form === 'siege') {
    if (target) return { type: 'attack', targetId: target.id }
    return { type: 'undeploy' }
  }
  if (target && threatDistance > min * 1.18) return { type: 'deploy' }
  return { type: 'attack', targetId: ctx.enemyBase.id }
}

function elephantIntent(ctx: Context, u: UnitView): Intent {
  const target = nearest(u, ctx.enemies)
  if (u.teleportPhase === 'windup' || u.stun > 0) return IDLE
  if (!u.skillReady) {
    return target && distance(u, target) <= u.attackRange + target.radius
      ? { type: 'attack', targetId: target.id }
      : IDLE
  }

  let current: StarView | null = null
  let currentDistance = Infinity
  for (const star of ctx.snap.stars) {
    const d = Math.hypot(star.x - u.x, star.y - u.y)
    if (d < currentDistance) {
      current = star
      currentDistance = d
    }
  }
  if (!current) return IDLE

  let best: StarView | null = null
  let bestScore = -Infinity
  for (const star of ctx.snap.stars) {
    if (!current.neighbors.includes(star.id)) continue
    if (star.occupiedBy !== null && star.occupiedBy !== u.id) continue
    if (ctx.reservedStars.has(star.id)) continue
    if ((ctx.memory.starHolds[star.id] ?? -1) > ctx.snap.time) continue
    const depth = ctx.snap.team === 'red' ? ctx.snap.board.height - star.y : star.y
    let score = star.nearbyEnemies * 8 + depth * 0.7 - Math.abs(star.x - 4) * 0.18
    for (const enemy of ctx.enemies) {
      const d = distance(star, enemy)
      if (d <= 1.9) score += valueOf(enemy) * 0.4 + (1 - enemy.hp / enemy.maxHp) * 1.5
    }
    if (distance(star, ctx.base) < 3.4 && ctx.baseEmergency) score += 5
    if (score > bestScore) {
      best = star
      bestScore = score
    }
  }

  const currentDepth = ctx.snap.team === 'red' ? ctx.snap.board.height - current.y : current.y
  const bestDepth = best ? (ctx.snap.team === 'red' ? ctx.snap.board.height - best.y : best.y) : -1
  if (best && (best.nearbyEnemies > 0 || bestDepth > currentDepth)) {
    ctx.reservedStars.add(best.id)
    ctx.memory.starHolds[best.id] = ctx.snap.time + 0.9
    return { type: 'teleport', starId: best.id }
  }
  return target && distance(u, target) <= u.attackRange + target.radius
    ? { type: 'attack', targetId: target.id }
    : IDLE
}

function advisorIntent(ctx: Context, u: UnitView): Intent {
  let best: UnitView | null = null
  let bestScore = -Infinity
  for (const enemy of ctx.enemies) {
    if (!enemy.targetable) continue
    const baseDistance = distance(enemy, ctx.base)
    if (baseDistance > ctx.snap.rules.advisorGuardRadius + u.attackRange) continue
    const score = dpsOf(enemy) * 0.15 + (1 - enemy.hp / enemy.maxHp) * 3 - distance(u, enemy) * 0.3
    if (score > bestScore) {
      best = enemy
      bestScore = score
    }
  }
  return best ? { type: 'attack', targetId: best.id } : IDLE
}

export const kimiK3Tactic: Tactic = {
  id: 'kimi-k3',
  name: '玄甲破阵',
  author: 'Kimi-K3.1-Pro',
  version: '1.1.0',
  description:
    '主动、紧凑、基地导向。车兵马沿最短路线持续压迫基地，近距离才转火高价值敌人；炮打密集阵线与攻城，马跃击切炮或偷家，士象用巡防和星位震击守住后方，以更快的复活节奏持续换血。',
  accent: 'ink',
  glyph: '玄',
  createMemory: () => ({ starHolds: {} }) as unknown as TacticMemory,
  decide(snap: Snapshot, memory): IntentMap {
    const ctx: Context = {
      snap,
      memory: memory as unknown as KimiMemory,
      allies: snap.allies.filter((u) => u.alive),
      enemies: aliveTargets(snap),
      base: snap.myBase,
      enemyBase: snap.enemyBase,
      reservedStars: new Set<string>(),
      baseEmergency: snap.enemies.some((e) => e.alive && distance(e, snap.myBase) < 3.6),
    }
    const intents: IntentMap = { [snap.myBase.id]: baseIntent(ctx) }

    for (const u of ctx.allies) {
      if (u.type === 'advisor') {
        intents[u.id] = advisorIntent(ctx, u)
        continue
      }
      if (u.type === 'elephant') {
        intents[u.id] = elephantIntent(ctx, u)
        continue
      }
      if (u.type === 'cannon') {
        intents[u.id] = cannonIntent(ctx, u)
        continue
      }
      if (u.jumpPhase !== 'none') {
        intents[u.id] = IDLE
        continue
      }
      const target = meleeTarget(ctx, u)
      if (!target) {
        intents[u.id] = IDLE
        continue
      }
      if (u.type === 'horse') {
        const jump = jumpTarget(ctx, u, target)
        if (jump) {
          intents[u.id] = { type: 'jump', targetId: jump.id }
          continue
        }
      }
      intents[u.id] = { type: 'attack', targetId: target.id }
    }
    return intents
  },
}
