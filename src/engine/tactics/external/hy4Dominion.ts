import type { Intent, IntentMap, Snapshot, Tactic, TacticMemory, UnitView } from '../api'
import { clamp, distance, normalize, valueOf } from '../api'

/**
 * 混元·破阵 —— 腾讯混元 HY4
 *
 * 核心判断：这盘棋的胜负只由基地血量决定，而攻城倍率让「贴脸近战」的收益远高于野战绞杀。
 * 因此策略不做对称对轰，而是把常规军变成一条持续灌伤害的攻城流水线：
 *
 *  · 突击组（车/马/兵）全程以敌方基地为意图目标：引擎会让它们边走边自动清理挡路者，
 *    一旦进入基地攻击圈就强制集火基地，不再被守军拉扯；马在跃击窗口内直接空降基地，
 *    落地砸出攻城伤害与范围硬直，腾空期还能规避炮塔火力。
 *  · 一台车专职猎杀贴着敌方基地的士 / 象：精英复活读条是常规军的三到四倍，
 *    清掉它们等于给整条攻城流水线买一段无人干扰的输出窗口。
 *  · 炮组守在己方半场的交叉火力位架起，用高爆弹清集群（同时兼作后院火力）；
 *    只有收官或加时明显落后时才前压轰基地——实测过早前压会丢掉守家火力、得不偿失。
 *  · 士用攻击意图把自己锚在「入侵者与我方基地之间」，象抢占靠近基地的前哨星位，
 *    用落地震晕守住后院；基地炮塔优先点名正在打我基地的单位。
 *  · 开局 7 秒探测对手：成群越过河界的「全军压上型」只召回离基地最近的几个单位
 *    清入侵者，其余继续攻城；窝在自己半场的「防守型」则维持完整速推。
 *    另留一个廉价兵常驻中路当诱饵，把对方的攻城流水线拽在河界附近。
 *  · 加时不临时回防：主力从敌方基地折返的那几秒既守不住家，也白送了继续拉开
 *    血量差的机会。保持既定攻势，只有明显落后才把炮也推上去换家。
 *
 * 所有坐标先换算成「红方视角」（己方基地 y=8、敌方基地 y=1）再写阈值，保证红黑完全对称。
 * 不使用随机数、系统时钟与任何可变引用，跨 tick 状态只放在 memory 里。
 */

type Stance = 'push' | 'defend' | 'allin'

interface StarClaim {
  id: string
  at: number
}

interface HyMemory {
  stance: Stance
  candidate: Stance
  candidateSince: number
  initialized: boolean
  /** 象的星位占用预告：避免两只象在同一 tick / 前摇期抢同一个星位 */
  claims: Record<number, StarClaim>
  /** 开局识别对手：probe → rush（直接速推） / counterPunch（先歼灭再反推） */
  mode: 'probe' | 'rush' | 'counterPunch'
  probeAccum: number
  probeTicks: number
}

interface Ctx {
  snap: Snapshot
  mem: HyMemory
  base: UnitView
  enemyBase: UnitView
  /** 只含存活敌方野战单位（快照里的 enemies 本来就不含基地） */
  enemies: UnitView[]
  allies: UnitView[]
  /** 含阵亡单位的完整名册，用于稳定的分道编号 */
  roster: UnitView[]
  stance: Stance
  reserved: Set<string>
  assigned: Map<number, number>
  /** 中路诱饵 / 拦截组的单位 id */
  guards: Set<number>
  guardSlots: Map<number, { x: number; y: number }>
  /** 压上型对手：临时召回离基地最近的几个单位清入侵者，其余继续攻城 */
  recall: Set<number>
  /** 猎手车：专门清掉贴着敌方基地的士 / 象，给攻城组续命 */
  hunter: number | null
  guard: number
  cannonMin: number
  turretRange: number
}

/**
 * 中线诱饵：只留一个廉价兵。
 * 内置策略普遍「打最近的敌人」，一个停在中路的我方单位会把对方整条攻城流水线
 * 拽在河界附近；主力仍然全员压上，不牺牲突破所需的兵力密度。
 */
const GUARD_PAWNS = 1
const GUARD_ROOKS = 0

const TYPE_ORDER: Record<string, number> = {
  elephant: 0,
  advisor: 1,
  cannon: 2,
  horse: 3,
  rook: 4,
  pawn: 5,
}

const idle = (): Intent => ({ type: 'idle' })
const moveTo = (x: number, y: number): Intent => ({ type: 'move', x, y })
const attackId = (targetId: number): Intent => ({ type: 'attack', targetId })

