/** 阵营、兵种、单位状态与意图 —— 引擎与表现层共享的类型定义 */

export type Team = 'red' | 'black'
export const TEAMS: readonly Team[] = ['red', 'black'] as const

export type UnitType = 'base' | 'rook' | 'horse' | 'cannon' | 'pawn' | 'advisor' | 'elephant'
export type FieldUnitType = Exclude<UnitType, 'base'>

export const FIELD_TYPES: readonly FieldUnitType[] = [
  'rook',
  'horse',
  'cannon',
  'pawn',
  'advisor',
  'elephant',
] as const

export type CannonForm = 'mobile' | 'deploying' | 'siege' | 'packing' | 'fleeing'
export type JumpPhase = 'none' | 'windup' | 'dash' | 'recover'
export type TeleportPhase = 'none' | 'windup'

export interface IntentMove {
  type: 'move'
  x: number
  y: number
}
export interface IntentMoveDir {
  type: 'moveDir'
  x: number
  y: number
}
export interface IntentAttack {
  type: 'attack'
  targetId: number
}
export interface IntentDeploy {
  type: 'deploy'
}
export interface IntentUndeploy {
  type: 'undeploy'
}
export interface IntentJump {
  type: 'jump'
  targetId: number
}
export interface IntentTeleport {
  type: 'teleport'
  starId: string
}
export interface IntentIdle {
  type: 'idle'
}
export type Intent =
  | IntentMove
  | IntentMoveDir
  | IntentAttack
  | IntentDeploy
  | IntentUndeploy
  | IntentJump
  | IntentTeleport
  | IntentIdle

export type RejectReason =
  | 'unknown-unit'
  | 'not-yours'
  | 'dead'
  | 'unknown-action'
  | 'missing-param'
  | 'illegal-target'
  | 'out-of-window'
  | 'cooldown'
  | 'star-not-adjacent'
  | 'star-occupied'
  | 'form-not-allowed'
  | 'immobile'
  | 'busy'
  | 'bad-param'

export interface Unit {
  id: number
  team: Team
  type: UnitType
  x: number
  y: number
  vx: number
  vy: number
  /** 击退冲量（格/秒），指数衰减 */
  kvx: number
  kvy: number
  hp: number
  maxHp: number
  radius: number
  mass: number
  facing: number
  /** 攻击冷却剩余 */
  cooldown: number
  /** 表现用：攻击后摇计时（>0 时做前冲动画） */
  attackAnim: number
  hitTimer: number
  healTimer: number
  stun: number
  outOfCombat: number
  alive: boolean
  respawnTimer: number
  spawnX: number
  spawnY: number
  homeX: number
  homeY: number
  form: CannonForm
  formTimer: number
  pendingFlee: boolean
  jumpPhase: JumpPhase
  jumpTimer: number
  jumpTargetId: number | null
  jumpFromX: number
  jumpFromY: number
  jumpToX: number
  jumpToY: number
  skillCooldown: number
  /** 士的巡游：当前巡防点索引（0/1）与是否正在守点 */
  patrolStep: number
  guardHold: boolean
  tpPhase: TeleportPhase
  tpTimer: number
  tpStarId: string | null
  tpToX: number
  tpToY: number
  intent: Intent | null
  targetId: number | null
  damageDealt: number
  siegeDamage: number
  kills: number
  deaths: number
  respawns: number
  jumpCasts: number
  jumpHits: number
  deployedDeaths: number
  isElite: boolean
  isBase: boolean
}

export interface Projectile {
  id: number
  ownerId: number
  team: Team
  kind: 'shell' | 'bolt'
  x: number
  y: number
  targetX: number
  targetY: number
  targetId: number | null
  speed: number
  damage: number
  splashRadius: number
  startX: number
  startY: number
  alive: boolean
}

export interface TypeStats {
  initial: number
  alive: number
  damage: number
  siege: number
  kills: number
  deaths: number
  respawns: number
  jumpCasts: number
  jumpHits: number
  deployedDeaths: number
}

export interface TeamStats {
  damage: number
  siege: number
  kills: number
  deaths: number
  rejections: number
  decisions: number
  errors: number
  lastDecisionMs: number
  byType: Record<UnitType, TypeStats>
  rejectSamples: Array<{ reason: string; detail: string; count: number }>
}

export type BattlePhase = 'normal' | 'overtime' | 'ended'
export type EndReason = 'base-destroyed' | 'overtime-bleed' | 'safety-cap'

export interface BaseState {
  team: Team
  id: number
  x: number
  y: number
  hp: number
  maxHp: number
}

export interface BattleEvent {
  type:
    | 'attack'
    | 'shoot'
    | 'hit'
    | 'death'
    | 'respawn'
    | 'deploy'
    | 'pack'
    | 'flee'
    | 'jump'
    | 'teleport'
    | 'impact'
    | 'heal'
    | 'base-hit'
    | 'overtime'
    | 'end'
    | 'reject'
  unitId?: number
  targetId?: number
  team?: Team
  unitType?: UnitType
  x?: number
  y?: number
  tx?: number
  ty?: number
  amount?: number
  lethal?: boolean
  phase?: string
  reason?: string
  winner?: Team
  meta?: string
}

export interface BattleSummary {
  winner: Team | null
  reason: EndReason | null
  duration: number
  phase: BattlePhase
  redBaseHp: number
  blackBaseHp: number
  redBaseMax: number
  blackBaseMax: number
  redAlive: number
  blackAlive: number
  seed: number
  configFingerprint: string
  stats: Record<Team, TeamStats>
}
