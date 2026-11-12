import type { BattleEngine } from '../engine/battle'
import type { BattleEvent, Team, Unit, UnitType } from '../engine/types'
import { BOARD_H, BOARD_W, RIVER_Y } from '../engine/board'

export interface RenderOptions {
  damageNumbers: boolean
  intentLines: boolean
  effects: boolean
}

interface Visual {
  x: number
  y: number
  scale: number
  born: number
}

interface RingFx {
  x: number
  y: number
  r0: number
  r1: number
  age: number
  life: number
  color: string
  width: number
  fill?: string
}

interface ParticleFx {
  x: number
  y: number
  vx: number
  vy: number
  age: number
  life: number
  size: number
  color: string
  gravity: number
  drag: number
}

interface TextFx {
  x: number
  y: number
  text: string
  age: number
  life: number
  color: string
  size: number
}

interface SlashFx {
  x: number
  y: number
  angle: number
  radius: number
  spread: number
  age: number
  life: number
  color: string
  width: number
}

interface BeamFx {
  x: number
  y: number
  w: number
  h: number
  age: number
  life: number
  color: string
}

interface GhostFx {
  x: number
  y: number
  type: UnitType
  team: Team
  age: number
  life: number
  scale: number
}

interface MuzzleFx {
  x: number
  y: number
  angle: number
  age: number
  life: number
  color: string
}

const TEAM = {
  red: {
    rim: '#8f2a20',
    rim2: '#c0503f',
    face: '#f7e9d0',
    face2: '#e1c79f',
    ink: '#a52c22',
    glow: 'rgba(192,80,63,.55)',
    soft: 'rgba(192,80,63,.16)',
  },
  black: {
    rim: '#1b1b1f',
    rim2: '#45454e',
    face: '#f3e8d4',
    face2: '#d9c6a6',
    ink: '#23232a',
    glow: 'rgba(80,80,96,.45)',
    soft: 'rgba(40,40,52,.14)',
  },
} as const

const CHARS: Record<UnitType, Record<Team, string>> = {
  base: { red: '帅', black: '将' },
  rook: { red: '车', black: '车' },
  horse: { red: '马', black: '马' },
  cannon: { red: '炮', black: '炮' },
  pawn: { red: '兵', black: '卒' },
  advisor: { red: '士', black: '士' },
  elephant: { red: '象', black: '象' },
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

function rgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
}

/**
 * Canvas 2D 战场渲染。只读引擎状态与事件，从不回写。
 * 表现全部可降级：关掉特效与伤害数字，判定分毫不差。
 */
export class BattleRenderer {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private engine: BattleEngine
  private options: RenderOptions
  private dpr = 1
  private width = 0
  private height = 0
  private cell = 60
  private ox = 0
  private oy = 0
  private last = 0
  private now = 0
  private visual = new Map<number, Visual>()
  private sprites = new Map<string, HTMLCanvasElement>()
  private rings: RingFx[] = []
  private particles: ParticleFx[] = []
  private texts: TextFx[] = []
  private slashes: SlashFx[] = []
  private beams: BeamFx[] = []
  private ghosts: GhostFx[] = []
  private muzzles: MuzzleFx[] = []
  private shake = 0
  private baseFlash: Record<Team, number> = { red: 0, black: 0 }
  private lastTextAt = new Map<number, number>()
  private wood: HTMLCanvasElement
  private resizeObserver: ResizeObserver | null = null
  private hoverId: number | null = null
  private selectedId: number | null = null
  private overtimeFlash = 0
  private endFlash = 0
  private frame = 0
  private raf = 0
  private running = false
  private onSelect: ((id: number | null) => void) | null = null

  constructor(canvas: HTMLCanvasElement, engine: BattleEngine, options: RenderOptions) {
    this.canvas = canvas
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D 不可用')
    this.ctx = ctx
    this.engine = engine
    this.options = options
    this.wood = this.makeWoodTexture()
    this.resize()
    if (typeof ResizeObserver !== 'undefined' && canvas.parentElement) {
      this.resizeObserver = new ResizeObserver(() => this.resize())
      this.resizeObserver.observe(canvas.parentElement)
    }
    canvas.addEventListener('pointerdown', this.handleClick)
    canvas.addEventListener('pointermove', this.handleMove)
    canvas.addEventListener('pointerleave', this.handleLeave)
  }

  setOptions(options: RenderOptions): void {
    this.options = options
  }

  setSelection(id: number | null): void {
    this.selectedId = id
  }

  setOnSelect(cb: (id: number | null) => void): void {
    this.onSelect = cb
  }

  destroy(): void {
    this.running = false
    cancelAnimationFrame(this.raf)
    this.resizeObserver?.disconnect()
    this.canvas.removeEventListener('pointerdown', this.handleClick)
    this.canvas.removeEventListener('pointermove', this.handleMove)
    this.canvas.removeEventListener('pointerleave', this.handleLeave)
  }

  isRunning(): boolean {
    return this.running
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.last = performance.now()
    const loop = (t: number) => {
      if (!this.running) return
      this.render(t)
      this.raf = requestAnimationFrame(loop)
    }
    this.raf = requestAnimationFrame(loop)
  }

  private handleClick = (e: PointerEvent) => {
    const id = this.hitTest(e.clientX, e.clientY)
    this.selectedId = id
    this.onSelect?.(id)
  }

  private handleMove = (e: PointerEvent) => {
    const id = this.hitTest(e.clientX, e.clientY)
    this.hoverId = id
    this.canvas.style.cursor = id ? 'pointer' : 'default'
  }

  private handleLeave = () => {
    this.hoverId = null
  }

  hitTest(clientX: number, clientY: number): number | null {
    const rect = this.canvas.getBoundingClientRect()
    const x = (clientX - rect.left - this.ox) / this.cell
    const y = (clientY - rect.top - this.oy) / this.cell
    let best: Unit | null = null
    let bestD = Infinity
    for (const u of this.engine.units) {
      if (!u.alive) continue
      const d = Math.hypot(u.x - x, u.y - y)
      const r = u.isBase ? u.radius * 1.5 : u.radius * 1.35
      if (d <= r && d < bestD) {
        bestD = d
        best = u
      }
    }
    return best ? best.id : null
  }

  private resize(): void {
    const parent = this.canvas.parentElement
    if (!parent) return
    const rect = parent.getBoundingClientRect()
    const w = Math.max(320, rect.width)
    const h = Math.max(360, rect.height)
    this.dpr = Math.min(2, window.devicePixelRatio || 1)
    this.width = w
    this.height = h
    this.canvas.width = Math.round(w * this.dpr)
    this.canvas.height = Math.round(h * this.dpr)
    this.canvas.style.width = `${w}px`
    this.canvas.style.height = `${h}px`
    const pad = 0.92
    this.cell = Math.min(w / (BOARD_W + pad * 2), h / (BOARD_H + pad * 2))
    this.ox = (w - BOARD_W * this.cell) / 2
    this.oy = (h - BOARD_H * this.cell) / 2
  }

  private sx(x: number): number {
    return this.ox + x * this.cell
  }

  private sy(y: number): number {
    return this.oy + y * this.cell
  }