/** 红方视角坐标 → 棋盘绝对坐标 */
const absY = (snap: Snapshot, localY: number): number =>
  snap.team === 'red' ? localY : 9 - localY

const targetable = (u: UnitView): boolean => u.alive && u.targetable

function nearestOf(list: UnitView[], p: { x: number; y: number }): UnitView | null {
  let best: UnitView | null = null
  let bestD = Infinity
  for (const e of list) {
    if (!targetable(e)) continue
    const d = distance(e, p)
    if (d < bestD) {
      bestD = d
      best = e
    }
  }
  return best
}

/** 稳定分道：同名册位置决定横向站位，阵亡不引起其它单位抖动 */
function laneIndex(ctx: Ctx, u: UnitView): { i: number; n: number } {
  const group = ctx.roster.filter((a) => a.type === u.type).sort((a, b) => a.id - b.id)
  const i = Math.max(0, group.findIndex((a) => a.id === u.id))
  return { i, n: Math.max(1, group.length) }
}

function laneX(ctx: Ctx, u: UnitView): number {
  const { i, n } = laneIndex(ctx, u)
  return n > 1 ? clamp(0.9 + (i / (n - 1)) * 6.2, 0.8, 7.2) : 4
}

// ───────────────────────────── 局势 ─────────────────────────────

function chooseStance(ctx: Ctx): Stance {
  const { snap, base, enemyBase, enemies } = ctx
  if (snap.phase === 'overtime') {
    // 加时双方等速流血，但「全员回防」是陷阱：主力从敌方基地折返要好几秒，
    // 那几秒里既没守住家，也把继续拉开血量差的机会白送掉了。
    // 只有明显落后才值得把炮也推上去换家，其余情况保持既定攻势。
    return base.hp - enemyBase.hp < -250 ? 'allin' : 'push'
  }
  const near = enemies.filter((e) => distance(e, base) < 3.8).length
  if ((base.hp < base.maxHp * 0.3 && near >= 2) || (near >= 4 && base.hp < enemyBase.hp + 150)) {
    return 'defend'
  }
  if (enemyBase.alive && enemyBase.hp < enemyBase.maxHp * 0.28) return 'allin'
  return 'push'
}

function updateStance(ctx: Ctx): void {
  const { mem, snap } = ctx
  const want = chooseStance(ctx)
  if (want === mem.stance) {
    mem.candidate = want
    mem.candidateSince = snap.time
    return
  }
  const immediate = snap.phase === 'overtime' || want === 'allin' || want === 'defend'
  if (immediate) {
    mem.stance = want
    mem.candidate = want
    mem.candidateSince = snap.time
    return
  }
  if (mem.candidate !== want) {
    mem.candidate = want
    mem.candidateSince = snap.time
    return
  }
  if (snap.time - mem.candidateSince > 0.7) {
    mem.stance = want
    mem.candidate = want
    mem.candidateSince = snap.time
  }
}

// ───────────────────────────── 后院：基地 / 士 / 象 ─────────────────────────────

function baseIntent(ctx: Ctx): Intent {
  const { base, enemies, turretRange } = ctx
  let best: UnitView | null = null
  let bestScore = -Infinity
  for (const e of enemies) {
    if (!targetable(e)) continue
    const d = distance(base, e)
    if (d > turretRange + e.radius) continue
    let score = valueOf(e) * 0.5 + (1 - e.hp / e.maxHp) * 5 - d * 0.3
    if (e.targetId === base.id) score += 4.2 // 正在轰我基地
    if (e.type === 'cannon') score += 3
    if (e.type === 'rook' || e.type === 'horse') score += 1.2
    if (d < 2.4) score += 1.4
    if (score > bestScore) {
      bestScore = score
      best = e
    }
  }
  return best ? attackId(best.id) : idle()
}

function advisorIntent(ctx: Ctx, u: UnitView): Intent {
  const reach = ctx.guard + u.attackRange + 0.5
  let best: UnitView | null = null
  let bestScore = -Infinity
  for (const e of ctx.enemies) {
    if (!targetable(e)) continue
    const db = distance(e, ctx.base)
    if (db > reach) continue
    let score =
      -db * 0.85 -
      distance(u, e) * 0.3 +
      (1 - e.hp / e.maxHp) * 2.2 +
      valueOf(e) * 0.18
    if (e.targetId === ctx.base.id) score += 3.5
    if (e.type === 'cannon') score += 1.6
    if (e.type === 'pawn') score -= 0.4
    if ((ctx.assigned.get(e.id) ?? 0) > e.hp) score -= 2
    if (score > bestScore) {
      bestScore = score
      best = e
    }
  }
  if (!best) return idle() // 交给引擎的巡防环，绝不站桩
  ctx.assigned.set(best.id, (ctx.assigned.get(best.id) ?? 0) + u.attackDamage)
  return attackId(best.id)
}

