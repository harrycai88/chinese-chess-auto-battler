import type { BattleEvent } from '../engine/types'

/**
 * 纯代码合成音效：没有素材、没有解码等待。
 * 引擎只说「发生了什么」，这里决定「听起来像什么」。
 */
export class AudioEngine {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private comp: DynamicsCompressorNode | null = null
  private noise: AudioBuffer | null = null
  private muted = false
  private volume = 0.62
  private nextAt = new Map<string, number>()

  dispose(): void {
    if (this.ctx) {
      void this.ctx.close()
      this.ctx = null
      this.master = null
      this.comp = null
      this.noise = null
    }
  }

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume()
      return
    }
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    const ctx = new Ctor()
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -16
    comp.knee.value = 18
    comp.ratio.value = 5
    comp.attack.value = 0.004
    comp.release.value = 0.2
    const master = ctx.createGain()
    master.gain.value = this.muted ? 0 : this.volume
    master.connect(comp)
    comp.connect(ctx.destination)
    this.ctx = ctx
    this.comp = comp
    this.master = master
    this.noise = this.makeNoise(ctx)
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : this.volume, this.ctx.currentTime, 0.02)
    }
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v))
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.02)
    }
  }

  private makeNoise(ctx: AudioContext): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * 0.6)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
    return buf
  }

  private throttle(key: string, gapMs: number): boolean {
    const now = performance.now()
    const next = this.nextAt.get(key) ?? 0
    if (now < next) return false
    this.nextAt.set(key, now + gapMs)
    return true
  }

  play(event: BattleEvent): void {
    const ctx = this.ctx
    if (!ctx || !this.master || this.muted) return
    if (ctx.state === 'suspended') return
    const pan = event.x !== undefined ? Math.max(-0.6, Math.min(0.6, (event.x / 8) * 1.2 - 0.6)) : 0
    switch (event.type) {
      case 'attack':
        if (this.throttle('attack', 38)) this.swing(pan, event.meta === 'cleave' ? 0.1 : 0.06)
        break
      case 'shoot':
        if (this.throttle('shoot', 90)) this.boom(pan, 120, 55, 0.22, 0.16)
        break
      case 'impact':
        if (event.meta === 'shell' && this.throttle('explosion', 70)) this.explosion(pan)
        break
      case 'hit':
        if (this.throttle('hit', 45)) this.tick(pan, event.amount && event.amount > 40 ? 0.9 : 0.5)
        break
      case 'death':
        if (this.throttle('death', 120)) this.death(pan)
        break
      case 'respawn':
        if (this.throttle('respawn', 140)) this.respawn(pan)
        break
      case 'deploy':
        if (this.throttle('deploy', 140)) this.clank(pan)
        break
      case 'jump':
        if (event.phase === 'dash' && this.throttle('jump', 160)) this.whoosh(pan)
        break
      case 'teleport':
        if (event.phase === 'land' && this.throttle('tp', 200)) this.shimmer(pan)
        break
      case 'base-hit':
        if (this.throttle('base', 100)) this.baseHit(pan, event.meta === 'bleed' ? 0.12 : 0.2)
        break
      case 'heal':
        if (this.throttle('heal', 420)) this.heal(pan)
        break
      case 'overtime':
        this.gong()
        break
      case 'end':
        this.end(event.winner === 'red' ? 1 : 0)
        break
      default:
        break
    }
  }

  // ── 基础合成器 ────────────────────────────────────────────────

  private out(pan: number): AudioNode {
    const ctx = this.ctx!
    if (pan === 0 || typeof ctx.createStereoPanner !== 'function') return this.master!
    const p = ctx.createStereoPanner()
    p.pan.value = pan
    p.connect(this.master!)
    return p
  }

  private tone(
    freq: number,
    endFreq: number,
    dur: number,
    gain: number,
    pan: number,
    type: OscillatorType = 'sine',
    delay = 0,
  ): void {
    const ctx = this.ctx!
    const t0 = ctx.currentTime + delay
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(Math.max(20, freq), t0)
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t0 + dur)
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + 0.012)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    osc.connect(g)
    g.connect(this.out(pan))
    osc.start(t0)
    osc.stop(t0 + dur + 0.03)
  }

  private noiseBurst(
    dur: number,
    gain: number,
    pan: number,
    filterType: BiquadFilterType,
    freq: number,
    q = 0.8,
    endFreq = freq,
    delay = 0,
  ): void {
    const ctx = this.ctx!
    if (!this.noise) return
    const t0 = ctx.currentTime + delay
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    src.loop = true
    const filter = ctx.createBiquadFilter()
    filter.type = filterType
    filter.Q.value = q
    filter.frequency.setValueAtTime(freq, t0)
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, endFreq), t0 + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    src.connect(filter)
    filter.connect(g)
    g.connect(this.out(pan))
    src.start(t0)
    src.stop(t0 + dur + 0.03)
  }

  private swing(pan: number, gain: number): void {
    this.noiseBurst(0.12, gain, pan, 'bandpass', 1600, 1.6, 700)
    this.tone(320, 180, 0.08, gain * 0.35, pan, 'triangle')
  }

  private boom(pan: number, from: number, to: number, dur: number, gain: number): void {
    this.tone(from, to, dur, gain, pan, 'sine')
    this.noiseBurst(dur * 0.7, gain * 0.55, pan, 'lowpass', 500, 0.7, 120)
  }

  private explosion(pan: number): void {
    this.boom(pan, 110, 32, 0.45, 0.3)
    this.noiseBurst(0.35, 0.22, pan, 'lowpass', 900, 0.6, 90)
    this.noiseBurst(0.08, 0.12, pan, 'highpass', 1800, 0.8, 900)
  }

  private tick(pan: number, strength: number): void {
    this.noiseBurst(0.045, 0.05 * strength, pan, 'bandpass', 2400, 2)
    this.tone(240, 140, 0.06, 0.05 * strength, pan, 'triangle')
  }

  private death(pan: number): void {
    this.tone(260, 60, 0.5, 0.1, pan, 'sawtooth')
    this.noiseBurst(0.3, 0.07, pan, 'lowpass', 600, 0.8, 100)
  }

  private respawn(pan: number): void {
    this.tone(300, 620, 0.32, 0.055, pan, 'sine')
    this.tone(600, 900, 0.26, 0.03, pan, 'sine', 0.06)
  }

  private clank(pan: number): void {
    this.noiseBurst(0.09, 0.06, pan, 'highpass', 2200, 0.9)
    this.tone(180, 120, 0.12, 0.05, pan, 'square')
  }

  private whoosh(pan: number): void {
    this.noiseBurst(0.28, 0.09, pan, 'bandpass', 420, 1.2, 2100)
  }

  private shimmer(pan: number): void {
    this.tone(620, 660, 0.3, 0.04, pan, 'sine')
    this.tone(930, 990, 0.28, 0.03, pan, 'sine', 0.03)
    this.tone(1240, 1320, 0.24, 0.02, pan, 'sine', 0.06)
    this.noiseBurst(0.2, 0.03, pan, 'highpass', 3000, 1)
  }

  private baseHit(pan: number, gain: number): void {
    this.tone(70, 34, 0.55, gain, pan, 'sine')
    this.noiseBurst(0.4, gain * 0.7, pan, 'lowpass', 300, 0.7, 60)
  }

  private heal(pan: number): void {
    this.tone(760, 940, 0.22, 0.025, pan, 'sine')
    this.tone(1140, 1200, 0.18, 0.015, pan, 'sine', 0.05)
  }

  private gong(): void {
    const ctx = this.ctx!
    if (!ctx) return
    const t0 = ctx.currentTime
    for (const [f, g] of [
      [58, 0.2],
      [87, 0.12],
      [117, 0.08],
      [174, 0.05],
    ] as const) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = f
      gain.gain.setValueAtTime(0.0001, t0)
      gain.gain.exponentialRampToValueAtTime(g, t0 + 0.03)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.4)
      osc.connect(gain)
      gain.connect(this.master!)
      osc.start(t0)
      osc.stop(t0 + 2.5)
    }
    this.noiseBurst(1.2, 0.05, 0, 'lowpass', 240, 0.7, 80)
  }

  private end(winner: number): void {
    const root = winner === 1 ? 220 : 196
    const ratios = [1, 1.25, 1.5, 2, 2.5]
    ratios.forEach((r, i) => {
      this.tone(root * r, root * r, 1.6 - i * 0.12, 0.045, 0, 'triangle', i * 0.06)
    })
    this.tone(root / 2, root / 2, 2, 0.05, 0, 'sine')
  }
}