  // ───────────────────────────── 事件 → 表现 ─────────────────────────────

  pushEvents(events: BattleEvent[]): void {
    for (const e of events) {
      const x = e.x !== undefined ? this.sx(e.x) : 0
      const y = e.y !== undefined ? this.sy(e.y) : 0
      switch (e.type) {
        case 'attack': {
          if (e.x === undefined || e.tx === undefined) break
          const tx = this.sx(e.tx)
          const ty = this.sy(e.ty ?? 0)
          const angle = Math.atan2(ty - y, tx - x)
          const team = TEAM[e.team ?? 'red']
          const dist = Math.hypot(tx - x, ty - y)
          if (e.meta?.startsWith('cone')) {
            this.slashes.push({
              x,
              y,
              angle,
              radius: this.cell * 2.1,
              spread: 0.58,
              age: 0,
              life: 0.28,
              color: team.glow,
              width: 3,
            })
          } else if (e.meta === 'cleave') {
            this.slashes.push({
              x: tx,
              y: ty,
              angle,
              radius: this.cell * 0.55,
              spread: 1.2,
              age: 0,
              life: 0.24,
              color: 'rgba(255,240,210,.8)',
              width: 4,
            })
          } else {
            this.slashes.push({
              x: x + Math.cos(angle) * Math.min(dist, this.cell * 0.7),
              y: y + Math.sin(angle) * Math.min(dist, this.cell * 0.7),
              angle,
              radius: this.cell * 0.38,
              spread: 0.9,
              age: 0,
              life: 0.2,
              color: 'rgba(255,245,220,.75)',
              width: 3,
            })
          }
          this.sparks(tx, ty, 4, team.glow)
          break
        }
        case 'shoot': {
          if (e.x === undefined) break
          const tx = this.sx(e.tx ?? 0)
          const ty = this.sy(e.ty ?? 0)
          this.muzzles.push({
            x,
            y,
            angle: Math.atan2(ty - y, tx - x),
            age: 0,
            life: 0.18,
            color: 'rgba(255,196,120,.95)',
          })
          this.sparks(x, y, 5, 'rgba(255,190,110,.9)', 2.2)
          break
        }
        case 'impact': {
          if (e.meta === 'shell') {
            this.explosion(x, y)
            this.shake = Math.min(10, this.shake + 3.2)
          } else {
            this.rings.push({
              x,
              y,
              r0: 2,
              r1: this.cell * 0.35,
              age: 0,
              life: 0.22,
              color: 'rgba(255,220,150,.7)',
              width: 2,
            })
            this.sparks(x, y, 4, 'rgba(255,220,150,.8)', 1.4)
          }
          break
        }
        case 'hit': {
          if (this.options.damageNumbers && e.amount && e.amount >= 10) {
            const last = this.lastTextAt.get(e.unitId ?? -1) ?? 0
            if (this.now - last > 140) {
              this.lastTextAt.set(e.unitId ?? -1, this.now)
              const big = e.amount >= 55
              const baseSize = Math.max(9, Math.min(16, this.cell * 0.17))
              this.texts.push({
                x: x + (Math.sin((e.unitId ?? 0) * 3.1) * this.cell) / 9,
                y: y - this.cell * 0.35,
                text: `-${Math.round(e.amount)}`,
                age: 0,
                life: big ? 0.85 : 0.65,
                color: e.meta === 'base' ? '#ffd28a' : e.lethal ? '#ff9b7d' : '#fff2d9',
                size: big ? baseSize + 3 : baseSize,
              })
            }
          }
          if (e.lethal) {
            this.rings.push({
              x,
              y,
              r0: 4,
              r1: this.cell * 0.7,
              age: 0,
              life: 0.4,
              color: 'rgba(255,232,190,.55)',
              width: 2,
            })
          }
          break
        }
        case 'death': {
          const team = TEAM[e.team ?? 'red']
          this.rings.push({
            x,
            y,
            r0: this.cell * 0.1,
            r1: this.cell * 0.8,
            age: 0,
            life: 0.5,
            color: team.glow,
            width: 3,
          })
          this.sparks(x, y, 10, team.glow, 2.4)
          if (e.unitType === 'base') {
            this.shake = 18
            this.endFlash = 0.6
          }
          break
        }
        case 'respawn': {
          this.beams.push({
            x,
            y,
            w: this.cell * 0.4,
            h: this.cell * 1.8,
            age: 0,
            life: 0.6,
            color: 'rgba(255,240,205,.55)',
          })
          this.rings.push({
            x,
            y,
            r0: 4,
            r1: this.cell * 0.65,
            age: 0,
            life: 0.5,
            color: 'rgba(255,240,205,.7)',
            width: 2,
          })
          break
        }
        case 'deploy': {
          this.rings.push({
            x,
            y,
            r0: this.cell * 0.15,
            r1: this.cell * 0.75,
            age: 0,
            life: 0.45,
            color: 'rgba(212,178,108,.8)',
            width: 2,
          })
          this.sparks(x, y, 6, 'rgba(212,178,108,.8)', 1.4)
          break
        }
        case 'pack': {
          this.rings.push({
            x,
            y,
            r0: this.cell * 0.55,
            r1: this.cell * 0.2,
            age: 0,
            life: 0.3,
            color: 'rgba(212,178,108,.5)',
            width: 2,
          })
          break
        }
        case 'flee': {
          this.rings.push({
            x,
            y,
            r0: this.cell * 0.2,
            r1: this.cell * 0.55,
            age: 0,
            life: 0.3,
            color: 'rgba(255,180,120,.4)',
            width: 2,
          })
          break
        }
        case 'jump': {
          if (e.phase === 'windup') {
            this.rings.push({
              x,
              y,
              r0: this.cell * 0.1,
              r1: this.cell * 0.5,
              age: 0,
              life: 0.4,
              color: 'rgba(255,236,190,.65)',
              width: 2,
            })
          } else if (e.phase === 'dash' && e.tx !== undefined) {
            const tx = this.sx(e.tx)
            const ty = this.sy(e.ty ?? 0)
            const steps = 4
            for (let i = 0; i < steps; i++) {
              const t = i / steps
              this.ghosts.push({
                x: x + (tx - x) * t,
                y: y + (ty - y) * t,
                type: 'horse',
                team: e.team ?? 'red',
                age: 0,
                life: 0.28,
                scale: 0.85,
              })
            }
            this.sparks(x, y, 8, 'rgba(255,230,180,.55)', 2)
          } else if (e.phase === 'land') {
            this.shake = Math.min(9, this.shake + 2.6)
            this.rings.push({
              x,
              y,
              r0: this.cell * 0.2,
              r1: this.cell * 1.5,
              age: 0,
              life: 0.45,
              color: 'rgba(255,225,170,.7)',
              width: 3,
            })
            this.dust(x, y, 10)
          }
          break
        }
        case 'teleport': {
          if (e.phase === 'windup') {
            this.rings.push({
              x,
              y,
              r0: this.cell * 0.6,
              r1: this.cell * 0.2,
              age: 0,
              life: 0.8,
              color: 'rgba(120,190,160,.7)',
              width: 2,
            })
          } else {
            this.beams.push({
              x,
              y,
              w: this.cell * 0.8,
              h: this.cell * 2.1,
              age: 0,
              life: 0.5,
              color: 'rgba(140,210,175,.55)',
            })
            this.rings.push({
              x,
              y,
              r0: this.cell * 0.15,
              r1: this.cell * 1.3,
              age: 0,
              life: 0.5,
              color: 'rgba(120,190,160,.75)',
              width: 3,
            })
            this.dust(x, y, 8)
          }
          break
        }
        case 'heal': {
          for (let i = 0; i < 3; i++) {
            this.particles.push({
              x: x + (Math.random() - 0.5) * this.cell * 0.4,
              y: y + (Math.random() - 0.5) * this.cell * 0.2,
              vx: 0,
              vy: -this.cell * (0.35 + Math.random() * 0.25),
              age: 0,
              life: 0.6,
              size: 2.4,
              color: 'rgba(140,205,160,.85)',
              gravity: 0,
              drag: 1.4,
            })
          }
          break
        }
        case 'base-hit': {
          const team = e.team ?? 'red'
          this.baseFlash[team] = 0.5
          const base = this.engine.units.find((u) => u.isBase && u.team === team)
          if (base) {
            this.sparks(this.sx(base.x), this.sy(base.y), 6, 'rgba(255,190,120,.8)', 1.6)
          }
          if (e.meta !== 'bleed') this.shake = Math.min(12, this.shake + 2.6)
          break
        }
        case 'overtime': {
          this.overtimeFlash = 1
          this.shake = 8
          break
        }
        case 'end': {
          this.endFlash = 0.8
          break
        }
        default:
          break
      }
    }
  }