function currentStar(ctx: Ctx, u: UnitView): Snapshot['stars'][number] | null {
  let best: Snapshot['stars'][number] | null = null
  let bestD = Infinity
  for (const s of ctx.snap.stars) {
    const d = Math.hypot(s.x - u.x, s.y - u.y)
    if (d < bestD) {
      bestD = d
      best = s
    }
  }
  return best
}

function starScore(ctx: Ctx, s: Snapshot['stars'][number]): number {
  // 引擎算好的「落地震击能覆盖多少敌人」是主信号
  let score = s.nearbyEnemies * 3.4
  for (const e of ctx.enemies) {
    if (!e.alive) continue
    const d = Math.hypot(e.x - s.x, e.y - s.y)
    if (d < 2.8) score += (2.8 - d) * 0.55 * (0.6 + (1 - e.hp / e.maxHp) * 0.8)
  }
  // 靠近己方基地的前哨星位，震击范围能盖住攻城的敌人
  const db = Math.hypot(s.x - ctx.base.x, s.y - ctx.base.y)
  score += clamp(3.0 - db, 0, 2.4) * 1.0
  return score
}

function claimedByOther(ctx: Ctx, starId: string, selfId: number): boolean {
  for (const [key, claim] of Object.entries(ctx.mem.claims)) {
    if (Number(key) === selfId) continue
    if (claim.id === starId && ctx.snap.time - claim.at < 1.6) return true
  }
  return false
}

function elephantIntent(ctx: Ctx, u: UnitView): Intent {
  if (u.teleportPhase === 'windup') return idle()
  const near = nearestOf(ctx.enemies, u)
  const inReach = near && distance(u, near) <= u.attackRange + near.radius ? near : null
  const current = currentStar(ctx, u)
  if (!u.skillReady || !current) return inReach ? attackId(inReach.id) : idle()

  const curScore = starScore(ctx, current)
  let best: Snapshot['stars'][number] | null = null
  let bestScore = -Infinity
  for (const s of ctx.snap.stars) {
    if (!current.neighbors.includes(s.id)) continue
    if (s.occupiedBy !== null && s.occupiedBy !== u.id) continue
    if (ctx.reserved.has(s.id) || claimedByOther(ctx, s.id, u.id)) continue
    const sc = starScore(ctx, s)
    if (sc > bestScore) {
      bestScore = sc
      best = s
    }
  }
  // 滞回：只在明显更优时换位，避免两 tick 之间来回抖
  if (best && bestScore > curScore + 0.55) {
    ctx.reserved.add(best.id)
    ctx.mem.claims[u.id] = { id: best.id, at: ctx.snap.time }
    return { type: 'teleport', starId: best.id }
  }
  return inReach ? attackId(inReach.id) : idle()
}

// ───────────────────────────── 炮：交叉火力 / 收官轰城 ─────────────────────────────

function cannonSlot(ctx: Ctx, u: UnitView): { x: number; y: number } {
  // 常规：待在己方半场，射程覆盖河界与敌方前排；决战：前压到能轰到基地的位置
  const localY = ctx.stance === 'allin' ? 4.15 : 6.5
  const { i } = laneIndex(ctx, u)
  return { x: i === 0 ? 2.35 : 5.65, y: absY(ctx.snap, localY) }
}

