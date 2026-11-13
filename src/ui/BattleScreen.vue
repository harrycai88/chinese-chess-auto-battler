<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getTactic } from '../engine/tactics'
import { UNIT_META } from '../engine/config'
import { useBattle } from './composables/useBattle'
import type { LaunchOptions } from './types'
import { displayAuthor } from './avatars'
import Icon from './components/Icon.vue'
import ToggleSwitch from './components/ToggleSwitch.vue'
import MobileInfoDrawer from './components/MobileInfoDrawer.vue'
import TacticAvatar from './components/TacticAvatar.vue'

const props = defineProps<{ launch: LaunchOptions }>()
const emit = defineEmits<{ exit: []; rematch: [] }>()

const red = getTactic(props.launch.redId)
const black = getTactic(props.launch.blackId)

const {
  canvasRef,
  hud,
  logs,
  paused,
  speed,
  muted,
  renderOptions,
  selectedId,
  togglePause,
  setSpeed,
  setMuted,
  selectUnit,
} = useBattle({
  config: props.launch.config,
  red,
  black,
  seed: props.launch.seed,
  speed: props.launch.speed,
  muted: props.launch.muted,
  render: {
    screenShake: true,
    ...props.launch.render,
  },
})

const redAuthor = computed(() => displayAuthor(red.author))
const blackAuthor = computed(() => displayAuthor(black.author))

const settingsOpen = ref(false)
const mobileInfo = ref(false)
const showResult = ref(false)
const resultDismissed = ref(false)
const showIntro = ref(true)

let introTimer = 0

watch(
  () => hud.value.phase,
  (p) => {
    if (p === 'ended' && !resultDismissed.value) showResult.value = true
  },
)

const unlimited = computed(() => props.launch.config.match.duration === null)

const redPct = computed(() => Math.max(0, Math.min(100, (hud.value.redBaseHp / hud.value.redBaseMax) * 100)))
const blackPct = computed(() => Math.max(0, Math.min(100, (hud.value.blackBaseHp / hud.value.blackBaseMax) * 100)))
const lowRed = computed(() => redPct.value < 28)
const lowBlack = computed(() => blackPct.value < 28)

const timerText = computed(() => {
  if (hud.value.phase === 'overtime') return formatTime(hud.value.overtimeElapsed)
  if (hud.value.phase === 'ended') return formatTime(hud.value.time)
  if (unlimited.value) return formatTime(hud.value.time)
  return formatTime(hud.value.remaining)
})
const timerLabel = computed(() => {
  if (hud.value.phase === 'overtime') return '加时已进行'
  if (hud.value.phase === 'ended') return '本局耗时'
  if (unlimited.value) return '已进行'
  return '局时剩余'
})
const phaseText = computed(() => {
  if (hud.value.phase === 'overtime') return '加时'
  if (hud.value.phase === 'ended') return '终局'
  return '常规'
})
const phaseClass = computed(() => {
  if (hud.value.phase === 'overtime') return 'border-gold-400/60 bg-gold-300/20 text-gold-600'
  if (hud.value.phase === 'ended') return 'border-ink-300 bg-ink-800/[.06] text-ink-500'
  return 'border-jade-500/30 bg-jade-500/[.08] text-jade-600'
})

const winnerText = computed(() => (hud.value.winner === 'red' ? '红方胜' : '黑方胜'))
const winnerTeam = computed(() => hud.value.winner ?? 'red')

const typeRows = computed(() =>
  hud.value.red.types.map((r, i) => ({
    type: r.type,
    red: r,
    black: hud.value.black.types[i],
  })),
)

const selected = computed(() => hud.value.selected)
const selectedMeta = computed(() => (selected.value ? UNIT_META[selected.value.type] : null))
const selectedChar = computed(() => {
  if (!selected.value || !selectedMeta.value) return ''
  return selectedMeta.value.chars[selected.value.team]
})

function formatTime(sec: number): string {
  if (!Number.isFinite(sec)) return '∞'
  const s = Math.max(0, sec)
  const m = Math.floor(s / 60)
  const r = Math.floor(s % 60)
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
}

function fmt(n: number): string {
  if (n >= 10000) return `${(n / 1000).toFixed(1)}k`
  return `${Math.round(n)}`
}

