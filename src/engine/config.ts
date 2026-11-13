import type { FieldUnitType, UnitType } from './types'
import { BOARD_H, BOARD_W, RIVER_Y } from './board'

export interface CleaveDef {
  radius: number
  factor: number
}

export interface ConeDef {
  /** 扇形总张角（弧度） */
  angle: number
  /** 最远处的伤害系数 */
  minFactor: number
}

export interface ProjectileDef {
  speed: number
  splash: number
}

export interface JumpDef {
  minRange: number
  maxRange: number
  windup: number
  dash: number
  recover: number
  damage: number
  radius: number
  stun: number
  cooldown: number
}

export interface TeleportDef {
  windup: number
  damage: number
  radius: number
  stun: number
  cooldown: number
}

export interface DeployDef {
  deployTime: number
  packTime: number
  fleeTime: number
  fleeSpeed: number
  minRange: number
}

export interface RegenDef {
  rate: number
  delay: number
}

/** 护卫防区：以己方基地为圆心的可活动范围 */
export interface GuardDef {
  /** 半径：士只能在基地周围这么远的地方活动 */
  radius: number
  /** 巡游环半径：不接敌时绕着基地转的圈 */
  orbit: number
}

export interface UnitDef {
  name: string
  hp: number
  radius: number
  mass: number
  speed: number
  /** 攻击距离（中心距 + 目标半径） */
  range: number
  damage: number
  cooldown: number
  knockback: number
  stun: number
  cleave?: CleaveDef
  cone?: ConeDef
  projectile?: ProjectileDef
  jump?: JumpDef
  teleport?: TeleportDef
  regen?: RegenDef
  deploy?: DeployDef
  guard?: GuardDef
  /** 常规军的复活读条；0 表示本局不再归队 */
  respawn: number
  elite: boolean
}

export interface BattleConfig {
  version: number
  board: {
    width: number
    height: number
    riverY: number
  }
  match: {
    /** 常规局时（秒）；null 表示不限时 */
    duration: number | null
    /** 加时双方基地每秒流血 */
    overtimeBleed: number
    /** 加时复活读条倍率 */
    overtimeRespawnScale: number
    /** 安全上限（秒），兜底裁决 */
    safetyCap: number
  }
  physics: {
    step: number
    decisionInterval: number
    acceleration: number
    separation: number
    combatSlow: number
    knockbackDecay: number
  }
  combat: {
    siegeMultiplier: number
    cannonVulnerable: number
    elephantVulnerable: number
    healRate: number
    healDelay: number
    healRadius: number
    eliteRegenDelay: number
  }
  base: {
    hp: number
    radius: number
    turret: {
      range: number
      damage: number
      cooldown: number
      projectileSpeed: number
    }
  }
  units: Record<FieldUnitType, UnitDef>
}

