import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { BattleEngine } from '../../engine/battle'
import type { BattleConfig } from '../../engine/config'
import type { BattleEvent, BattlePhase, Team, Unit, UnitType } from '../../engine/types'
import type { Tactic } from '../../engine/tactics/api'
import { BattleRenderer, type RenderOptions } from '../../render/renderer'
import { AudioEngine } from '../../render/audio'

export interface TeamHud {
  alive: number
  damage: number
  siege: number
  kills: number
  deaths: number
  rejections: number
  rejectSamples: Array<{ reason: string; detail: string; count: number }>
  types: Array<{ type: UnitType; alive: number; initial: number; damage: number }>
}

export interface SelectedHud {
  id: number
  type: UnitType
  team: Team
  name: string
  hp: number
  maxHp: number
  alive: boolean
  form: string
  jumpPhase: string
  teleportPhase: string
  stun: number
  cooldown: number
  outOfCombat: number
  respawnIn: number
  intent: string
  skill: string
  x: number
  y: number
}

export interface Hud {
  time: number
  phase: BattlePhase
  remaining: number
  overtimeElapsed: number
  redBaseHp: number
  blackBaseHp: number
  redBaseMax: number
  blackBaseMax: number
  redAlive: number
  blackAlive: number
  red: TeamHud
  black: TeamHud
  winner: Team | null
  reason: string | null
  selected: SelectedHud | null
}

export interface LogItem {
  id: number
  time: number
  text: string
  tone: 'red' | 'black' | 'gold' | 'muted'
  kind: string
}

const TYPE_NAMES: Record<UnitType, string> = {
  base: '基地',
  rook: '车',
  horse: '马',
  cannon: '炮',
  pawn: '兵',
  advisor: '士',
  elephant: '象',
}

function emptyTeamHud(): TeamHud {
  return {
    alive: 0,
    damage: 0,
    siege: 0,
    kills: 0,
    deaths: 0,
    rejections: 0,
    rejectSamples: [],
    types: [],
  }
}

function initialHud(): Hud {
  return {
    time: 0,
    phase: 'normal',
    remaining: 0,
    overtimeElapsed: 0,
    redBaseHp: 0,
    blackBaseHp: 0,
    redBaseMax: 1,
    blackBaseMax: 1,
    redAlive: 0,
    blackAlive: 0,
    red: emptyTeamHud(),
    black: emptyTeamHud(),
    winner: null,
    reason: null,
    selected: null,
  }
}

function intentText(u: Unit, engine: BattleEngine): string {
  const intent = u.intent
  if (!intent) return '待命'
  switch (intent.type) {
    case 'attack': {
      const t = engine.units.find((x) => x.id === intent.targetId)
      return t ? `攻击 ${t.team === 'red' ? '红' : '黑'}${TYPE_NAMES[t.type]}` : '攻击'
    }
    case 'move':
      return '走位'
    case 'moveDir':
      return '走位'
    case 'deploy':
      return '架起'
    case 'undeploy':
      return '收炮'
    case 'jump':
      return '跃击'
    case 'teleport':
      return '星位传送'
    default:
      return '待命'
  }
}

function skillText(u: Unit): string {
  if (u.type === 'horse') return u.skillCooldown > 0 ? `跃击冷却 ${u.skillCooldown.toFixed(1)}s` : '跃击就绪'
  if (u.type === 'elephant') return u.skillCooldown > 0 ? `传送冷却 ${u.skillCooldown.toFixed(1)}s` : '传送就绪'
  if (u.type === 'cannon') {
    return u.form === 'siege' ? '已架起' : u.form === 'deploying' ? '架设中' : u.form === 'packing' ? '收炮中' : u.form === 'fleeing' ? '强制后撤' : '移动形态'
  }
  return ''
}

function reasonText(reason: string | null): string | null {
  switch (reason) {
    case 'base-destroyed':
      return '基地告破'
    case 'overtime-bleed':
      return '加时流血'
    case 'safety-cap':
      return '安全上限裁决'
    default:
      return reason
  }
}

