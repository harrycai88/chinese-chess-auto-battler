import type { BattleConfig } from '../engine/config'
import type { RenderOptions } from '../render/renderer'

export interface LaunchOptions {
  config: BattleConfig
  redId: string
  blackId: string
  seed: number
  speed: number
  muted: boolean
  render: RenderOptions
}

export interface SavedSettings {
  redId: string
  blackId: string
  duration: number
  speed: number
  muted: boolean
  baseHpMul: number
  damageMul: number
  respawnMul: number
  bleedMul: number
  damageNumbers: boolean
  effects: boolean
  intentLines: boolean
}
