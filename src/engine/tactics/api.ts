import type {
  BattlePhase,
  CannonForm,
  FieldUnitType,
  Intent,
  JumpPhase,
  Team,
  TeleportPhase,
  UnitType,
} from '../types'

export type { Intent } from '../types'

/** 策略可见的只读单位视图。快照每次决策重建，改它不影响战局。 */
export interface UnitView {
  id: number
  team: Team
  type: UnitType
  x: number
  y: number
  hp: number
  maxHp: number
  radius: number
  mass: number
  speed: number
  attackRange: number
  attackDamage: number
  attackCooldown: number
  /** 攻击间隔（数值源中的冷却），用于估算 DPS */
  attackInterval: number
  form: CannonForm
  jumpPhase: JumpPhase
  teleportPhase: TeleportPhase
  stun: number
  alive: boolean
  /** 距离复活还有多久；-1 表示本局不再归队 */
  respawnIn: number
  outOfCombat: number
  skillReady: boolean
  skillCooldown: number
  skillCooldownMax: number
  isElite: boolean
  isBase: boolean
  targetable: boolean
  facing: number
  targetId: number | null
  homeX: number
  homeY: number
}

export interface StarView {
  id: string
  x: number
  y: number
  neighbors: string[]
  occupiedBy: number | null
  /** 若邻接星位，落地震击能覆盖多少敌人 */
  nearbyEnemies: number
}

export interface SnapshotRules {
  siegeMultiplier: number
  healRate: number
  healDelay: number
  healRadius: number
  eliteRegenDelay: number
  overtimeBleed: number
  overtimeRespawnScale: number
  baseTurretRange: number
  baseTurretDamage: number
  baseTurretCooldown: number
  cannonMinRange: number
  cannonRange: number
  jumpMin: number
  jumpMax: number
  respawn: Record<FieldUnitType, number>
}

export interface Snapshot {
  time: number
  phase: BattlePhase
  duration: number | null
  remaining: number
  overtimeElapsed: number
  team: Team
  enemyTeam: Team
  board: { width: number; height: number; riverY: number }
  palace: { x0: number; x1: number; y0: number; y1: number }
  myBase: UnitView
  enemyBase: UnitView
  allies: UnitView[]
  enemies: UnitView[]
  stars: StarView[]
  rules: SnapshotRules
}

export type TacticMemory = Record<string, unknown>
export type IntentMap = Record<number, Intent>

export interface Tactic {
  id: string
  name: string
  author: string
  version: string
  description: string
  style: string
  complexity: number
  tags: string[]
  accent: 'vermilion' | 'jade' | 'gold' | 'ink'
  createMemory: () => TacticMemory
  decide: (snapshot: Snapshot, memory: TacticMemory) => IntentMap
}

export const distance = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
  Math.hypot(a.x - b.x, a.y - b.y)

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

export function normalize(x: number, y: number): { x: number; y: number; len: number } {
  const len = Math.hypot(x, y)
  if (len < 1e-6) return { x: 0, y: 0, len: 0 }
  return { x: x / len, y: y / len, len }
}

/** 估算单位持续输出（用于威胁评估，不含技能） */
export function dpsOf(u: UnitView): number {
  if (u.isBase) return 30
  const cd = u.attackInterval > 0 ? u.attackInterval : 1
  if (u.type === 'cannon') return (u.attackDamage * 1.25) / cd
  if (u.type === 'advisor') return (u.attackDamage * 0.55) / cd
  return u.attackDamage / cd
}

/** 战术价值：越贵、越关键的兵种分越高 */
export function valueOf(u: UnitView): number {
  switch (u.type) {
    case 'base':
      return 40
    case 'cannon':
      return 9
    case 'rook':
      return 7.5
    case 'horse':
      return 5.5
    case 'elephant':
      return 5
    case 'advisor':
      return 3.5
    case 'pawn':
      return 2
  }
}
