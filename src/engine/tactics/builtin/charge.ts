import type { IntentMap, Snapshot, Tactic, UnitView } from '../api'
import { distance } from '../api'

/**
 * 全军冲锋 —— 标尺策略。
 * 不做局势判断、不撤退、不集火：每个单位奔向最近的敌人，
 * 炮在射程内架起，马有窗口就跳，象朝最近敌人传送。
 * 它的意义是给出「最朴素的打法能打成什么样」的基准线。
 */

function targets(snap: Snapshot): UnitView[] {
  const list = snap.enemies.filter((e) => e.alive && e.targetable)
  if (snap.enemyBase.alive) list.push(snap.enemyBase)
  return list
}

function nearest(from: UnitView, list: UnitView[]): UnitView | null {
  let best: UnitView | null = null
  let bestD = Infinity
  for (const t of list) {
    const d = distance(from, t)
    if (d < bestD) {
      bestD = d
      best = t
    }
  }
  return best
}

function nearestStar(snap: Snapshot, u: UnitView): Snapshot['stars'][number] | null {
  let best: Snapshot['stars'][number] | null = null
  let bestD = Infinity
  for (const s of snap.stars) {
    const d = Math.hypot(s.x - u.x, s.y - u.y)
    if (d < bestD) {
      bestD = d
      best = s
    }
  }
  return best
}

export const chargeTactic: Tactic = {
  id: 'charge',
  name: '全军冲锋',
  author: 'built-in',
  version: '1.0.0',
  description:
    '简单、激进、基准线。见谁打谁，不作撤退，全队压向最近的敌人——用最直白的打法标出战场下限。',
  accent: 'vermilion',
  glyph: '攻',
  createMemory: () => ({}),
  decide(snap: Snapshot): IntentMap {
    const intents: IntentMap = {}
    const reservedStars = new Set<string>()
    const list = targets(snap)

    // 基地：优先打射程内威胁最大的目标
    let baseTarget: UnitView | null = null
    let baseScore = -Infinity
    for (const e of snap.enemies) {
      if (!e.alive || !e.targetable) continue
      const d = distance(snap.myBase, e)
      if (d > snap.rules.baseTurretRange + e.radius) continue
      const score = (e.type === 'cannon' ? 4 : 0) + (1 - e.hp / e.maxHp) * 3 - d
      if (score > baseScore) {
        baseScore = score
        baseTarget = e
      }
    }
    intents[snap.myBase.id] = baseTarget
      ? { type: 'attack', targetId: baseTarget.id }
      : { type: 'idle' }

    for (const u of snap.allies) {
      if (!u.alive) continue
      const t = nearest(u, list)
      if (!t) {
        intents[u.id] = { type: 'idle' }
        continue
      }
      let d = distance(u, t)
      let chosen = t
      // 无脑，但不是瞎：已经贴到敌方基地、身边又没有敌人时，就砸基地。
      const eb = snap.enemyBase
      if (eb.alive && u.type !== 'advisor' && u.type !== 'elephant') {
        const db = distance(u, eb)
        const fieldNear = snap.enemies.some((e) => e.alive && e.targetable && distance(u, e) < 1.2)
        const inBaseRange = db <= 4.0
        const deepAndAlone = d > 3.2 && db < 5.2 && !fieldNear
        if ((inBaseRange || deepAndAlone) && !fieldNear) {
          chosen = eb
          d = db
        }
      }

      if (u.type === 'cannon') {
        if (u.form === 'siege') {
          if (d <= u.attackRange + chosen.radius && d >= snap.rules.cannonMinRange) {
            intents[u.id] = { type: 'attack', targetId: chosen.id }
          } else {
            intents[u.id] = { type: 'undeploy' }
          }
        } else if (u.form === 'mobile') {
          if (d < snap.rules.cannonMinRange * 1.2) {
            const dx = u.x - t.x
            const dy = u.y - t.y
            const len = Math.hypot(dx, dy) || 1
            intents[u.id] = {
              type: 'move',
              x: u.x + (dx / len) * 1.6,
              y: u.y + (dy / len) * 1.6,
            }
          } else if (d <= u.attackRange * 0.94 && d >= snap.rules.cannonMinRange * 1.1) {
            intents[u.id] = { type: 'deploy' }
          } else {
            intents[u.id] = { type: 'attack', targetId: chosen.id }
          }
        } else {
          intents[u.id] = { type: 'idle' }
        }
        continue
      }

      if (u.type === 'horse') {
        if (u.jumpPhase !== 'none') {
          intents[u.id] = { type: 'idle' }
          continue
        }
        if (u.skillReady && u.stun <= 0 && chosen.targetable && d >= snap.rules.jumpMin && d <= snap.rules.jumpMax) {
          intents[u.id] = { type: 'jump', targetId: chosen.id }
          continue
        }
        intents[u.id] = { type: 'attack', targetId: chosen.id }
        continue
      }

      if (u.type === 'elephant') {
        if (u.teleportPhase === 'windup') {
          intents[u.id] = { type: 'idle' }
          continue
        }
        if (u.skillReady) {
          const current = nearestStar(snap, u)
          let best: Snapshot['stars'][number] | null = null
          let bestD = Infinity
          for (const s of snap.stars) {
            if (!current || !snap.stars.find((x) => x.id === current.id)?.neighbors.includes(s.id)) continue
            if (s.occupiedBy !== null && s.occupiedBy !== u.id) continue
            if (reservedStars.has(s.id)) continue
            const d2 = Math.hypot(s.x - t.x, s.y - t.y)
            if (d2 < bestD) {
              bestD = d2
              best = s
            }
          }
          if (best && current) {
            const curD = Math.hypot(current.x - t.x, current.y - t.y)
            if (bestD < curD - 0.8 || best.nearbyEnemies > 0) {
              reservedStars.add(best.id)
              intents[u.id] = { type: 'teleport', starId: best.id }
              continue
            }
          }
        }
        intents[u.id] = d <= u.attackRange + chosen.radius ? { type: 'attack', targetId: chosen.id } : { type: 'idle' }
        continue
      }

      if (u.type === 'advisor') {
        // 士压不出防区：防区内有敌人就扑上去，没有就继续巡游
        const inZone = distance(chosen, snap.myBase) <= snap.rules.advisorGuardRadius + u.attackRange
        intents[u.id] = inZone ? { type: 'attack', targetId: chosen.id } : { type: 'idle' }
        continue
      }

      intents[u.id] = { type: 'attack', targetId: chosen.id }
    }

    return intents
  },
}
