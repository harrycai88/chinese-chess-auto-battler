export { BattleEngine } from './battle'
export type { BattleSetup } from './battle'
export {
  DEFAULT_CONFIG,
  DEFAULT_MATCH_OPTIONS,
  UNIT_META,
  buildConfig,
  validateConfig,
} from './config'
export type { BattleConfig, MatchOptions, UnitDef, UnitMeta, ConfigIssue } from './config'
export { BOARD_W, BOARD_H, RIVER_Y, STAR_POINTS, BASE_POS, PALACE, formationFor } from './board'
export { runMatch, runBatch } from './simulate'
export type { MatchRun, BatchResult } from './simulate'
export {
  ALL_TACTICS,
  BUILTIN_TACTICS,
  EXTERNAL_TACTICS,
  TACTIC_ISSUES,
  buildRegistry,
  findTactic,
  getTactic,
  validateTactic,
} from './tactics'
export type {
  RegisteredTactic,
  Tactic,
  TacticAccent,
  TacticSource,
  Snapshot,
  UnitView,
  IntentMap,
} from './tactics/api'
export type { TacticGroup, RegistryResult } from './tactics/registry'
export * from './types'