export const DEFAULT_CONFIG: BattleConfig = {
  version: 1,
  board: { width: BOARD_W, height: BOARD_H, riverY: RIVER_Y },
  match: {
    duration: 120,
    overtimeBleed: 120,
    overtimeRespawnScale: 0.3,
    safetyCap: 420,
  },
  physics: {
    step: 1 / 60,
    decisionInterval: 0.125,
    acceleration: 11,
    separation: 0.85,
    combatSlow: 0.6,
    knockbackDecay: 7,
  },
  combat: {
    siegeMultiplier: 1.8,
    cannonVulnerable: 1.32,
    elephantVulnerable: 1.28,
    healRate: 52,
    healDelay: 4,
    healRadius: 0.55,
    eliteRegenDelay: 5,
  },
  base: {
    hp: 3000,
    radius: 0.62,
    turret: {
      range: 3.8,
      damage: 24,
      cooldown: 0.72,
      projectileSpeed: 12,
    },
  },
  units: {
    rook: {
      name: '车',
      hp: 640,
      radius: 0.3,
      mass: 3.4,
      speed: 1.62,
      range: 0.76,
      damage: 42,
      cooldown: 0.86,
      knockback: 1.5,
      stun: 0,
      cleave: { radius: 0.92, factor: 0.55 },
      respawn: 18,
      elite: false,
    },
    horse: {
      name: '马',
      hp: 430,
      radius: 0.29,
      mass: 2.3,
      speed: 1.78,
      range: 0.76,
      damage: 25,
      cooldown: 0.94,
      knockback: 1.2,
      stun: 0,
      jump: {
        minRange: 1.15,
        maxRange: 3.35,
        windup: 0.42,
        dash: 0.24,
        recover: 0.62,
        damage: 68,
        radius: 1.05,
        stun: 0.55,
        cooldown: 6.5,
      },
      respawn: 17,
      elite: false,
    },
    cannon: {
      name: '炮',
      hp: 320,
      radius: 0.37,
      mass: 2.8,
      speed: 1.02,
      range: 3.35,
      damage: 70,
      cooldown: 2.2,
      knockback: 1.4,
      stun: 0,
      projectile: { speed: 10, splash: 1.12 },
      deploy: {
        deployTime: 0.6,
        packTime: 0.9,
        fleeTime: 1.1,
        fleeSpeed: 2.15,
        minRange: 1.35,
      },
      respawn: 14,
      elite: false,
    },
    pawn: {
      name: '兵',
      hp: 340,
      radius: 0.26,
      mass: 1.8,
      speed: 1.16,
      range: 0.6,
      damage: 17,
      cooldown: 0.68,
      knockback: 3.4,
      stun: 0.32,
      respawn: 13,
      elite: false,
    },
    advisor: {
      name: '士',
      hp: 580,
      radius: 0.3,
      mass: 2,
      speed: 1.52,
      range: 2.15,
      damage: 38,
      cooldown: 1.12,
      knockback: 2.2,
      stun: 0,
      cone: { angle: 1.2, minFactor: 0.36 },
      regen: { rate: 7, delay: 5 },
      guard: { radius: 2.35, orbit: 1.55 },
      respawn: 45,
      elite: true,
    },
    elephant: {
      name: '象',
      hp: 980,
      radius: 0.42,
      mass: 8,
      speed: 0,
      range: 0.96,
      damage: 30,
      cooldown: 1.25,
      knockback: 2.4,
      stun: 0,
      teleport: {
        windup: 0.8,
        damage: 42,
        radius: 1.5,
        stun: 0.9,
        cooldown: 7.5,
      },
      regen: { rate: 9, delay: 5 },
      respawn: 60,
      elite: true,
    },
  },
}

export interface UnitMeta {
  name: string
  chars: Record<'red' | 'black', string>
  role: string
  blurb: string
  color?: string
}

export const UNIT_META: Record<UnitType, UnitMeta> = {
  base: {
    name: '基地',
    chars: { red: '帅', black: '将' },
    role: '胜负核心',
    blurb: '不可移动的炮塔与命脉。基地告破即战败，无法回血。',
  },
  rook: {
    name: '车',
    chars: { red: '车', black: '车' },
    role: '近战主力',
    blurb: '高速突进，劈砍会波及目标身边的敌人。怕集火，怕被风筝。',
  },
  horse: {
    name: '马',
    chars: { red: '马', black: '马' },
    role: '跃击刺客',
    blurb: '腾空时不可被选中，落地范围震击。起跳有距离窗口，落地有真空期。',
  },
  cannon: {
    name: '炮',
    chars: { red: '炮', black: '炮' },
    role: '攻城火力',
    blurb:
      '架起后远程高爆，不需要炮架。射程只够压到对面半场，能打到基地的位置，也一定在基地炮塔射程内。',
  },
  pawn: {
    name: '兵',
    chars: { red: '兵', black: '卒' },
    role: '前排消耗',
    blurb: '廉价、量大，攻击附带击退与短暂硬直，能打断敌方节奏。',
  },
  advisor: {
    name: '士',
    chars: { red: '士', black: '士' },
    role: '巡防护卫',
    blurb:
      '只能在基地周围巡防，绕圈走位、绝不站桩。扇形霰弹越近越痛；一旦阵亡，很久才能归队。',
  },
  elephant: {
    name: '象',
    chars: { red: '象', black: '象' },
    role: '星位重装',
    blurb: '不能行走，只能在己方星位间传送。落地震晕周围敌人，脱战自愈。',
  },
}

export interface MatchOptions {
  /** 秒；0 表示不限时 */
  duration: number
  baseHpMul: number
  damageMul: number
  respawnMul: number
  bleedMul: number
}

export const DEFAULT_MATCH_OPTIONS: MatchOptions = {
  duration: 120,
  baseHpMul: 1,
  damageMul: 1,
  respawnMul: 1,
  bleedMul: 1,
}