function logTime(t: number): string {
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function rejectTitle(team: 'red' | 'black'): string {
  const t = team === 'red' ? hud.value.red : hud.value.black
  if (!t.rejectSamples.length) return '没有被拒绝的意图'
  return t.rejectSamples.map((s) => `${s.reason} ×${s.count} · ${s.detail}`).join('\n')
}

function onKey(e: KeyboardEvent) {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
  if (e.code === 'Space') {
    e.preventDefault()
    togglePause()
  } else if (e.key === '1') setSpeed(1)
  else if (e.key === '2') setSpeed(2)
  else if (e.key === '4') setSpeed(4)
  else if (e.key === 'Escape') {
    settingsOpen.value = false
    showResult.value = false
  }
}

function resumeFromResult() {
  showResult.value = false
  resultDismissed.value = true
}

function toggleSettings() {
  settingsOpen.value = !settingsOpen.value
}

function onSoundToggle(on: boolean) {
  setMuted(!on)
}

async function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen()
    else await document.exitFullscreen()
  } catch {
    /* 忽略 */
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKey)
  introTimer = window.setTimeout(() => (showIntro.value = false), 1500)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  clearTimeout(introTimer)
})
</script>

<template>
  <div class="flex h-screen flex-col overflow-hidden bg-paper-100">
    <!-- 顶栏 -->
    <header class="relative z-20 border-b border-ink-200/70 bg-paper-50/90 backdrop-blur">
      <div class="flex h-[54px] items-center gap-2 px-2 sm:gap-3 sm:px-4">
        <button class="icon-btn shrink-0" type="button" title="返回配置" @click="emit('exit')">
          <Icon name="arrow-left" :size="16" />
        </button>

        <div class="flex min-w-0 items-center gap-2">
          <div class="seal h-8 w-8 shrink-0 text-[15px]">棋</div>
          <div class="leading-tight">
            <div class="font-display text-[15px] font-bold tracking-wide text-ink-800">棋阵 · 观战</div>
            <div class="font-mono text-[9px] tracking-[0.08em] text-ink-300">SEED {{ launch.seed }}</div>
          </div>
        </div>

        <div class="hidden h-6 w-px shrink-0 bg-ink-200/70 md:block"></div>

        <div class="hidden min-w-0 flex-1 items-center justify-center gap-3 md:flex">
          <div class="flex min-w-0 items-center gap-1.5 rounded-full border border-ink-800/15 bg-white/70 px-2.5 py-1">
            <TacticAvatar :author="black.author" size="xs" team="black" />
            <span class="max-w-[140px] truncate text-[11px] font-semibold text-ink-700">{{ blackAuthor }}</span>
          </div>
          <span class="font-display text-xs font-bold text-ink-300">VS</span>
          <div class="flex min-w-0 items-center gap-1.5 rounded-full border border-vermilion-600/20 bg-white/70 px-2.5 py-1">
            <span class="max-w-[140px] truncate text-[11px] font-semibold text-ink-700">{{ redAuthor }}</span>
            <TacticAvatar :author="red.author" size="xs" team="red" />
          </div>
        </div>

        <div class="ml-auto flex shrink-0 items-center gap-1.5">
          <div class="hidden items-center lg:flex">
            <div class="segment !border-ink-200/70 !bg-paper-100/70 !p-0.5">
              <button
                v-for="s in [0.5, 1, 2, 4]"
                :key="s"
                type="button"
                class="!px-2 !py-1 !text-[10px]"
                :class="{ active: speed === s }"
                @click="setSpeed(s)"
              >
                {{ s }}×
              </button>
            </div>
          </div>
          <button class="icon-btn" type="button" :title="muted ? '开启音效' : '静音'" @click="setMuted(!muted)">
            <Icon :name="muted ? 'mute' : 'volume'" :size="16" />
          </button>
          <button class="icon-btn" type="button" title="画面设置" @click="toggleSettings">
            <Icon name="settings" :size="16" />
          </button>
          <button
            v-if="hud.phase === 'ended'"
            class="btn-ink !h-9 !px-3 !py-0 text-[11px]"
            type="button"
            @click="showResult = true; resultDismissed = false"
          >
            <Icon name="flag" :size="14" />
            <span class="hidden sm:inline">战报</span>
          </button>
          <button v-else class="btn-ink !h-9 !px-3 !py-0 text-[11px]" type="button" @click="togglePause">
            <Icon :name="paused ? 'play' : 'pause'" :size="14" />
            <span class="hidden sm:inline">{{ paused ? '继续' : '暂停' }}</span>
          </button>
        </div>
      </div>
    </header>

    <!-- 主体 -->
    <div class="flex min-h-0 flex-1">
      <!-- 左侧 -->
      <aside class="hidden w-[256px] shrink-0 flex-col overflow-y-auto border-r border-ink-200/70 bg-paper-50/60 xl:flex">
        <div class="border-b border-ink-200/60 px-4 py-4">
          <div class="kicker">Commanders</div>
          <div class="mt-2 space-y-2.5">
            <div class="rounded-lg border border-vermilion-600/20 bg-vermilion-600/[.04] p-2.5">
              <div class="flex items-center gap-2">
                <TacticAvatar :author="red.author" size="sm" team="red" />
                <div class="min-w-0 flex-1">
                  <div class="truncate text-[11px] font-bold text-ink-800">{{ redAuthor }}</div>
                  <div class="text-[9px] text-ink-400">红方 · {{ red.source === 'external' ? '外部策略' : '内置策略' }} · v{{ red.version }}</div>
                </div>
              </div>
              <div class="mt-2 flex items-center justify-between text-[9px] text-ink-400">
                <span>决策 {{ Math.round(hud.time * 8) }}</span>
                <span :class="hud.red.rejections > 0 ? 'text-amber-600' : ''" :title="rejectTitle('red')">拒绝 {{ hud.red.rejections }}</span>
              </div>
            </div>
            <div class="rounded-lg border border-ink-800/15 bg-ink-800/[.03] p-2.5">
              <div class="flex items-center gap-2">
                <TacticAvatar :author="black.author" size="sm" team="black" />
                <div class="min-w-0 flex-1">
                  <div class="truncate text-[11px] font-bold text-ink-800">{{ blackAuthor }}</div>
                  <div class="text-[9px] text-ink-400">黑方 · {{ black.source === 'external' ? '外部策略' : '内置策略' }} · v{{ black.version }}</div>
                </div>
              </div>
              <div class="mt-2 flex items-center justify-between text-[9px] text-ink-400">
                <span>决策 {{ Math.round(hud.time * 8) }}</span>
                <span :class="hud.black.rejections > 0 ? 'text-amber-600' : ''" :title="rejectTitle('black')">拒绝 {{ hud.black.rejections }}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="border-b border-ink-200/60 px-4 py-4">
          <div class="flex items-center justify-between">
            <span class="kicker">Forces</span>
            <span class="flex items-center gap-3 text-[9px]">
              <span class="flex items-center gap-1 text-vermilion-600"><span class="h-1 w-1 rounded-full bg-vermilion-500"></span>红</span>
              <span class="flex items-center gap-1 text-ink-500"><span class="h-1 w-1 rounded-full bg-ink-700"></span>黑</span>
            </span>
          </div>
          <div class="mt-2.5 space-y-2">
            <div v-for="row in typeRows" :key="row.type" class="flex items-center gap-2">
              <span class="w-4 text-center font-display text-[11px] font-bold text-ink-600">
                {{ UNIT_META[row.type].chars.red }}
              </span>
              <div class="flex flex-1 items-center gap-1.5">
                <div class="relative h-[5px] flex-1 overflow-hidden rounded-full bg-ink-900/[.07]">
                  <div
                    class="absolute inset-y-0 left-0 rounded-full bg-vermilion-500/80"
                    :style="{ width: (row.red.alive / Math.max(1, row.red.initial)) * 100 + '%' }"
                  />
                </div>
                <span class="num w-5 text-right font-mono text-[9px] text-ink-500">{{ row.red.alive }}</span>
                <span class="w-4 text-center text-[9px] text-ink-300">·</span>
                <span class="num w-5 text-left font-mono text-[9px] text-ink-500">{{ row.black.alive }}</span>
                <div class="relative h-[5px] flex-1 overflow-hidden rounded-full bg-ink-900/[.07]">
                  <div
                    class="absolute inset-y-0 right-0 rounded-full bg-ink-700/80"
                    :style="{ width: (row.black.alive / Math.max(1, row.black.initial)) * 100 + '%' }"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="px-4 py-4">
          <div class="kicker">Output</div>
          <div class="mt-2.5 space-y-2.5">
            <div>
              <div class="mb-1 flex justify-between text-[9px]">
                <span class="font-semibold text-vermilion-600">红方总伤害</span>
                <span class="num font-mono text-ink-600">{{ fmt(hud.red.damage) }}</span>
              </div>
              <div class="flex h-1.5 overflow-hidden rounded-full bg-ink-900/[.06]">
                <div
                  class="h-full bg-gradient-to-r from-vermilion-700 to-vermilion-500"
                  :style="{ width: Math.min(100, (hud.red.damage / Math.max(1, hud.red.damage + hud.black.damage)) * 100) + '%' }"
                />
                <div class="h-full flex-1 bg-ink-700/70" />
              </div>
            </div>
            <div class="grid grid-cols-2 gap-2">
              <div class="rounded-lg bg-paper-100/80 p-2">
                <div class="text-[9px] text-ink-400">攻城伤害</div>
                <div class="num mt-0.5 font-mono text-[13px] font-bold text-ink-800">{{ fmt(hud.red.siege) }}</div>
              </div>
              <div class="rounded-lg bg-paper-100/80 p-2">
                <div class="text-[9px] text-ink-400">击杀</div>
                <div class="num mt-0.5 font-mono text-[13px] font-bold text-ink-800">{{ hud.red.kills }}</div>
              </div>
            </div>
            <div class="flex items-center justify-between text-[10px] text-ink-400">
              <span>黑方伤害</span>
              <span class="num font-mono text-ink-600">{{ fmt(hud.black.damage) }}</span>
            </div>
            <div class="flex items-center justify-between text-[10px] text-ink-400">
              <span>黑方攻城</span>
              <span class="num font-mono text-ink-600">{{ fmt(hud.black.siege) }}</span>
            </div>
          </div>
        </div>
      </aside>

      <!-- 中央战场（外框自适应居中，计时器置顶于观战框外，内部严格 16:9 观战框） -->
      <main class="flex min-w-0 flex-1 flex-col bg-paper-200/40">
        <!-- 计时器（观战区外上方，不遮挡棋盘） -->
        <div class="flex shrink-0 items-center justify-center px-2 pt-2">
          <div class="flex items-center gap-2 rounded-xl border border-ink-200/80 bg-paper-50/95 px-3.5 py-1 shadow-sm backdrop-blur-sm sm:gap-2.5 sm:px-4 sm:py-1.5">
            <span class="num font-display text-[17px] font-bold leading-none text-ink-800 sm:text-[20px]">
              {{ timerText }}
            </span>
            <span
              class="rounded border px-1.5 py-0.5 text-[8px] font-bold tracking-[0.14em] sm:text-[9px]"
              :class="phaseClass"
            >
              {{ phaseText }}
            </span>
            <span class="text-[9px] tracking-[0.12em] text-ink-400 sm:text-[10px]">
              {{ timerLabel }}
            </span>
          </div>
        </div>

        <div class="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-1.5 sm:px-3 sm:pb-3 sm:pt-1.5">
          <div class="flex h-full w-full items-center justify-center" style="container-type: size;">
            <div
              class="battle-stage relative overflow-hidden rounded-2xl border border-ink-300/60 shadow-panel"
              style="width: min(100cqw, calc(100cqh * 16 / 9)); height: min(100cqh, calc(100cqw * 9 / 16));"
            >
              <canvas
                ref="canvasRef"
                class="relative block h-full w-full"
                role="application"
                aria-label="实时象棋战场，点击棋子查看状态"
              />

              <!-- 左上角：黑方 模型/作者 + 头像 + 血量条（不显示战术标题，紧凑矩形卡片置于棋盘外侧留白） -->
              <div class="pointer-events-none absolute left-[1.8%] top-[2.6%] z-10 w-[19%] min-w-[112px] max-w-[168px]">
                <div class="flex flex-col items-center rounded-xl border border-ink-800/20 bg-paper-50/95 p-1.5 text-center shadow-sm backdrop-blur-sm sm:p-2.5">
                  <div class="flex items-center gap-1.5">
                    <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-ink-800"></span>
                    <span class="text-[9px] font-semibold tracking-wider text-ink-500">黑方</span>
                  </div>
                  <div class="mt-1 sm:mt-1.5">
                    <TacticAvatar :author="black.author" size="md" team="black" class="!h-8 !w-8 sm:!h-11 sm:!w-11" />
                  </div>
                  <div class="mt-1 w-full truncate text-[11px] font-bold leading-tight text-ink-800 sm:mt-1.5 sm:text-[12px]">
                    {{ blackAuthor }}
                  </div>
                  <div class="relative mt-1.5 h-[6px] w-full overflow-hidden rounded-full border border-ink-900/[.06] bg-ink-900/[.08] sm:mt-2">
                    <div
                      class="hud-bar absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-ink-900 to-ink-700"
                      :class="lowBlack ? 'animate-pulse' : ''"
                      :style="{ width: blackPct + '%' }"
                    />
                  </div>
                  <div class="num mt-1 font-mono text-[9px] font-semibold text-ink-500 sm:text-[10px]">
                    {{ Math.round(hud.blackBaseHp) }}<span class="hidden text-ink-300 sm:inline"> / {{ hud.blackBaseMax }}</span>
                  </div>
                </div>
              </div>

              <!-- 右下角：红方 模型/作者 + 头像 + 血量条（不显示战术标题，紧凑矩形卡片置于棋盘外侧留白） -->
              <div class="pointer-events-none absolute bottom-[2.6%] right-[1.8%] z-10 w-[19%] min-w-[112px] max-w-[168px]">
                <div class="flex flex-col items-center rounded-xl border border-vermilion-600/25 bg-paper-50/95 p-1.5 text-center shadow-sm backdrop-blur-sm sm:p-2.5">
                  <div class="flex items-center gap-1.5">
                    <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-vermilion-500"></span>
                    <span class="text-[9px] font-semibold tracking-wider text-vermilion-600">红方</span>
                  </div>
                  <div class="mt-1 sm:mt-1.5">
                    <TacticAvatar :author="red.author" size="md" team="red" class="!h-8 !w-8 sm:!h-11 sm:!w-11" />
                  </div>
                  <div class="mt-1 w-full truncate text-[11px] font-bold leading-tight text-ink-800 sm:mt-1.5 sm:text-[12px]">
                    {{ redAuthor }}
                  </div>
                  <div class="relative mt-1.5 h-[6px] w-full overflow-hidden rounded-full border border-ink-900/[.06] bg-ink-900/[.08] sm:mt-2">
                    <div
                      class="hud-bar absolute inset-y-0 right-0 rounded-full bg-gradient-to-l from-vermilion-700 to-vermilion-500"
                      :class="lowRed ? 'animate-pulse' : ''"
                      :style="{ width: redPct + '%' }"
                    />
                  </div>
                  <div class="num mt-1 font-mono text-[9px] font-semibold text-ink-500 sm:text-[10px]">
                    {{ Math.round(hud.redBaseHp) }}<span class="hidden text-ink-300 sm:inline"> / {{ hud.redBaseMax }}</span>
                  </div>
                </div>
              </div>

          <!-- 开战横幅 -->
          <Transition name="fade">
            <div v-if="showIntro" class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
              <div class="flex flex-col items-center">
                <div class="font-display text-[64px] font-bold tracking-[0.2em] text-ink-900/80 drop-shadow-sm sm:text-[86px]">
                  开战
                </div>
                <div class="mt-1 text-[10px] font-semibold tracking-[0.42em] text-ink-500/70">BATTLE START</div>
              </div>
            </div>
          </Transition>

          <!-- 暂停 -->
          <Transition name="fade">
            <div
              v-if="paused && hud.phase !== 'ended' && !showResult"
              class="absolute inset-0 z-10 flex items-center justify-center bg-paper-100/35 backdrop-blur-[1px]"
            >
              <div class="panel flex flex-col items-center px-8 py-6">
                <div class="font-display text-2xl font-bold text-ink-800">已暂停</div>
                <p class="mt-1 text-[11px] text-ink-400">战局不会在暂停时推进</p>
                <button class="btn-primary mt-4 !px-5 !py-2" type="button" @click="togglePause">
                  <Icon name="play" :size="14" />
                  继续观战
                </button>
              </div>
            </div>
          </Transition>

          <!-- 结算 -->
          <Transition name="fade">
            <div
              v-if="showResult"
              class="absolute inset-0 z-20 flex items-center justify-center bg-ink-900/25 p-4 backdrop-blur-[2px]"
            >
              <div class="panel relative w-full max-w-[420px] overflow-hidden p-6 text-center shadow-float">
                <div class="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-gold-300/25 to-transparent" />
                <div class="relative flex flex-col items-center">
                  <div
                    class="seal h-14 w-14 text-2xl"
                    :class="winnerTeam === 'red' ? '' : 'seal-ink'"
                  >
                    胜
                  </div>
                  <div class="kicker mt-4">Battle Ended</div>
                  <h2
                    class="mt-1 font-display text-[40px] font-bold leading-none"
                    :class="winnerTeam === 'red' ? 'text-vermilion-600' : 'text-ink-800'"
                  >
                    {{ winnerText }}
                  </h2>
                  <p class="mt-2 text-[11px] text-ink-400">
                    {{ hud.reason }} · 本局 {{ formatTime(hud.time) }} · 种子 {{ launch.seed }}
                  </p>

                  <div class="mt-5 grid w-full grid-cols-3 gap-2">
                    <div class="rounded-lg border border-ink-200/60 bg-paper-100/60 p-2.5">
                      <div class="text-[9px] text-ink-400">红方基地</div>
                      <div class="num mt-0.5 font-mono text-[14px] font-bold text-vermilion-600">
                        {{ Math.round(hud.redBaseHp) }}
                      </div>
                    </div>
                    <div class="rounded-lg border border-ink-200/60 bg-paper-100/60 p-2.5">
                      <div class="text-[9px] text-ink-400">总伤害</div>
                      <div class="num mt-0.5 font-mono text-[14px] font-bold text-ink-800">
                        {{ fmt(hud.red.damage + hud.black.damage) }}
                      </div>
                    </div>
                    <div class="rounded-lg border border-ink-200/60 bg-paper-100/60 p-2.5">
                      <div class="text-[9px] text-ink-400">黑方基地</div>
                      <div class="num mt-0.5 font-mono text-[14px] font-bold text-ink-700">
                        {{ Math.round(hud.blackBaseHp) }}
                      </div>
                    </div>
                  </div>

                  <div class="mt-5 flex w-full gap-2">
                    <button class="btn-primary flex-1" type="button" @click="emit('rematch')">
                      <Icon name="rotate" :size="14" />
                      再战一局
                    </button>
                    <button class="btn-ghost flex-1" type="button" @click="emit('exit')">
                      调整策略
                    </button>
                  </div>
                  <button class="mt-3 text-[10px] text-ink-400 underline decoration-ink-300 underline-offset-4 hover:text-ink-700" type="button" @click="resumeFromResult">
                    留在战场查看
                  </button>
                </div>
              </div>
            </div>
          </Transition>

          <!-- 画面设置 -->
          <Transition name="fade">
            <div v-if="settingsOpen" class="absolute inset-0 z-30">
              <div class="absolute inset-0" @click="settingsOpen = false" />
              <div class="panel absolute right-3 top-3 w-[230px] p-3.5">
                <div class="flex items-center justify-between">
                  <span class="text-[11px] font-bold text-ink-700">画面与声音</span>
                  <button class="icon-btn !h-6 !w-6 !border-0 !bg-transparent" type="button" @click="settingsOpen = false">
                    <Icon name="x" :size="13" />
                  </button>
                </div>
                <div class="mt-2 space-y-0.5">
                  <ToggleSwitch v-model="renderOptions.damageNumbers" label="伤害数字" />
                  <ToggleSwitch v-model="renderOptions.effects" label="战场特效" />
                  <ToggleSwitch v-model="renderOptions.screenShake" label="画面震动" />
                  <ToggleSwitch v-model="renderOptions.intentLines" label="意图线" />
                  <ToggleSwitch :model-value="!muted" label="音效" @update:model-value="onSoundToggle" />
                </div>
                <div class="mt-2 border-t border-ink-200/70 pt-2">
                  <div class="text-[9px] text-ink-400">观战速度</div>
                  <div class="mt-1 grid grid-cols-4 gap-1">
                    <button
                      v-for="s in [0.5, 1, 2, 4]"
                      :key="'sp' + s"
                      type="button"
                      class="rounded-md border py-1 text-[10px] font-semibold transition"
                      :class="speed === s ? 'border-ink-800 bg-ink-800 text-paper-50' : 'border-ink-200 text-ink-500 hover:bg-white'"
                      @click="setSpeed(s)"
                    >
                      {{ s }}×
                    </button>
                  </div>
                </div>
                <button class="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-ink-200 py-1.5 text-[10px] text-ink-500 hover:bg-white" type="button" @click="toggleFullscreen">
                  <Icon name="maximize" :size="12" />
                  全屏观战
                </button>
              </div>
            </div>
          </Transition>
            </div>
          </div>
        </div>

        <!-- 棋盘下方摘要 -->
        <div class="flex h-[46px] shrink-0 items-center gap-3 overflow-hidden border-t border-ink-200/70 bg-paper-50/80 px-3 sm:px-4">
          <div class="flex items-center gap-1.5">
            <span class="h-1.5 w-1.5 rounded-full bg-vermilion-500"></span>
            <span class="num font-mono text-[11px] font-bold text-ink-700">{{ hud.redAlive }}</span>
            <span class="text-[9px] text-ink-300">vs</span>
            <span class="num font-mono text-[11px] font-bold text-ink-700">{{ hud.blackAlive }}</span>
            <span class="h-1.5 w-1.5 rounded-full bg-ink-800"></span>
          </div>
          <div class="h-4 w-px bg-ink-200"></div>
          <div class="flex min-w-0 items-center gap-2">
            <Icon name="swords" :size="13" class="shrink-0 text-ink-300" />
            <span class="truncate text-[10px] text-ink-500">
              <template v-if="logs.length">
                <span class="mr-1.5 font-mono text-[9px] text-ink-300">{{ logTime(logs[0].time) }}</span>
                {{ logs[0].text }}
              </template>
              <template v-else>战局推进中…</template>
            </span>
          </div>
          <button
            class="ml-auto flex items-center gap-1 text-[10px] text-ink-500 hover:text-ink-800 xl:hidden"
            type="button"
            @click="mobileInfo = true"
          >
            <Icon name="flag" :size="12" />
            战报
          </button>
          <div class="ml-auto hidden items-center gap-2 xl:flex">
            <button class="text-[10px] text-ink-400 hover:text-ink-700" type="button" @click="settingsOpen = !settingsOpen">
              画面
            </button>
            <span class="h-3 w-px bg-ink-200"></span>
            <button class="text-[10px] text-ink-400 hover:text-ink-700" type="button" @click="emit('exit')">
              返回配置
            </button>
          </div>
        </div>
      </main>

      <!-- 右侧 -->
      <aside class="hidden w-[300px] shrink-0 flex-col border-l border-ink-200/70 bg-paper-50/60 xl:flex">
        <div class="border-b border-ink-200/60 p-4">
          <div class="flex items-center justify-between">
            <span class="kicker">Unit File</span>
            <button
              v-if="selected"
              class="text-[9px] text-ink-300 hover:text-ink-600"
              type="button"
              @click="selectUnit(null)"
            >
              取消选择
            </button>
          </div>

          <div v-if="selected" class="mt-3">
            <div class="flex items-center gap-3">
              <div
                class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 font-display text-xl font-bold"
                :class="
                  selected.team === 'red'
                    ? 'border-vermilion-600/30 bg-vermilion-600 text-paper-50'
                    : 'border-ink-800 bg-ink-800 text-paper-50'
                "
              >
                {{ selectedChar }}
              </div>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <span class="font-display text-[17px] font-bold text-ink-800">{{ selected.name }}</span>
                  <span
                    class="rounded px-1.5 py-0.5 text-[9px] font-semibold"
                    :class="selected.team === 'red' ? 'bg-vermilion-600/10 text-vermilion-600' : 'bg-ink-800/10 text-ink-700'"
                  >
                    {{ selected.team === 'red' ? '红方' : '黑方' }}
                  </span>
                </div>
                <div class="mt-1 text-[9px] text-ink-400">{{ selectedMeta?.role }} · {{ selectedMeta?.name }}</div>
              </div>
            </div>

            <div class="mt-3">
              <div class="flex items-baseline justify-between">
                <span class="text-[9px] text-ink-400">生命</span>
                <span class="num font-mono text-[10px] font-semibold text-ink-600">
                  {{ Math.max(0, Math.round(selected.hp)) }} / {{ Math.round(selected.maxHp) }}
                </span>
              </div>
              <div class="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-900/[.07]">
                <div
                  class="h-full rounded-full transition-all"
                  :class="
                    selected.hp / selected.maxHp > 0.5
                      ? 'bg-jade-500'
                      : selected.hp / selected.maxHp > 0.25
                        ? 'bg-amber-500'
                        : 'bg-vermilion-500'
                  "
                  :style="{ width: Math.max(0, (selected.hp / selected.maxHp) * 100) + '%' }"
                />
              </div>
            </div>

            <div class="mt-3 grid grid-cols-2 gap-1.5 text-[10px]">
              <div class="rounded-md bg-paper-100/80 px-2 py-1.5">
                <div class="text-[8px] text-ink-300">当前意图</div>
                <div class="mt-0.5 truncate font-medium text-ink-700">{{ selected.alive ? selected.intent : '已阵亡' }}</div>
              </div>
              <div class="rounded-md bg-paper-100/80 px-2 py-1.5">
                <div class="text-[8px] text-ink-300">脱战</div>
                <div class="num mt-0.5 font-mono font-medium text-ink-700">
                  {{ selected.alive ? selected.outOfCombat.toFixed(1) + 's' : '—' }}
                </div>
              </div>
              <div class="rounded-md bg-paper-100/80 px-2 py-1.5">
                <div class="text-[8px] text-ink-300">技能 / 形态</div>
                <div class="mt-0.5 truncate font-medium text-ink-700">
                  {{ selected.alive ? selected.skill || '无' : selected.respawnIn > 0 ? `复活 ${selected.respawnIn.toFixed(0)}s` : '本局离场' }}
                </div>
              </div>
              <div class="rounded-md bg-paper-100/80 px-2 py-1.5">
                <div class="text-[8px] text-ink-300">位置</div>
                <div class="num mt-0.5 font-mono font-medium text-ink-700">
                  {{ selected.x.toFixed(1) }}, {{ selected.y.toFixed(1) }}
                </div>
              </div>
            </div>
            <p class="mt-2 line-clamp-2 text-[9px] leading-relaxed text-ink-400">{{ selectedMeta?.blurb }}</p>
          </div>

          <div v-else class="mt-3 flex flex-col items-center rounded-lg border border-dashed border-ink-200/80 bg-white/30 px-3 py-5 text-center">
            <div class="flex h-9 w-9 items-center justify-center rounded-full border border-ink-200 text-ink-300">
              <Icon name="target" :size="16" />
            </div>
            <div class="mt-2 text-[10px] font-medium text-ink-500">点击棋盘上的棋子</div>
            <div class="mt-0.5 text-[9px] text-ink-300">查看血量、形态、技能与意图</div>
          </div>
        </div>

        <div class="flex min-h-0 flex-1 flex-col">
          <div class="flex items-center justify-between px-4 py-3">
            <span class="kicker">Battle Log</span>
            <span class="flex items-center gap-1.5 text-[9px] text-ink-300">
              <span class="h-1 w-1 animate-pulse rounded-full bg-jade-500"></span>
              实时
            </span>
          </div>
          <div class="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            <div v-if="!logs.length" class="px-2 py-6 text-center text-[10px] text-ink-300">
              战斗事件会在这里出现
            </div>
            <TransitionGroup name="fade" tag="div" class="space-y-1">
              <div
                v-for="item in logs"
                :key="item.id"
                class="flex items-start gap-2 rounded-md px-2 py-1.5 transition hover:bg-white/50"
              >
                <span class="num mt-[1px] w-8 shrink-0 font-mono text-[8px] text-ink-300">{{ logTime(item.time) }}</span>
                <span
                  class="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full"
                  :class="{
                    'bg-vermilion-500': item.tone === 'red',
                    'bg-ink-700': item.tone === 'black',
                    'bg-gold-500': item.tone === 'gold',
                    'bg-ink-300': item.tone === 'muted',
                  }"
                />
                <span
                  class="text-[10px] leading-[1.5]"
                  :class="{
                    'text-vermilion-700': item.tone === 'red',
                    'text-ink-700': item.tone === 'black',
                    'text-gold-600 font-medium': item.tone === 'gold',
                    'text-ink-400': item.tone === 'muted',
                  }"
                >
                  {{ item.text }}
                </span>
              </div>
            </TransitionGroup>
          </div>
        </div>
      </aside>
    </div>

    <!-- 移动端底部信息 -->
    <div class="flex items-center gap-3 border-t border-ink-200/70 bg-paper-50/90 px-3 py-2 xl:hidden">
      <span class="text-[10px] text-ink-400">兵力</span>
      <span class="num font-mono text-[11px] font-bold text-vermilion-600">{{ hud.redAlive }}</span>
      <span class="text-[9px] text-ink-300">vs</span>
      <span class="num font-mono text-[11px] font-bold text-ink-700">{{ hud.blackAlive }}</span>
      <span class="ml-auto truncate text-[9px] text-ink-300">{{ redAuthor }} vs {{ blackAuthor }}</span>
    </div>

    <MobileInfoDrawer v-if="mobileInfo" :hud="hud" :logs="logs" @close="mobileInfo = false" />
  </div>
</template>
