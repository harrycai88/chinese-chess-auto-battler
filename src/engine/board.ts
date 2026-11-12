import type { FieldUnitType, Team } from './types'

/** 逻辑棋盘：9 列 × 10 行交叉点 => x ∈ [0,8]，y ∈ [0,9] */
export const BOARD_W = 8
export const BOARD_H = 9
export const RIVER_Y = 4.5

export interface Point {
  x: number
  y: number
}

export const BASE_POS: Record<Team, Point> = {
  red: { x: 4, y: 8 },
  black: { x: 4, y: 1 },
}

export const PALACE: Record<Team, { x0: number; x1: number; y0: number; y1: number }> = {
  red: { x0: 3, x1: 5, y0: 7, y1: 9 },
  black: { x0: 3, x1: 5, y0: 0, y1: 2 },
}

export const mirrorY = (y: number): number => BOARD_H - y

export interface FormationEntry {
  type: FieldUnitType
  x: number
  y: number
}

export const FORMATION_RED: readonly FormationEntry[] = [
  { type: 'advisor', x: 3, y: 9 },
  { type: 'advisor', x: 5, y: 9 },
  { type: 'elephant', x: 2, y: 9 },
  { type: 'elephant', x: 6, y: 9 },
  { type: 'rook', x: 0, y: 9 },
  { type: 'rook', x: 8, y: 9 },
  { type: 'horse', x: 1, y: 9 },
  { type: 'horse', x: 7, y: 9 },
  { type: 'cannon', x: 1, y: 7 },
  { type: 'cannon', x: 7, y: 7 },
  { type: 'pawn', x: 0, y: 6 },
  { type: 'pawn', x: 2, y: 6 },
  { type: 'pawn', x: 4, y: 6 },
  { type: 'pawn', x: 6, y: 6 },
  { type: 'pawn', x: 8, y: 6 },
]

export function formationFor(team: Team): FormationEntry[] {
  if (team === 'red') return FORMATION_RED.map((e) => ({ ...e }))
  return FORMATION_RED.map((e) => ({ type: e.type, x: e.x, y: mirrorY(e.y) }))
}

export interface StarPoint {
  id: string
  x: number
  y: number
  neighbors: string[]
}

/** 象的七个落点（己方半场）。只有相差一个「田」字的星位互通。 */
export const STAR_POINTS: Record<Team, StarPoint[]> = {
  red: [
    { id: '0,7', x: 0, y: 7, neighbors: ['2,5', '2,9'] },
    { id: '2,5', x: 2, y: 5, neighbors: ['0,7', '4,7'] },
    { id: '4,7', x: 4, y: 7, neighbors: ['2,5', '2,9', '6,5', '6,9'] },
    { id: '6,5', x: 6, y: 5, neighbors: ['4,7', '8,7'] },
    { id: '8,7', x: 8, y: 7, neighbors: ['6,5', '6,9'] },
    { id: '2,9', x: 2, y: 9, neighbors: ['0,7', '4,7'] },
    { id: '6,9', x: 6, y: 9, neighbors: ['4,7', '8,7'] },
  ],
  black: [
    { id: '0,2', x: 0, y: 2, neighbors: ['2,4', '2,0'] },
    { id: '2,4', x: 2, y: 4, neighbors: ['0,2', '4,2'] },
    { id: '4,2', x: 4, y: 2, neighbors: ['2,4', '2,0', '6,4', '6,0'] },
    { id: '6,4', x: 6, y: 4, neighbors: ['4,2', '8,2'] },
    { id: '8,2', x: 8, y: 2, neighbors: ['6,4', '6,0'] },
    { id: '2,0', x: 2, y: 0, neighbors: ['0,2', '4,2'] },
    { id: '6,0', x: 6, y: 0, neighbors: ['4,2', '8,2'] },
  ],
}

export function starAt(team: Team, x: number, y: number): StarPoint | null {
  return STAR_POINTS[team].find((s) => Math.abs(s.x - x) < 0.01 && Math.abs(s.y - y) < 0.01) ?? null
}

export function isInOwnHalf(team: Team, y: number): boolean {
  return team === 'red' ? y >= RIVER_Y : y <= RIVER_Y
}

export function clampPointToBoard(x: number, y: number, radius: number): Point {
  return {
    x: Math.min(BOARD_W - radius, Math.max(radius, x)),
    y: Math.min(BOARD_H - radius, Math.max(radius, y)),
  }
}

export function clampPointToPalace(team: Team, x: number, y: number, radius: number): Point {
  const p = PALACE[team]
  return {
    x: Math.min(p.x1 - radius, Math.max(p.x0 + radius, x)),
    y: Math.min(p.y1 - radius, Math.max(p.y0 + radius, y)),
  }
}