function artilleryTarget(ctx: Ctx, u: UnitView): UnitView | null {
  const min = ctx.cannonMin
  const max = u.attackRange
  let best: UnitView | null = null
  let bestScore = -Infinity

  for (const e of ctx.enemies) {
    if (!targetable(e)) continue
    const d = distance(u, e)
    if (d < min + 0.02 || d > max + e.radius - 0.02) continue
    let cluster = 0
    for (const o of ctx.enemies) {
      if (o.alive && distance(o, e) <= 1.15) cluster += valueOf(o) * 0.32
    }
    let score =
      cluster +
      valueOf(e) * 0.2 +
      (1 - e.hp / e.maxHp) * 1.4 -
      d * 0.07
    if (e.targetId === ctx.base.id) score += 2.6
    if (e.type === 'cannon') score += 1.8
    if (distance(e, ctx.base) < 4.5) score += 1.4
    if (score > bestScore) {
      bestScore = score
      best = e
    }
  }

  const eb = ctx.enemyBase
  if (eb.alive && eb.targetable && (ctx.stance === 'allin' || eb.hp < eb.maxHp * 0.45)) {
    const d = distance(u, eb)
    if (d >= min + 0.02 && d <= max + eb.radius - 0.02) {
      const score = 9 + (1 - eb.hp / eb.maxHp) * 9
      if (score > bestScore) best = eb
    }
  }
  return best
}

function cannonIntent(ctx: Ctx, u: UnitView): Intent {
  const min = ctx.cannonMin
  const threat = nearestOf(ctx.enemies, u)
  const threatD = threat ? distance(u, threat) : Infinity
  const slot = cannonSlot(ctx, u)
  const slotD = Math.hypot(slot.x - u.x, slot.y - u.y)

  if (u.form === 'deploying' || u.form === 'packing' || u.form === 'fleeing') return idle()

  const away = (): { x: number; y: number } => {
    const a = normalize(u.x - (threat?.x ?? u.x), u.y - (threat?.y ?? u.y))
    const h = normalize(u.homeX - u.x, u.homeY - u.y)
    return {
      x: u.x + a.x * 2.3 + h.x * 1.1,
      y: u.y + a.y * 2.3 + h.y * 1.1,
    }
  }

  if (u.form === 'siege') {
    // 被贴脸时收炮转移：siege 下给移动意图会触发 packing
    if (threatD < min * 1.02) {
      const p = away()
      return moveTo(p.x, p.y)
    }
    const target = artilleryTarget(ctx, u)
    if (target) return attackId(target.id)
    if (slotD > 2.0) return { type: 'undeploy' }
    return idle()
  }

  // mobile
  if (threatD < min * 1.18) {
    const p = away()
    return moveTo(p.x, p.y)
  }
  if (slotD > 0.5) return moveTo(slot.x, slot.y)
  if (artilleryTarget(ctx, u)) return { type: 'deploy' }
  return idle()
}

// ───────────────────────────── 突击组：推进 / 攻城 / 回防 ─────────────────────────────

/**
 * 中路诱饵兼门将：常驻河界己方一侧，只在己方半场接战、绝不追进敌方腹地。
 * 重点点名「正在打我基地」的单位——兵的击退与硬直能把对方攻城节奏直接打断。
 */
function guardIntent(ctx: Ctx, u: UnitView): Intent {
  let best: UnitView | null = null
  let bestScore = -Infinity
  for (const e of ctx.enemies) {
    if (!targetable(e)) continue
    const db = distance(e, ctx.base)
    if (db > 6.0) continue
    const d = distance(u, e)
    let score =
      -d * 0.6 -
      db * 0.45 +
      (1 - e.hp / e.maxHp) * 2.5 +
      valueOf(e) * 0.3
    if (e.targetId === ctx.base.id) score += 6
    if (e.type === 'cannon') score += 2
    if ((ctx.assigned.get(e.id) ?? 0) > e.hp * 0.9) score -= 2
    if (score > bestScore) {
      bestScore = score
      best = e
    }
  }
  if (best) {
    ctx.assigned.set(best.id, (ctx.assigned.get(best.id) ?? 0) + u.attackDamage)
    return attackId(best.id)
  }
  const slot = ctx.guardSlots.get(u.id) ?? { x: ctx.base.x, y: absY(ctx.snap, 5.4) }
  return Math.hypot(slot.x - u.x, slot.y - u.y) > 0.35 ? moveTo(slot.x, slot.y) : idle()
}

function defenseIntent(ctx: Ctx, u: UnitView): Intent {
  let best: UnitView | null = null
  let bestScore = -Infinity
  for (const e of ctx.enemies) {
    if (!targetable(e)) continue
    const db = distance(e, ctx.base)
    if (db > 7) continue
    const d = distance(u, e)
    let score =
      -d * 0.55 -
      db * 0.35 +
      (1 - e.hp / e.maxHp) * 3 +
      valueOf(e) * 0.35
    if (e.targetId === ctx.base.id) score += 3
    if (e.type === 'cannon' || e.type === 'rook') score += 1.2
    const a = ctx.assigned.get(e.id) ?? 0
    if (a > e.hp * 0.95) score -= 2.5
    else if (a > 0) score += 1
    if (score > bestScore) {
      bestScore = score
      best = e
    }
  }
  if (best) {
    ctx.assigned.set(best.id, (ctx.assigned.get(best.id) ?? 0) + u.attackDamage)
    return attackId(best.id)
  }
  const slot = { x: laneX(ctx, u), y: absY(ctx.snap, 6.2) }
  return Math.hypot(slot.x - u.x, slot.y - u.y) > 0.4 ? moveTo(slot.x, slot.y) : idle()
}