export function useBattle(options: {
  config: BattleConfig
  red: Tactic
  black: Tactic
  seed: number
  speed: number
  muted: boolean
  render: RenderOptions
}) {
  const canvasRef = ref<HTMLCanvasElement | null>(null)
  const hud = ref<Hud>(initialHud())
  const logs = ref<LogItem[]>([])
  const paused = ref(false)
  const speed = ref(options.speed)
  const muted = ref(options.muted)
  const renderOptions = ref(options.render)
  const selectedId = ref<number | null>(null)
  const ready = ref(false)
  const engine = shallowRef<BattleEngine | null>(null)
  const renderer = shallowRef<BattleRenderer | null>(null)
  const audio = new AudioEngine()
  const onVisibility = () => audio.setMuted(muted.value || document.hidden)
  let raf = 0
  let last = 0
  let acc = 0
  let lastHud = 0
  let logId = 1
  let lastBaseLog: Record<Team, number> = { red: 0, black: 0 }
  let destroyed = false

  const pushLog = (text: string, tone: LogItem['tone'], kind: string, time: number) => {
    logs.value.unshift({ id: logId++, time, text, tone, kind })
    if (logs.value.length > 80) logs.value.splice(80)
  }

  const makeEngine = () =>
    new BattleEngine({
      config: options.config,
      tactics: { red: options.red, black: options.black },
      seed: options.seed,
    })

  const updateHud = (force = false) => {
    const e = engine.value
    if (!e) return
    const now = performance.now()
    if (!force && now - lastHud < 100) return
    lastHud = now
    const summary = e.getSummary()
    const toTeam = (team: Team): TeamHud => {
      const st = summary.stats[team]
      const types = (['rook', 'horse', 'cannon', 'pawn', 'advisor', 'elephant'] as UnitType[]).map(
        (type) => ({
          type,
          alive: st.byType[type].alive,
          initial: st.byType[type].initial,
          damage: st.byType[type].damage,
        }),
      )
      return {
        alive: team === 'red' ? summary.redAlive : summary.blackAlive,
        damage: st.damage,
        siege: st.siege,
        kills: st.kills,
        deaths: st.deaths,
        rejections: st.rejections,
        rejectSamples: st.rejectSamples.slice(0, 4).map((x) => ({ ...x })),
        types,
      }
    }
    const sel = selectedId.value !== null ? e.units.find((u) => u.id === selectedId.value) : null
    let selected: SelectedHud | null = null
    if (sel) {
      selected = {
        id: sel.id,
        type: sel.type,
        team: sel.team,
        name: TYPE_NAMES[sel.type],
        hp: sel.hp,
        maxHp: sel.maxHp,
        alive: sel.alive,
        form: sel.form,
        jumpPhase: sel.jumpPhase,
        teleportPhase: sel.tpPhase,
        stun: sel.stun,
        cooldown: sel.cooldown,
        outOfCombat: sel.outOfCombat,
        respawnIn: sel.respawnTimer,
        intent: intentText(sel, e),
        skill: skillText(sel),
        x: sel.x,
        y: sel.y,
      }
    }
    hud.value = {
      time: summary.duration,
      phase: summary.phase,
      remaining: e.remaining,
      overtimeElapsed: e.overtimeElapsed,
      redBaseHp: summary.redBaseHp,
      blackBaseHp: summary.blackBaseHp,
      redBaseMax: summary.redBaseMax,
      blackBaseMax: summary.blackBaseMax,
      redAlive: summary.redAlive,
      blackAlive: summary.blackAlive,
      red: toTeam('red'),
      black: toTeam('black'),
      winner: summary.winner,
      reason: reasonText(summary.reason),
      selected,
    }
  }

  const handleEvent = (ev: BattleEvent, e: BattleEngine) => {
    if (ev.type === 'death') {
      const teamName = ev.team === 'red' ? '红' : '黑'
      const name = ev.unitType ? TYPE_NAMES[ev.unitType] : '单位'
      if (ev.unitType === 'base') {
        pushLog(`${teamName}方基地告破`, ev.team === 'red' ? 'black' : 'red', 'base', e.time)
      } else {
        pushLog(`${teamName}方 ${name} 阵亡`, ev.team === 'red' ? 'red' : 'black', 'death', e.time)
      }
    } else if (ev.type === 'base-hit' && ev.meta !== 'bleed' && ev.amount && ev.amount > 25) {
      const team = ev.team ?? 'red'
      const now = e.time
      if (now - lastBaseLog[team] > 1.4) {
        lastBaseLog[team] = now
        pushLog(`${team === 'red' ? '红' : '黑'}方基地受到 ${Math.round(ev.amount)} 点伤害`, 'gold', 'base-hit', now)
      }
    } else if (ev.type === 'overtime') {
      pushLog('局时耗尽 · 加时开始，双方基地开始流血', 'gold', 'overtime', e.time)
    } else if (ev.type === 'end') {
      const winner = ev.winner === 'red' ? '红方' : '黑方'
      pushLog(`${winner}获胜 · ${reasonText(ev.reason ?? null) ?? ''}`, 'gold', 'end', e.time)
    }
  }

  const loop = (ts: number) => {
    const e = engine.value
    const r = renderer.value
    if (!e || !r) return
    const dt = Math.min(0.1, (ts - last) / 1000 || 0)
    last = ts
    if (!paused.value && e.phase !== 'ended') {
      acc += dt * speed.value
      const fixed = options.config.physics.step
      let steps = 0
      while (acc >= fixed && steps < 16) {
        e.step()
        acc -= fixed
        steps++
        if ((e.phase as BattlePhase) === 'ended') break
      }
      if (steps >= 16) acc = 0
      const events = e.drainEvents()
      if (events.length) {
        r.pushEvents(events)
        for (const ev of events) {
          audio.play(ev)
          handleEvent(ev, e)
        }
      }
      if ((e.phase as BattlePhase) === 'ended' && !destroyed) {
        destroyed = true
        paused.value = true
        updateHud(true)
      }
    }
    r.render(ts)
    if (!paused.value) updateHud()
    else if (!destroyed) updateHud()
    raf = requestAnimationFrame(loop)
  }

  const init = () => {
    if (!canvasRef.value) return
    audio.unlock()
    document.addEventListener('visibilitychange', onVisibility)
    audio.setMuted(muted.value)
    const e = makeEngine()
    engine.value = e
    const r = new BattleRenderer(canvasRef.value, e, renderOptions.value)
    renderer.value = r
    r.setOnSelect((id) => {
      selectedId.value = id
      updateHud(true)
    })
    r.setSelection(selectedId.value)
    updateHud(true)
    pushLog(
      `对局开始 · 种子 ${options.seed} · 局时 ${options.config.match.duration ?? '不限'}`,
      'muted',
      'start',
      0,
    )
    ready.value = true
    last = performance.now()
    raf = requestAnimationFrame(loop)
  }

  const togglePause = () => {
    if (hud.value.phase === 'ended') return
    paused.value = !paused.value
  }

  const setSpeed = (v: number) => {
    speed.value = v
  }

  const setMuted = (v: boolean) => {
    muted.value = v
    audio.setMuted(v)
  }

  const selectUnit = (id: number | null) => {
    selectedId.value = id
    renderer.value?.setSelection(id)
    updateHud(true)
  }

  watch(renderOptions, (v) => renderer.value?.setOptions({ ...v }), { deep: true })
  watch(selectedId, (id) => renderer.value?.setSelection(id))

  onMounted(init)

  onBeforeUnmount(() => {
    cancelAnimationFrame(raf)
    document.removeEventListener('visibilitychange', onVisibility)
    renderer.value?.destroy()
    audio.dispose()
    renderer.value = null
    engine.value = null
  })

  return {
    canvasRef,
    hud,
    logs,
    paused,
    speed,
    muted,
    renderOptions,
    selectedId,
    ready,
    engine,
    togglePause,
    setSpeed,
    setMuted,
    selectUnit,
    audio,
  }
}