  private sparks(x: number, y: number, count: number, color: string, speed = 1.8): void {
    if (!this.options.effects) return
    const n = Math.min(count, 8)
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      const sp = this.cell * (0.25 + Math.random() * 0.55) * speed
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - this.cell * 0.12,
        age: 0,
        life: 0.28 + Math.random() * 0.22,
        size: 1.4 + Math.random() * 2.4,
        color,
        gravity: this.cell * 1.4,
        drag: 2.6,
      })
    }
  }

  private dust(x: number, y: number, count: number): void {
    if (!this.options.effects) return
    for (let i = 0; i < Math.min(count, 12); i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.2
      const sp = this.cell * (0.15 + Math.random() * 0.3)
      this.particles.push({
        x: x + (Math.random() - 0.5) * this.cell * 0.3,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp * 0.4,
        age: 0,
        life: 0.5 + Math.random() * 0.4,
        size: 2.5 + Math.random() * 3.5,
        color: 'rgba(196,172,136,.35)',
        gravity: -this.cell * 0.15,
        drag: 1.8,
      })
    }
  }

  private explosion(x: number, y: number): void {
    this.rings.push({
      x,
      y,
      r0: this.cell * 0.1,
      r1: this.cell * 1.25,
      age: 0,
      life: 0.42,
      color: 'rgba(255,176,84,.85)',
      width: 4,
    })
    this.rings.push({
      x,
      y,
      r0: this.cell * 0.05,
      r1: this.cell * 0.7,
      age: 0,
      life: 0.26,
      color: 'rgba(255,248,220,.9)',
      width: 2,
    })
    if (!this.options.effects) return
    this.sparks(x, y, 14, 'rgba(255,168,72,.95)', 3.1)
    for (let i = 0; i < 7; i++) {
      const a = Math.random() * Math.PI * 2
      const sp = this.cell * (0.1 + Math.random() * 0.2)
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - this.cell * 0.2,
        age: 0,
        life: 0.8 + Math.random() * 0.5,
        size: 4 + Math.random() * 6,
        color: 'rgba(96,84,72,.32)',
        gravity: -this.cell * 0.12,
        drag: 1.2,
      })
    }
  }

  // ───────────────────────────── 绘制 ─────────────────────────────

  render(now: number): void {
    const dt = Math.min(0.05, (now - this.last) / 1000)
    this.last = now
    this.now = now
    this.frame++
    this.updateVisuals(dt)
    this.updateFx(dt)

    const ctx = this.ctx
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.clearRect(0, 0, this.width, this.height)
    ctx.save()
    if (this.shake > 0.1) {
      const s = this.shake
      ctx.translate(Math.sin(now * 0.09) * s, Math.cos(now * 0.11) * s * 0.7)
    }

    this.drawBoard()
    this.drawPedestals()
    this.drawBases()

    const alive = this.engine.units.filter((u) => !u.isBase).sort((a, b) => a.y - b.y)
    for (const u of alive) this.drawUnit(u)

    this.drawProjectiles()
    this.drawFx()

    ctx.restore()
    this.drawVignette()
    this.drawFlashes()
  }

  private updateVisuals(dt: number): void {
    const k = 1 - Math.exp(-dt * 16)
    for (const u of this.engine.units) {
      const v = this.visual.get(u.id)
      if (!v) {
        this.visual.set(u.id, { x: u.x, y: u.y, scale: 1, born: this.now })
        continue
      }
      if (!u.alive) continue
      const d = Math.hypot(u.x - v.x, u.y - v.y)
      if (d > 2.4) {
        v.x = u.x
        v.y = u.y
      } else {
        v.x += (u.x - v.x) * k
        v.y += (u.y - v.y) * k
      }
    }
    for (const id of [...this.visual.keys()]) {
      const u = this.engine.units.find((x) => x.id === id)
      if (!u || (!u.alive && u.isBase)) this.visual.delete(id)
    }
  }

  private updateFx(dt: number): void {
    this.shake *= Math.exp(-dt * 7)
    this.baseFlash.red = Math.max(0, this.baseFlash.red - dt)
    this.baseFlash.black = Math.max(0, this.baseFlash.black - dt)
    this.overtimeFlash = Math.max(0, this.overtimeFlash - dt * 0.8)
    this.endFlash = Math.max(0, this.endFlash - dt * 0.7)
    for (const r of this.rings) r.age += dt
    for (const p of this.particles) {
      p.age += dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.vy += p.gravity * dt
      const drag = Math.exp(-p.drag * dt)
      p.vx *= drag
      p.vy *= drag
    }
    for (const t of this.texts) t.age += dt
    for (const s of this.slashes) s.age += dt
    for (const b of this.beams) b.age += dt
    for (const g of this.ghosts) g.age += dt
    for (const m of this.muzzles) m.age += dt
    this.rings = this.rings.filter((r) => r.age < r.life)
    this.particles = this.particles.filter((p) => p.age < p.life)
    this.texts = this.texts.filter((t) => t.age < t.life)
    this.slashes = this.slashes.filter((s) => s.age < s.life)
    this.beams = this.beams.filter((b) => b.age < b.life)
    this.ghosts = this.ghosts.filter((g) => g.age < g.life)
    this.muzzles = this.muzzles.filter((m) => m.age < m.life)
    if (this.particles.length > 320) this.particles.splice(0, this.particles.length - 320)
  }

  private drawBoard(): void {
    const ctx = this.ctx
    const cell = this.cell
    const x0 = this.sx(0)
    const y0 = this.sy(0)
    const w = BOARD_W * cell
    const h = BOARD_H * cell
    const margin = cell * 0.44
    const bx = x0 - margin
    const by = y0 - margin
    const bw = w + margin * 2
    const bh = h + margin * 2
    const framePad = cell * 0.34

    // 外框
    const frameGrad = ctx.createLinearGradient(bx - framePad, by - framePad, bx + bw + framePad, by + bh + framePad)
    frameGrad.addColorStop(0, '#5c3a22')
    frameGrad.addColorStop(0.45, '#432a18')
    frameGrad.addColorStop(1, '#2f1d10')
    ctx.fillStyle = frameGrad
    roundRect(ctx, bx - framePad, by - framePad, bw + framePad * 2, bh + framePad * 2, cell * 0.26)
    ctx.fill()

    ctx.save()
    roundRect(ctx, bx - framePad, by - framePad, bw + framePad * 2, bh + framePad * 2, cell * 0.26)
    ctx.clip()
    ctx.globalAlpha = 0.25
    ctx.strokeStyle = '#c9a45e'
    ctx.lineWidth = 1
    roundRect(ctx, bx - framePad * 0.55, by - framePad * 0.55, bw + framePad * 1.1, bh + framePad * 1.1, cell * 0.2)
    ctx.stroke()
    ctx.globalAlpha = 1
    ctx.restore()

    // 棋盘木面（外扩半格，给边线棋子留出落座空间）
    ctx.save()
    ctx.beginPath()
    ctx.rect(bx, by, bw, bh)
    ctx.clip()
    ctx.drawImage(this.wood, bx, by, bw, bh)
    const wash = ctx.createLinearGradient(bx, by, bx + bw, by + bh)
    wash.addColorStop(0, 'rgba(255,246,225,.16)')
    wash.addColorStop(0.5, 'rgba(255,255,255,0)')
    wash.addColorStop(1, 'rgba(80,46,20,.12)')
    ctx.fillStyle = wash
    ctx.fillRect(bx, by, bw, bh)
    ctx.restore()

    // 木面内沿
    ctx.strokeStyle = 'rgba(46,28,14,.55)'
    ctx.lineWidth = 1
    ctx.strokeRect(bx, by, bw, bh)

    // 棋盘边线
    ctx.strokeStyle = 'rgba(46,28,14,.75)'
    ctx.lineWidth = Math.max(1.2, cell * 0.016)
    ctx.strokeRect(x0, y0, w, h)
    ctx.strokeStyle = 'rgba(201,164,94,.4)'
    ctx.lineWidth = 1
    ctx.strokeRect(x0 + cell * 0.055, y0 + cell * 0.055, w - cell * 0.11, h - cell * 0.11)

    // 网格
    const grid = 'rgba(62,40,22,.62)'
    ctx.strokeStyle = grid
    ctx.lineWidth = Math.max(1, cell * 0.012)
    const gap = cell * 0.16
    for (let i = 0; i <= BOARD_W; i++) {
      const x = x0 + i * cell
      if (i === 0 || i === BOARD_W) {
        ctx.beginPath()
        ctx.moveTo(x, y0)
        ctx.lineTo(x, y0 + h)
        ctx.stroke()
      } else {
        ctx.beginPath()
        ctx.moveTo(x, y0)
        ctx.lineTo(x, this.sy(RIVER_Y) - gap)
        ctx.moveTo(x, this.sy(RIVER_Y) + gap)
        ctx.lineTo(x, y0 + h)
        ctx.stroke()
      }
    }
    for (let j = 0; j <= BOARD_H; j++) {
      const y = y0 + j * cell
      ctx.beginPath()
      ctx.moveTo(x0, y)
      ctx.lineTo(x0 + w, y)
      ctx.stroke()
    }

    // 九宫
    this.drawPalace(3, 0, 5, 2)
    this.drawPalace(3, 7, 5, 9)

    // 河界
    const riverY = this.sy(RIVER_Y)
    const riverGrad = ctx.createLinearGradient(0, riverY - cell * 0.45, 0, riverY + cell * 0.45)
    riverGrad.addColorStop(0, 'rgba(60,80,74,0)')
    riverGrad.addColorStop(0.28, 'rgba(59,84,76,.09)')
    riverGrad.addColorStop(0.72, 'rgba(59,84,76,.09)')
    riverGrad.addColorStop(1, 'rgba(60,80,74,0)')
    ctx.fillStyle = riverGrad
    ctx.fillRect(x0, riverY - cell * 0.45, w, cell * 0.9)

    ctx.save()
    ctx.fillStyle = 'rgba(54,44,30,.46)'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `${cell * 0.34}px "STKaiti","KaiTi","SimSun",serif`
    this.spacedText('楚 河', x0 + w * 0.33, riverY, cell * 0.14)
    this.spacedText('汉 界', x0 + w * 0.67, riverY, cell * 0.14)
    ctx.restore()

    // 星位标记
    for (const p of [
      [1, 2],
      [7, 2],
      [1, 7],
      [7, 7],
      [0, 3],
      [2, 3],
      [4, 3],
      [6, 3],
      [8, 3],
      [0, 6],
      [2, 6],
      [4, 6],
      [6, 6],
      [8, 6],
    ]) {
      this.drawStarMark(p[0], p[1])
    }

    // 角饰
    for (const [cx, cy] of [
      [bx - framePad * 0.55, by - framePad * 0.55],
      [bx + bw + framePad * 0.55, by - framePad * 0.55],
      [bx - framePad * 0.55, by + bh + framePad * 0.55],
      [bx + bw + framePad * 0.55, by + bh + framePad * 0.55],
    ]) {
      ctx.save()
      ctx.fillStyle = '#2a1a0e'
      ctx.beginPath()
      ctx.arc(cx, cy, cell * 0.09, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = 'rgba(201,164,94,.55)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(cx, cy, cell * 0.065, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }
  }

  private drawPalace(x0: number, y0: number, x1: number, y1: number): void {
    const ctx = this.ctx
    ctx.strokeStyle = 'rgba(62,40,22,.5)'
    ctx.lineWidth = Math.max(1, this.cell * 0.01)
    ctx.beginPath()
    ctx.moveTo(this.sx(x0), this.sy(y0))
    ctx.lineTo(this.sx(x1), this.sy(y1))
    ctx.moveTo(this.sx(x1), this.sy(y0))
    ctx.lineTo(this.sx(x0), this.sy(y1))
    ctx.stroke()
  }

  private spacedText(text: string, cx: number, cy: number, gap: number): void {
    const ctx = this.ctx
    const chars = [...text]
    const total = chars.length * gap
    let x = cx - total / 2 + gap / 2
    for (const ch of chars) {
      ctx.fillText(ch, x, cy)
      x += gap
    }
  }

  private drawStarMark(x: number, y: number): void {
    const ctx = this.ctx
    const s = this.cell * 0.055
    const px = this.sx(x)
    const py = this.sy(y)
    ctx.strokeStyle = 'rgba(62,40,22,.55)'
    ctx.lineWidth = Math.max(1, this.cell * 0.009)
    for (const [dx, dy] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ]) {
      ctx.beginPath()
      ctx.moveTo(px + dx * s * 1.6, py + dy * s * 1.6)
      ctx.lineTo(px + dx * s * 3.4, py + dy * s * 3.4)
      ctx.stroke()
    }
  }

  private drawPedestals(): void {
    const ctx = this.ctx
    for (const u of this.engine.units) {
      if (u.isBase) continue
      const x = this.sx(u.homeX)
      const y = this.sy(u.homeY)
      const r = this.cell * 0.36
      const color = u.team === 'red' ? 'rgba(190,90,72,' : 'rgba(58,58,70,'
      ctx.save()
      ctx.strokeStyle = `${color}.22)`
      ctx.lineWidth = 1
      ctx.setLineDash([2, 3])
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = `${color}.14)`
      for (let i = 0; i < 4; i++) {
        const a = (Math.PI / 2) * i + Math.PI / 4
        ctx.beginPath()
        ctx.arc(x + Math.cos(a) * r, y + Math.sin(a) * r, 1.2, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
    }
  }

  private drawBases(): void {
    for (const u of this.engine.units) {
      if (!u.isBase) continue
      this.drawBase(u)
    }
  }

  private drawBase(u: Unit): void {
    const ctx = this.ctx
    const v = this.visual.get(u.id) ?? { x: u.x, y: u.y, scale: 1, born: 0 }
    const x = this.sx(v.x)
    const y = this.sy(v.y)
    const cell = this.cell
    const team = TEAM[u.team]
    const hpRatio = clamp(u.hp / u.maxHp, 0, 1)
    const dead = !u.alive
    const flash = this.baseFlash[u.team] > 0 ? this.baseFlash[u.team] / 0.5 : 0
    const pulse = 0.5 + 0.5 * Math.sin(this.now * 0.0022 + (u.team === 'red' ? 1 : 3))
    const R = cell * 1.0

    ctx.save()
    ctx.translate(x, y)

    // 阴影
    ctx.fillStyle = 'rgba(30,20,12,.3)'
    ctx.beginPath()
    ctx.ellipse(0, R * 0.3, R * 0.82, R * 0.32, 0, 0, Math.PI * 2)
    ctx.fill()

    // 台基
    const stone = ctx.createLinearGradient(-R, -R, R, R)
    stone.addColorStop(0, dead ? '#857a6a' : '#a79a84')
    stone.addColorStop(0.5, dead ? '#6c6254' : '#8a7c66')
    stone.addColorStop(1, dead ? '#4c453a' : '#6b5e4c')
    ctx.fillStyle = stone
    ctx.beginPath()
    const sides = 8
    for (let i = 0; i < sides; i++) {
      const a = (Math.PI * 2 * i) / sides + Math.PI / 8
      const px = Math.cos(a) * R * 0.94
      const py = Math.sin(a) * R * 0.72
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = 'rgba(48,34,22,.5)'
    ctx.lineWidth = 1.4
    ctx.stroke()

    // 台阶
    ctx.strokeStyle = 'rgba(224,206,172,.35)'
    ctx.lineWidth = 1
    for (let i = 1; i <= 3; i++) {
      const rr = R * (0.94 - i * 0.11)
      ctx.beginPath()
      ctx.ellipse(0, 0, rr, rr * 0.76, 0, 0, Math.PI * 2)
      ctx.stroke()
    }

    // 四角小柱
    for (let i = 0; i < 4; i++) {
      const a = (Math.PI / 2) * i + Math.PI / 4
      const px = Math.cos(a) * R * 0.78
      const py = Math.sin(a) * R * 0.58
      ctx.fillStyle = '#6e614e'
      ctx.beginPath()
      ctx.arc(px, py, cell * 0.055, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = 'rgba(212,178,108,.55)'
      ctx.beginPath()
      ctx.arc(px, py, cell * 0.022, 0, Math.PI * 2)
      ctx.fill()
    }

    // 队伍旗
    const flagX = -R * 0.86
    const flagY = -R * 0.75
    ctx.strokeStyle = dead ? 'rgba(66,54,40,.35)' : '#4b3520'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(flagX, flagY + cell * 0.4)
    ctx.lineTo(flagX, flagY - cell * 0.5)
    ctx.stroke()
    ctx.fillStyle = dead
      ? 'rgba(80,72,62,.28)'
      : u.team === 'red'
        ? 'rgba(160,48,38,.85)'
        : 'rgba(38,38,46,.85)'
    ctx.beginPath()
    const wave = Math.sin(this.now * 0.003) * cell * 0.03
    ctx.moveTo(flagX, flagY - cell * 0.5)
    ctx.lineTo(flagX + cell * 0.36 + wave, flagY - cell * 0.44)
    ctx.lineTo(flagX + cell * 0.32 + wave, flagY - cell * 0.22)
    ctx.lineTo(flagX, flagY - cell * 0.26)
    ctx.closePath()
    ctx.fill()

    // 光核
    const glowR = R * 0.72
    const glow = ctx.createRadialGradient(0, 0, R * 0.1, 0, 0, glowR)
    glow.addColorStop(0, dead ? 'rgba(40,32,24,0.18)' : rgba(u.team === 'red' ? '#ffb08a' : '#b8c0d0', 0.38 + flash * 0.3))
    glow.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(0, 0, glowR, 0, Math.PI * 2)
    ctx.fill()

    // 主盘
    const discR = cell * 0.62
    const face = ctx.createRadialGradient(-discR * 0.3, -discR * 0.35, discR * 0.1, 0, 0, discR)
    face.addColorStop(0, dead ? '#7f7565' : '#f8edd8')
    face.addColorStop(0.7, dead ? '#5f574a' : '#e6d0aa')
    face.addColorStop(1, dead ? '#3e382f' : '#c9ae83')
    ctx.fillStyle = face
    ctx.beginPath()
    ctx.arc(0, 0, discR, 0, Math.PI * 2)
    ctx.fill()

    ctx.strokeStyle = dead ? 'rgba(28,23,18,.8)' : u.team === 'red' ? 'rgba(150,42,32,.8)' : 'rgba(26,26,32,.85)'
    ctx.lineWidth = Math.max(2, cell * 0.035)
    ctx.beginPath()
    ctx.arc(0, 0, discR, 0, Math.PI * 2)
    ctx.stroke()

    ctx.strokeStyle = dead ? 'rgba(201,164,94,.15)' : 'rgba(201,164,94,.65)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(0, 0, discR * 0.84, 0, Math.PI * 2)
    ctx.stroke()

    // 基地字
    ctx.fillStyle = dead ? 'rgba(244,234,212,.2)' : u.team === 'red' ? '#9b2b20' : '#1b1b21'
    ctx.font = `${discR * 1.12}px "STKaiti","KaiTi","SimSun",serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(CHARS.base[u.team], 0, discR * 0.04)

    // 血环
    const ringR = R * 0.86
    ctx.strokeStyle = 'rgba(30,22,14,.35)'
    ctx.lineWidth = Math.max(3, cell * 0.05)
    ctx.beginPath()
    ctx.arc(0, 0, ringR, 0, Math.PI * 2)
    ctx.stroke()
    const hpColor = hpRatio > 0.5 ? '#5f8f68' : hpRatio > 0.25 ? '#c99a3f' : '#b84232'
    ctx.strokeStyle = hpColor
    ctx.lineWidth = Math.max(3, cell * 0.05)
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.arc(0, 0, ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * hpRatio)
    ctx.stroke()
    ctx.lineCap = 'butt'

    // 呼吸光
    if (u.alive) {
      ctx.strokeStyle = rgba(u.team === 'red' ? '#ff9a7a' : '#c8d0e2', 0.1 + pulse * 0.12)
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(0, 0, ringR + cell * 0.06 + pulse * cell * 0.02, 0, Math.PI * 2)
      ctx.stroke()
    }

    if (flash > 0) {
      ctx.fillStyle = `rgba(255,220,190,${flash * 0.35})`
      ctx.beginPath()
      ctx.arc(0, 0, discR, 0, Math.PI * 2)
      ctx.fill()
    }

    if (dead) {
      // 焦痕
      const scorch = ctx.createRadialGradient(0, 0, discR * 0.1, 0, 0, discR * 1.05)
      scorch.addColorStop(0, 'rgba(18,13,10,.48)')
      scorch.addColorStop(0.55, 'rgba(22,16,12,.22)')
      scorch.addColorStop(1, 'rgba(22,16,12,0)')
      ctx.fillStyle = scorch
      ctx.beginPath()
      ctx.arc(0, 0, discR * 1.05, 0, Math.PI * 2)
      ctx.fill()

      // 裂纹
      ctx.lineCap = 'round'
      for (let i = 0; i < 7; i++) {
        const base = (i / 7) * Math.PI * 2 + 0.35
        ctx.beginPath()
        ctx.strokeStyle = 'rgba(14,10,8,.7)'
        ctx.lineWidth = i % 2 === 0 ? 2.4 : 1.4
        let px = Math.cos(base) * discR * 0.08
        let py = Math.sin(base) * discR * 0.08
        ctx.moveTo(px, py)
        for (let k = 1; k <= 4; k++) {
          const rr = (discR * (0.22 + k * 0.2))
          const a = base + Math.sin(i * 9 + k * 5) * 0.2
          px = Math.cos(a) * rr
          py = Math.sin(a) * rr
          ctx.lineTo(px, py)
        }
        ctx.stroke()
        ctx.strokeStyle = 'rgba(220,200,168,.12)'
        ctx.lineWidth = 0.8
        ctx.stroke()
      }
      ctx.lineCap = 'butt'

      // 残烟
      for (let i = 0; i < 3; i++) {
        const t = ((this.now * 0.00012 + i * 0.31) % 1)
        const sy = -discR * (0.3 + t * 1.35)
        const sx = Math.sin(this.now * 0.0014 + i * 2.1) * discR * 0.24
        const rr = discR * (0.22 + t * 0.42)
        ctx.globalAlpha = (1 - t) * 0.16
        ctx.fillStyle = '#3b342b'
        ctx.beginPath()
        ctx.arc(sx, sy, rr, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1

      // 碎石
      for (let i = 0; i < 5; i++) {
        const a = 0.4 + i * 1.3
        const rr = R * (0.72 + (i % 3) * 0.1)
        ctx.fillStyle = 'rgba(70,62,52,.55)'
        ctx.beginPath()
        ctx.ellipse(Math.cos(a) * rr, Math.sin(a) * rr * 0.75, cell * 0.035, cell * 0.02, a, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    ctx.restore()
  }

  private drawUnit(u: Unit): void {
    const ctx = this.ctx
    const v = this.visual.get(u.id)
    if (!v || !u.alive) return
    const cell = this.cell
    const team = TEAM[u.team]
    let x = this.sx(v.x)
    let y = this.sy(v.y)
    const r = Math.max(12, u.radius * cell * 1.04)
    const bob = u.cooldown > 0 ? 0 : Math.sin(this.now * 0.002 + u.id * 1.7) * cell * 0.012
    y += bob

    // 攻击前冲
    if (u.attackAnim > 0.02) {
      const t = 1 - u.attackAnim / 0.3
      const lunge = Math.sin(Math.min(1, Math.max(0, t)) * Math.PI) * cell * 0.13
      x += Math.cos(u.facing) * lunge
      y += Math.sin(u.facing) * lunge
    }

    // 受击抖动
    if (u.hitTimer > 0) {
      const k = u.hitTimer / 0.22
      x += Math.sin(this.now * 0.09 + u.id) * 2.2 * k
      y += Math.cos(this.now * 0.11 + u.id) * 1.4 * k
    }

    // 象的传送前摇
    const tpWind = u.type === 'elephant' && u.tpPhase === 'windup'
    if (tpWind) {
      const t = 1 - u.tpTimer / 0.8
      ctx.save()
      ctx.strokeStyle = `rgba(120,200,165,${0.3 + 0.4 * Math.sin(this.now * 0.02)})`
      ctx.lineWidth = 1.6
      ctx.beginPath()
      ctx.arc(x, y, r * (1.6 - t * 0.6), 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([3, 5])
      ctx.beginPath()
      ctx.arc(x, y, r * (2.0 - t), 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.restore()
    }

    // 跳跃拖影
    if (u.type === 'horse' && u.jumpPhase === 'dash') {
      ctx.save()
      ctx.globalAlpha = 0.25
      ctx.fillStyle = team.glow
      ctx.beginPath()
      ctx.ellipse(x, y, r * 0.9, r * 0.5, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }

    // 阴影
    ctx.save()
    ctx.fillStyle = 'rgba(35,24,14,.26)'
    ctx.beginPath()
    ctx.ellipse(x + r * 0.06, y + r * 0.62, r * 0.88, r * 0.3, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()

    // 炮架
    if (u.type === 'cannon' && (u.form === 'siege' || u.form === 'deploying' || u.form === 'packing')) {
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(u.facing)
      ctx.fillStyle = 'rgba(58,44,30,.55)'
      roundRect(ctx, -r * 1.1, -r * 0.32, r * 2.2, r * 0.64, r * 0.2)
      ctx.fill()
      ctx.strokeStyle = 'rgba(201,164,94,.4)'
      ctx.lineWidth = 1
      roundRect(ctx, -r * 1.1, -r * 0.32, r * 2.2, r * 0.64, r * 0.2)
      ctx.stroke()
      ctx.fillStyle = 'rgba(38,28,18,.85)'
      roundRect(ctx, r * 0.55, -r * 0.12, r * 0.95, r * 0.24, r * 0.1)
      ctx.fill()
      ctx.restore()
    }

    // 选中 / 悬停
    if (this.selectedId === u.id) {
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(this.now * 0.0008)
      ctx.strokeStyle = 'rgba(212,178,108,.9)'
      ctx.lineWidth = 2
      ctx.setLineDash([5, 5])
      ctx.beginPath()
      ctx.arc(0, 0, r * 1.32, 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.restore()
    } else if (this.hoverId === u.id) {
      ctx.save()
      ctx.strokeStyle = 'rgba(255,248,230,.55)'
      ctx.lineWidth = 1.4
      ctx.beginPath()
      ctx.arc(x, y, r * 1.22, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }

    // 兵种底盘
    const sprite = this.spriteFor(u.team, u.type)
    ctx.drawImage(sprite, x - r, y - r, r * 2, r * 2)

    // 队伍朝向刻痕
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(u.facing)
    ctx.fillStyle = u.team === 'red' ? 'rgba(255,214,190,.85)' : 'rgba(220,224,236,.85)'
    ctx.beginPath()
    ctx.moveTo(r * 0.98, 0)
    ctx.lineTo(r * 0.78, -r * 0.12)
    ctx.lineTo(r * 0.78, r * 0.12)
    ctx.closePath()
    ctx.fill()
    ctx.restore()

    // 受击白闪
    if (u.hitTimer > 0) {
      ctx.save()
      ctx.globalAlpha = Math.min(0.55, (u.hitTimer / 0.22) * 0.55)
      ctx.fillStyle = '#fff6e2'
      ctx.beginPath()
      ctx.arc(x, y, r * 0.8, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }

    // 血条
    if (u.hp < u.maxHp - 0.01) {
      const w = r * 1.9
      const h = Math.max(3, cell * 0.035)
      const bx = x - w / 2
      const by = y - r - cell * 0.13
      ctx.fillStyle = 'rgba(24,18,12,.55)'
      roundRect(ctx, bx, by, w, h, h / 2)
      ctx.fill()
      const ratio = clamp(u.hp / u.maxHp, 0, 1)
      const color = ratio > 0.5 ? '#6da077' : ratio > 0.25 ? '#d0a04a' : '#c0503c'
      ctx.fillStyle = color
      roundRect(ctx, bx, by, Math.max(h, w * ratio), h, h / 2)
      ctx.fill()
    }

    // 状态：眩晕
    if (u.stun > 0.05) {
      ctx.save()
      for (let i = 0; i < 3; i++) {
        const a = this.now * 0.006 + (i * Math.PI * 2) / 3
        const px = x + Math.cos(a) * r * 0.75
        const py = y - r * (1.1 + Math.sin(a) * 0.12)
        ctx.fillStyle = 'rgba(255,220,120,.9)'
        ctx.beginPath()
        ctx.arc(px, py, 1.8, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
    }

    // 跳跃前摇 / 落地恢复
    if (u.type === 'horse' && u.jumpPhase !== 'none') {
      ctx.save()
      ctx.strokeStyle = 'rgba(255,235,190,.5)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(x, y, r * (1.2 + 0.15 * Math.sin(this.now * 0.02)), 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }

    // 选中时显示射程
    if (this.selectedId === u.id) {
      const range = (u.type === 'cannon' ? this.engine.config.units.cannon.range : this.unitRange(u)) * cell
      ctx.save()
      ctx.strokeStyle = 'rgba(212,178,108,.28)'
      ctx.lineWidth = 1
      ctx.setLineDash([4, 6])
      ctx.beginPath()
      ctx.arc(x, y, range + u.radius * cell, 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.restore()
    }

    // 意图线
    if (this.options.intentLines && u.intent) {
      ctx.save()
      ctx.strokeStyle = u.team === 'red' ? 'rgba(190,80,60,.28)' : 'rgba(70,70,90,.28)'
      ctx.lineWidth = 1
      ctx.setLineDash([3, 5])
      if (u.intent.type === 'attack') {
        const t = this.engine.units.find((x2) => x2.id === (u.intent as { targetId: number }).targetId)
        if (t) {
          ctx.beginPath()
          ctx.moveTo(x, y)
          ctx.lineTo(this.sx(t.x), this.sy(t.y))
          ctx.stroke()
        }
      } else if (u.intent.type === 'move') {
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(this.sx(u.intent.x), this.sy(u.intent.y))
        ctx.stroke()
      }
      ctx.setLineDash([])
      ctx.restore()
    }
  }

  private unitRange(u: Unit): number {
    if (u.type === 'base') return this.engine.config.base.turret.range
    return this.engine.config.units[u.type].range
  }

  private spriteFor(team: Team, type: UnitType): HTMLCanvasElement {
    const key = `${team}:${type}`
    const cached = this.sprites.get(key)
    if (cached) return cached
    const size = 160
    const c = document.createElement('canvas')
    c.width = size
    c.height = size
    const g = c.getContext('2d')!
    const cx = size / 2
    const cy = size / 2
    const r = size * 0.44
    const pal = TEAM[team]

    const rim = g.createLinearGradient(cx - r, cy - r, cx + r, cy + r)
    rim.addColorStop(0, pal.rim2)
    rim.addColorStop(0.45, pal.rim)
    rim.addColorStop(1, team === 'red' ? '#5d1813' : '#0c0c10')
    g.fillStyle = rim
    g.beginPath()
    g.arc(cx, cy, r, 0, Math.PI * 2)
    g.fill()

    g.strokeStyle = 'rgba(255,244,220,.28)'
    g.lineWidth = 2
    g.beginPath()
    g.arc(cx, cy, r - 2, 0, Math.PI * 2)
    g.stroke()

    const face = g.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r * 0.86)
    face.addColorStop(0, pal.face)
    face.addColorStop(0.68, pal.face2)
    face.addColorStop(1, team === 'red' ? '#d3b183' : '#cdb694')
    g.fillStyle = face
    g.beginPath()
    g.arc(cx, cy, r * 0.84, 0, Math.PI * 2)
    g.fill()

    g.strokeStyle = rgba(pal.rim2, 0.55)
    g.lineWidth = 1.4
    g.beginPath()
    g.arc(cx, cy, r * 0.72, 0, Math.PI * 2)
    g.stroke()

    // 高光
    const sheen = g.createLinearGradient(cx - r, cy - r, cx, cy)
    sheen.addColorStop(0, 'rgba(255,255,255,.35)')
    sheen.addColorStop(0.5, 'rgba(255,255,255,.06)')
    sheen.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = sheen
    g.beginPath()
    g.arc(cx, cy, r * 0.82, 0, Math.PI * 2)
    g.fill()

    // 字
    g.fillStyle = pal.ink
    g.font = `${r * 1.16}px "STKaiti","KaiTi","SimSun",serif`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(CHARS[type][team], cx, cy + r * 0.04)

    // 内侧暗边
    g.strokeStyle = 'rgba(60,40,24,.25)'
    g.lineWidth = 1
    g.beginPath()
    g.arc(cx, cy, r * 0.85, 0, Math.PI * 2)
    g.stroke()

    this.sprites.set(key, c)
    return c
  }

  private drawProjectiles(): void {
    const ctx = this.ctx
    for (const p of this.engine.projectiles) {
      if (!p.alive) continue
      const x = this.sx(p.x)
      const y = this.sy(p.y)
      const angle = Math.atan2(p.targetY - p.y, p.targetX - p.x)
      ctx.save()
      ctx.translate(x, y)
      if (p.kind === 'shell') {
        const grad = ctx.createRadialGradient(0, 0, 1, 0, 0, this.cell * 0.22)
        grad.addColorStop(0, 'rgba(255,238,190,.95)')
        grad.addColorStop(0.35, 'rgba(255,157,66,.85)')
        grad.addColorStop(1, 'rgba(255,120,40,0)')
        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.arc(0, 0, this.cell * 0.22, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = '#2b2118'
        ctx.beginPath()
        ctx.arc(0, 0, Math.max(3, this.cell * 0.055), 0, Math.PI * 2)
        ctx.fill()
        ctx.rotate(angle)
        ctx.strokeStyle = 'rgba(255,190,110,.4)'
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.moveTo(-this.cell * 0.18, 0)
        ctx.lineTo(-this.cell * 0.55, 0)
        ctx.stroke()
      } else {
        ctx.rotate(angle)
        ctx.fillStyle = 'rgba(255,226,150,.9)'
        ctx.shadowColor = 'rgba(255,200,100,.9)'
        ctx.shadowBlur = 8
        ctx.beginPath()
        ctx.moveTo(this.cell * 0.14, 0)
        ctx.lineTo(-this.cell * 0.08, -this.cell * 0.045)
        ctx.lineTo(-this.cell * 0.08, this.cell * 0.045)
        ctx.closePath()
        ctx.fill()
      }
      ctx.restore()
    }
  }

  private drawFx(): void {
    const ctx = this.ctx

    for (const b of this.beams) {
      const t = b.age / b.life
      const alpha = (1 - t) * 0.8
      const grad = ctx.createLinearGradient(0, b.y - b.h, 0, b.y)
      grad.addColorStop(0, 'rgba(255,255,255,0)')
      grad.addColorStop(0.5, b.color)
      grad.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.save()
      ctx.globalAlpha = alpha
      ctx.fillStyle = grad
      ctx.fillRect(b.x - b.w / 2, b.y - b.h, b.w, b.h)
      ctx.restore()
    }

    for (const g of this.ghosts) {
      const t = g.age / g.life
      const x = this.sx(g.x)
      const y = this.sy(g.y)
      const sprite = this.spriteFor(g.team, g.type)
      const ghostDef = g.type === 'base' ? null : this.engine.config.units[g.type]
      const baseR = ghostDef ? ghostDef.radius : 0.55
      const r = Math.max(10, baseR * this.cell * 1.04 * g.scale)
      ctx.save()
      ctx.globalAlpha = (1 - t) * 0.35
      ctx.drawImage(sprite, x - r, y - r, r * 2, r * 2)
      ctx.restore()
    }

    for (const s of this.slashes) {
      const t = s.age / s.life
      ctx.save()
      ctx.translate(s.x, s.y)
      ctx.rotate(s.angle)
      ctx.strokeStyle = s.color
      ctx.globalAlpha = (1 - t) * 0.9
      ctx.lineWidth = s.width * (1 - t * 0.5)
      ctx.beginPath()
      ctx.arc(0, 0, s.radius, -s.spread, s.spread)
      ctx.stroke()
      ctx.restore()
    }

    for (const m of this.muzzles) {
      const t = m.age / m.life
      ctx.save()
      ctx.translate(m.x, m.y)
      ctx.rotate(m.angle)
      ctx.globalAlpha = 1 - t
      ctx.fillStyle = m.color
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(this.cell * 0.34, -this.cell * 0.09)
      ctx.lineTo(this.cell * 0.5, 0)
      ctx.lineTo(this.cell * 0.34, this.cell * 0.09)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    }

    for (const r of this.rings) {
      const t = r.age / r.life
      const radius = r.r0 + (r.r1 - r.r0) * (1 - Math.pow(1 - t, 2))
      ctx.save()
      ctx.globalAlpha = (1 - t) * 0.9
      ctx.strokeStyle = r.color
      ctx.lineWidth = r.width * (1 - t * 0.6)
      ctx.beginPath()
      ctx.arc(r.x, r.y, radius, 0, Math.PI * 2)
      ctx.stroke()
      if (r.fill) {
        ctx.fillStyle = r.fill
        ctx.globalAlpha = (1 - t) * 0.25
        ctx.beginPath()
        ctx.arc(r.x, r.y, radius, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
    }

    for (const p of this.particles) {
      const t = p.age / p.life
      ctx.save()
      ctx.globalAlpha = (1 - t) * 0.95
      ctx.fillStyle = p.color
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.size * (1 - t * 0.5), 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }

    for (const t of this.texts) {
      const k = t.age / t.life
      const y = t.y - k * this.cell * 0.55
      ctx.save()
      ctx.globalAlpha = 1 - Math.pow(k, 2)
      ctx.font = `700 ${t.size}px "Microsoft YaHei",sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.lineWidth = 3
      ctx.strokeStyle = 'rgba(40,26,14,.55)'
      ctx.strokeText(t.text, t.x, y)
      ctx.fillStyle = t.color
      ctx.fillText(t.text, t.x, y)
      ctx.restore()
    }
  }

  private drawVignette(): void {
    const ctx = this.ctx
    const g = ctx.createRadialGradient(
      this.width / 2,
      this.height / 2,
      Math.min(this.width, this.height) * 0.25,
      this.width / 2,
      this.height / 2,
      Math.max(this.width, this.height) * 0.72,
    )
    g.addColorStop(0, 'rgba(20,14,8,0)')
    g.addColorStop(1, 'rgba(20,14,8,.18)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, this.width, this.height)
  }

  private drawFlashes(): void {
    const ctx = this.ctx
    if (this.overtimeFlash > 0) {
      ctx.fillStyle = `rgba(220,180,100,${this.overtimeFlash * 0.12})`
      ctx.fillRect(0, 0, this.width, this.height)
    }
    if (this.endFlash > 0) {
      ctx.fillStyle = `rgba(255,236,200,${this.endFlash * 0.18})`
      ctx.fillRect(0, 0, this.width, this.height)
    }
  }

  private makeWoodTexture(): HTMLCanvasElement {
    const size = 512
    const c = document.createElement('canvas')
    c.width = size
    c.height = size
    const g = c.getContext('2d')!
    const grad = g.createLinearGradient(0, 0, size, size)
    grad.addColorStop(0, '#e0bb85')
    grad.addColorStop(0.42, '#d2aa74')
    grad.addColorStop(0.7, '#c79a63')
    grad.addColorStop(1, '#bb8c56')
    g.fillStyle = grad
    g.fillRect(0, 0, size, size)

    let seed = 17
    const rnd = () => {
      seed = (seed * 16807) % 2147483647
      return seed / 2147483647
    }

    for (let i = 0; i < 170; i++) {
      const y = rnd() * size
      const alpha = 0.015 + rnd() * 0.035
      g.strokeStyle = `rgba(92,58,28,${alpha})`
      g.lineWidth = 0.6 + rnd() * 1.6
      g.beginPath()
      g.moveTo(0, y)
      for (let x = 0; x <= size; x += 24) {
        g.lineTo(x, y + Math.sin(x * 0.02 + i) * 2.4 + Math.sin(x * 0.05 + i * 2) * 0.8)
      }
      g.stroke()
    }
    for (let i = 0; i < 5; i++) {
      const x = 60 + rnd() * 390
      const y = 60 + rnd() * 390
      g.strokeStyle = 'rgba(90,54,24,.06)'
      g.lineWidth = 1
      for (let k = 0; k < 5; k++) {
        g.beginPath()
        g.ellipse(x, y, 6 + k * 4, 2.5 + k * 1.6, 0.6, 0, Math.PI * 2)
        g.stroke()
      }
    }
    return c
  }
}