function assaultIntent(ctx: Ctx, u: UnitView): Intent {
  if (ctx.recall.has(u.id)) return defenseIntent(ctx, u)
  if (ctx.guards.has(u.id)) return guardIntent(ctx, u)
  if (ctx.stance === 'defend') return defenseIntent(ctx, u)
  const eb = ctx.enemyBase
  if (!eb.alive) return idle()

  // 士 / 象的复活读条是常规军的三到四倍，清掉它们等于给攻城组买一段无人干扰的窗口
  if (u.type === 'rook' && ctx.hunter === u.id) {
    let prey: UnitView | null = null
    let preyScore = Infinity
    for (const e of ctx.enemies) {
      if (!targetable(e) || (e.type !== 'advisor' && e.type !== 'elephant')) continue
      const d = distance(u, e)
      if (d > 3.4) continue
      const score = d + (e.type === 'elephant' ? 1.5 : 0) - (1 - e.hp / e.maxHp) * 1.5
      if (score < preyScore) {
        preyScore = score
        prey = e
      }
    }
    if (prey) return attackId(prey.id)
  }

  if (u.type === 'horse' && u.skillReady && u.jumpPhase === 'none' && u.stun <= 0) {
    const jmin = ctx.snap.rules.jumpMin
    const jmax = ctx.snap.rules.jumpMax
    const db = distance(u, eb)
    // 直接空降敌方基地：腾空不可选中，落地砸出攻城伤害并震晕守军
    if (eb.targetable && db >= jmin + 0.03 && db <= jmax - 0.03) {
      return { type: 'jump', targetId: eb.id }
    }
    // 否则跳敌阵前沿的高价值目标，落点仍在基地附近
    let best: UnitView | null = null
    let bestScore = 3.2
    for (const e of ctx.enemies) {
      if (!targetable(e)) continue
      const d = distance(u, e)
      if (d < jmin + 0.05 || d > jmax - 0.05) continue
      const dToBase = distance(e, eb)
      if (dToBase > 4) continue
      const score =
        valueOf(e) * 0.5 +
        (1 - e.hp / e.maxHp) * 3 +
        (e.type === 'cannon' ? 2.2 : 0) +
        (4 - dToBase) * 0.35
      if (score > bestScore) {
        bestScore = score
        best = e
      }
    }
    if (best) return { type: 'jump', targetId: best.id }
  }

  // 以基地为意图目标：路上自动清理挡路者，进入攻击圈后强制集火基地
  return attackId(eb.id)
}

// ───────────────────────────── 策略出口 ─────────────────────────────