export function buildConfig(options: Partial<MatchOptions> = {}): BattleConfig {
  const o = { ...DEFAULT_MATCH_OPTIONS, ...options }
  const cfg = structuredClone(DEFAULT_CONFIG)
  cfg.match.duration = o.duration <= 0 ? null : o.duration
  cfg.base.hp = Math.round(cfg.base.hp * clamp(o.baseHpMul, 0.4, 2.5))
  cfg.match.overtimeBleed *= clamp(o.bleedMul, 0.4, 2.5)
  for (const key of Object.keys(cfg.units) as FieldUnitType[]) {
    const u = cfg.units[key]
    u.damage *= clamp(o.damageMul, 0.5, 2)
    if (u.jump) u.jump.damage *= clamp(o.damageMul, 0.5, 2)
    if (u.teleport) u.teleport.damage *= clamp(o.damageMul, 0.5, 2)
    if (u.respawn > 0) u.respawn *= clamp(o.respawnMul, 0.4, 2.5)
  }
  cfg.base.turret.damage *= clamp(o.damageMul, 0.5, 2)
  return cfg
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

export interface ConfigIssue {
  path: string
  message: string
}

export function validateConfig(cfg: BattleConfig): ConfigIssue[] {
  const issues: ConfigIssue[] = []
  const need = (ok: boolean, path: string, message: string) => {
    if (!ok) issues.push({ path, message })
  }
  need(cfg.version === 1, 'version', `不支持的配置版本：${cfg.version}，期望 1`)
  need(cfg.board.width === BOARD_W, 'board.width', `棋盘宽度必须是 ${BOARD_W}`)
  need(cfg.board.height === BOARD_H, 'board.height', `棋盘高度必须是 ${BOARD_H}`)
  need(cfg.board.riverY > 0 && cfg.board.riverY < BOARD_H, 'board.riverY', '河界必须在棋盘内')
  need(cfg.physics.step > 0 && cfg.physics.step <= 0.05, 'physics.step', '固定步长应在 (0, 0.05]')
  need(
    cfg.physics.decisionInterval >= cfg.physics.step * 2,
    'physics.decisionInterval',
    '决策间隔不能小于两个物理步',
  )
  need(cfg.base.hp > 0, 'base.hp', '基地血量必须为正')
  need(cfg.base.radius > 0.2 && cfg.base.radius < 2, 'base.radius', '基地半径应在 (0.2, 2)')
  need(cfg.match.overtimeBleed > 0, 'match.overtimeBleed', '加时流血必须为正')
  for (const key of Object.keys(cfg.units) as FieldUnitType[]) {
    const u = cfg.units[key]
    const p = `units.${key}`
    need(u.hp > 0, `${p}.hp`, '血量必须为正')
    need(u.radius > 0.1, `${p}.radius`, '半径必须大于 0.1')
    need(u.mass > 0, `${p}.mass`, '质量必须为正')
    need(u.speed >= 0, `${p}.speed`, '移速不能为负')
    need(u.range > 0, `${p}.range`, '射程必须为正')
    need(u.damage > 0, `${p}.damage`, '伤害必须为正')
    need(u.cooldown > 0, `${p}.cooldown`, '攻击冷却必须为正')
    need(u.respawn >= 0, `${p}.respawn`, '复活读条不能为负')
    if (u.guard) {
      need(u.guard.orbit > 0, `${p}.guard.orbit`, '巡游环半径必须为正')
      need(u.guard.orbit < u.guard.radius, `${p}.guard.orbit`, '巡游环必须落在防区之内')
      need(u.guard.radius > u.range * 0.5, `${p}.guard.radius`, '防区半径不能小于射程的一半')
    }
    if (u.jump) {
      need(u.jump.maxRange > u.jump.minRange, `${p}.jump.maxRange`, '跃击距离窗口必须有效')
      need(u.jump.damage > 0, `${p}.jump.damage`, '跃击伤害必须为正')
    }
    if (u.deploy) {
      need(u.deploy.minRange > 0, `${p}.deploy.minRange`, '盲区必须为正')
      need(u.deploy.minRange < u.range, `${p}.deploy.minRange`, '盲区必须小于射程')
    }
    if (u.teleport) {
      need(u.teleport.radius > 0, `${p}.teleport.radius`, '传送震击半径必须为正')
    }
  }
  // 几何契约：炮能打到基地的站位，必然落在基地炮塔的射程内，不存在绝对安全的吊射位
  const cannonReach = cfg.units.cannon.range + cfg.base.radius
  const turretReach = cfg.base.turret.range + cfg.units.cannon.radius
  need(
    cannonReach <= turretReach,
    'units.cannon.range',
    `炮射程 ${cfg.units.cannon.range.toFixed(2)} 会让它在炮塔射程外吊射基地（上限 ${(turretReach - cfg.base.radius).toFixed(2)}）`,
  )
  return issues
}