export const hy4DominionTactic: Tactic = {
  id: 'hy4-dominion',
  name: '混元·破阵',
  author: '腾讯混元 HY4',
  version: '1.0.0',
  description:
    '腾讯混元 HY4 的强攻型打法：不做对称对轰，把车马兵编成一条以敌方基地为唯一意图目标的攻城流水线——路上由引擎自动清障，贴脸后强制集火基地；马在跃击窗口内直接空降基地，落地砸出攻城伤害并附带范围硬直，另派一台车专杀贴基地的士象（精英复活极慢，清掉就能开窗输出）。炮守在己方半场架成交叉火力清集群兼护后院，只在收官或加时明显落后时前压轰城；士锚在入侵者与我方基地之间，象抢占前哨星位用落地震晕守家，基地炮塔优先点名正在攻城的人。开局 7 秒探测对手是全军压上还是龟缩：压上型只召回离基地最近的几个单位清入侵者、其余继续攻城，并留一个廉价兵常驻中路当诱饵；加时保持既定攻势，不做临时全员回防。难度中高，擅长打内置标尺与偏防守的打法，弱点是被极端换家拖进后院消耗。全程只表达白名单意图，不用随机数与系统时钟。',
  accent: 'gold',
  glyph: '混',
  createMemory: () =>
    ({
      stance: 'push',
      candidate: 'push',
      candidateSince: 0,
      initialized: false,
      claims: {},
      mode: 'probe',
      probeAccum: 0,
      probeTicks: 0,
    }) as unknown as TacticMemory,
  decide(snap: Snapshot, memory: TacticMemory): IntentMap {
    const mem = memory as unknown as HyMemory
    if (!mem.initialized) {
      mem.initialized = true
      mem.stance = 'push'
      mem.candidate = 'push'
      mem.candidateSince = snap.time
      mem.claims = {}
      mem.mode = 'probe'
      mem.probeAccum = 0
      mem.probeTicks = 0
    }

    // 开局 7 秒数「越过河界进入我方半场的敌人」：
    // 全军冲锋型会成群涌入，防守反击型则始终窝在自己半场。
    const invaders = snap.enemies.filter((e) =>
      snap.team === 'red' ? e.y >= snap.board.riverY : e.y <= snap.board.riverY,
    ).length
    if (mem.mode === 'probe') {
      mem.probeAccum += invaders
      mem.probeTicks++
      if (snap.time >= 7) {
        mem.mode = mem.probeAccum / Math.max(1, mem.probeTicks) >= 1.2 ? 'counterPunch' : 'rush'
      }
    } else if (mem.mode === 'counterPunch') {
      // 入侵者被清干净就立刻反推；拖太久则无条件转攻，避免加时带着满血敌基地开局
      if ((invaders <= 1 && snap.time > 18) || snap.time > 32) mem.mode = 'rush'
    }

    // 中路诱饵组：取名册中最靠前的若干兵与车，阵亡也不改变分工
    const pawnIds = snap.allies
      .filter((a) => a.type === 'pawn')
      .sort((a, b) => a.id - b.id)
      .slice(0, GUARD_PAWNS)
    const rookIds = snap.allies
      .filter((a) => a.type === 'rook')
      .sort((a, b) => a.id - b.id)
      .slice(0, GUARD_ROOKS)
    const guardIds = [...pawnIds, ...rookIds].map((u) => u.id)
    const guards = new Set(guardIds)
    const guardSlots = new Map<number, { x: number; y: number }>()
    guardIds.forEach((id, i) => {
      const x = guardIds.length > 1 ? 1.8 + (i / (guardIds.length - 1)) * 4.4 : 4
      guardSlots.set(id, { x, y: absY(snap, 5.4) })
    })

    // 只召回「离自家基地最近」的几个突击单位：折返路程最短，且不打断整条攻城线
    const recall = new Set<number>()
    if (mem.mode === 'counterPunch') {
      const rushers = snap.allies
        .filter(
          (a) =>
            a.alive &&
            !guards.has(a.id) &&
            (a.type === 'rook' || a.type === 'horse' || a.type === 'pawn'),
        )
        .sort((a, b) => distance(a, snap.myBase) - distance(b, snap.myBase))
      for (const u of rushers.slice(0, 4)) recall.add(u.id)
    }

    const hunter =
      snap.allies
        .filter((a) => a.type === 'rook' && !guards.has(a.id))
        .sort((a, b) => a.id - b.id)[0]?.id ?? null

    const ctx: Ctx = {
      snap,
      mem,
      base: snap.myBase,
      enemyBase: snap.enemyBase,
      enemies: snap.enemies.filter((e) => e.alive),
      allies: snap.allies.filter((a) => a.alive),
      roster: snap.allies,
      stance: mem.stance,
      reserved: new Set<string>(),
      assigned: new Map<number, number>(),
      guards,
      guardSlots,
      recall,
      hunter,
      guard: snap.rules.advisorGuardRadius,
      cannonMin: snap.rules.cannonMinRange,
      turretRange: snap.rules.baseTurretRange,
    }
    updateStance(ctx)
    ctx.stance = mem.stance

    const intents: IntentMap = {}
    intents[ctx.base.id] = baseIntent(ctx)

    const ordered = [...ctx.allies].sort(
      (a, b) => (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9) || a.id - b.id,
    )
    for (const u of ordered) {
      switch (u.type) {
        case 'advisor':
          intents[u.id] = advisorIntent(ctx, u)
          break
        case 'elephant':
          intents[u.id] = elephantIntent(ctx, u)
          break
        case 'cannon':
          intents[u.id] = cannonIntent(ctx, u)
          break
        default:
          intents[u.id] = assaultIntent(ctx, u)
      }
    }
    return intents
  },
}
