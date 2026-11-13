<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  ALL_TACTICS,
  BUILTIN_TACTICS,
  EXTERNAL_TACTICS,
  TACTIC_ISSUES,
  findTactic,
} from '../engine/tactics'
import { buildConfig } from '../engine/config'
import type { LaunchOptions, SavedSettings } from './types'
import { displayAuthor } from './avatars'
import StrategySelect from './components/StrategySelect.vue'
import SegmentedControl from './components/SegmentedControl.vue'
import NumberSlider from './components/NumberSlider.vue'
import ToggleSwitch from './components/ToggleSwitch.vue'
import BattlePreview from './components/BattlePreview.vue'
import RulesModal from './components/RulesModal.vue'
import TacticAvatar from './components/TacticAvatar.vue'
import Icon from './components/Icon.vue'

const emit = defineEmits<{ start: [options: LaunchOptions] }>()

const STORAGE_KEY = 'qizhen.settings.v1'

const redId = ref('charge')
const blackId = ref('counter')
const duration = ref(120)
const speed = ref(1)
const muted = ref(false)
const baseHpMul = ref(1)
const damageMul = ref(1)
const respawnMul = ref(1)
const bleedMul = ref(1)
const damageNumbers = ref(true)
const effects = ref(true)
const intentLines = ref(false)
const screenShake = ref(true)

const seed = ref(randomSeed())
const seedText = ref(String(seed.value))
const advanced = ref(false)
const rulesOpen = ref(false)

// 配置页永远有可选项：找不到就退回注册表第一套，而不是让 getTactic 抛错把页面炸掉
const redTactic = computed(() => findTactic(redId.value) ?? ALL_TACTICS[0])
const blackTactic = computed(() => findTactic(blackId.value) ?? ALL_TACTICS[0])

const durationOptions = [
  { value: 60, label: '60s', hint: '短局' },
  { value: 120, label: '120s', hint: '标准' },
  { value: 180, label: '180s', hint: '长局' },
  { value: 0, label: '∞', hint: '不限时' },
]

const speedOptions = [
  { value: 0.5, label: '0.5×', hint: '慢放' },
  { value: 1, label: '1×', hint: '标准' },
  { value: 2, label: '2×', hint: '快进' },
  { value: 4, label: '4×', hint: '疾速' },
]

const estimate = computed(() => {
  if (duration.value === 0) return '4 分钟以上'
  if (duration.value <= 60) return '约 1.5 分钟'
  if (duration.value <= 120) return '约 2.5 分钟'
  return '约 3.5 分钟'
})

const settings = computed<SavedSettings>(() => ({
  redId: redId.value,
  blackId: blackId.value,
  duration: duration.value,
  speed: speed.value,
  muted: muted.value,
  baseHpMul: baseHpMul.value,
  damageMul: damageMul.value,
  respawnMul: respawnMul.value,
  bleedMul: bleedMul.value,
  damageNumbers: damageNumbers.value,
  effects: effects.value,
  intentLines: intentLines.value,
  screenShake: screenShake.value,
}))

function randomSeed(): number {
  return Math.floor(100000 + Math.random() * 900000)
}

function rollSeed() {
  seed.value = randomSeed()
  seedText.value = String(seed.value)
}

function syncSeedFromText() {
  const n = Math.floor(Number(seedText.value))
  if (Number.isFinite(n) && n > 0) seed.value = Math.min(999999999, n)
}

function normalizeSeed() {
  const n = Math.floor(Number(seedText.value))
  if (!Number.isFinite(n) || n <= 0) {
    rollSeed()
    return
  }
  seed.value = Math.min(999999999, Math.max(1, n))
  seedText.value = String(seed.value)
}

function restoreDefaults() {
  baseHpMul.value = 1
  damageMul.value = 1
  respawnMul.value = 1
  bleedMul.value = 1
}

function start() {
  normalizeSeed()
  emit('start', {
    config: buildConfig({
      duration: duration.value,
      baseHpMul: baseHpMul.value,
      damageMul: damageMul.value,
      respawnMul: respawnMul.value,
      bleedMul: bleedMul.value,
    }),
    redId: redId.value,
    blackId: blackId.value,
    seed: seed.value,
    speed: speed.value,
    muted: muted.value,
    render: {
      damageNumbers: damageNumbers.value,
      effects: effects.value,
      intentLines: intentLines.value,
      screenShake: screenShake.value,
    },
  })
}

onMounted(() => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const s = JSON.parse(raw) as Partial<SavedSettings>
      // 只接受注册表里真实存在的策略 id：外部策略包被移除后，旧存档不会指向幽灵策略
      if (s.redId && findTactic(s.redId)) redId.value = s.redId
      if (s.blackId && findTactic(s.blackId)) blackId.value = s.blackId
      if (typeof s.duration === 'number') duration.value = s.duration
      if (typeof s.speed === 'number') speed.value = s.speed
      if (typeof s.muted === 'boolean') muted.value = s.muted
      if (typeof s.baseHpMul === 'number') baseHpMul.value = s.baseHpMul
      if (typeof s.damageMul === 'number') damageMul.value = s.damageMul
      if (typeof s.respawnMul === 'number') respawnMul.value = s.respawnMul
      if (typeof s.bleedMul === 'number') bleedMul.value = s.bleedMul
      if (typeof s.damageNumbers === 'boolean') damageNumbers.value = s.damageNumbers
      if (typeof s.effects === 'boolean') effects.value = s.effects
      if (typeof s.intentLines === 'boolean') intentLines.value = s.intentLines
      if (typeof s.screenShake === 'boolean') screenShake.value = s.screenShake
    }
  } catch {
    /* 忽略损坏的本地设置 */
  }
})

watch(
  settings,
  (v) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(v))
    } catch {
      /* 隐私模式下忽略 */
    }
  },
  { deep: true },
)
</script>

<template>
  <div class="min-h-screen overflow-x-clip">
    <header class="mx-auto flex max-w-[1280px] items-center justify-between gap-4 px-5 py-5 lg:px-8">
      <div class="flex items-center gap-3">
        <div class="seal h-9 w-9 text-[17px]">棋</div>
        <div class="leading-tight">
          <div class="font-display text-[17px] font-bold tracking-[0.08em] text-ink-800">棋阵</div>
          <div class="text-[9px] uppercase tracking-[0.28em] text-ink-400">Chess Formation</div>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <span class="hidden items-center gap-1.5 rounded-full border border-ink-200 bg-paper-50/60 px-2.5 py-1 text-[10px] text-ink-400 sm:flex">
          <span class="h-1.5 w-1.5 rounded-full bg-jade-500"></span>
          初版 v0.1
        </span>
        <button class="btn-ghost whitespace-nowrap !px-3 !py-2 text-xs" type="button" @click="rulesOpen = true">
          <Icon name="info" :size="15" />
          玩法
        </button>
        <button class="btn-ink hidden whitespace-nowrap !px-3.5 !py-2 text-xs sm:inline-flex" type="button" @click="start">
          直接开战
          <Icon name="arrow-left" :size="14" class="rotate-180" />
        </button>
      </div>
    </header>

    <main class="mx-auto max-w-[1280px] px-5 pb-20 lg:px-8">
      <!-- 首屏 -->
      <section class="grid items-center gap-10 pb-14 pt-6 lg:grid-cols-[1.08fr_.92fr] lg:gap-14 lg:pb-20 lg:pt-10">
        <div class="relative">
          <div class="kicker flex items-center gap-2">
            <span class="h-px w-8 bg-vermilion-500/60"></span>
            实时中国象棋 · 策略沙盘
          </div>
          <h1 class="mt-4 flex flex-wrap items-end gap-x-5 gap-y-2">
            <span class="font-display text-[76px] font-bold leading-[0.85] tracking-tight text-ink-900 sm:text-[96px]">
              棋阵
            </span>
            <span class="mb-2 flex flex-col gap-1">
              <span class="seal rotate-[-3deg] self-start px-2 py-1 text-[11px] tracking-[0.2em]">自动对战</span>
              <span class="text-[11px] font-medium tracking-[0.24em] text-ink-400">LIVE BATTLE SANDBOX</span>
            </span>
          </h1>
          <p class="mt-6 max-w-xl font-display text-[21px] leading-relaxed text-ink-700 sm:text-[24px]">
            一场不需要你走棋的象棋大战。
          </p>
          <p class="mt-3 max-w-xl text-[13px] leading-7 text-ink-500">
            红黑两军各由一套策略指挥，15 对 15 在放大的棋盘上自动厮杀。你选两套性格、调好参数，
            然后坐下来，看它们把这一仗打完。
          </p>

          <div class="mt-7 flex flex-wrap gap-2.5">
            <span class="chip !border-ink-300/60 !bg-white/60 !py-1.5">
              <Icon name="users" :size="14" class="text-vermilion-500" />
              30 个单位同场
            </span>
            <span class="chip !border-ink-300/60 !bg-white/60 !py-1.5">
              <Icon name="gauge" :size="14" class="text-jade-500" />
              8 Hz 战术决策
            </span>
            <span class="chip !border-ink-300/60 !bg-white/60 !py-1.5">
              <Icon name="rotate" :size="14" class="text-gold-500" />
              同种子可复现
            </span>
          </div>

          <div class="mt-8 flex flex-wrap items-center gap-3">
            <button class="btn-primary !px-6 !py-3" type="button" @click="start">
              <Icon name="swords" :size="17" />
              擂鼓开战
            </button>
            <a
              href="#config"
              class="btn-ghost !px-5 !py-3"
            >
              先看配置
              <Icon name="chevron-down" :size="15" />
            </a>
          </div>

          <div class="mt-10 flex items-center gap-5 border-t border-ink-200/60 pt-5">
            <div>
              <div class="num font-display text-2xl font-bold text-ink-800">{{ ALL_TACTICS.length }}</div>
              <div class="mt-0.5 text-[10px] tracking-wide text-ink-400">可用策略</div>
            </div>
            <div class="h-8 w-px bg-ink-200/70"></div>
            <div>
              <div class="num font-display text-2xl font-bold text-ink-800">15<span class="text-sm text-ink-400">v</span>15</div>
              <div class="mt-0.5 text-[10px] tracking-wide text-ink-400">满编兵力</div>
            </div>
            <div class="h-8 w-px bg-ink-200/70"></div>
            <div>
              <div class="num font-display text-2xl font-bold text-ink-800">0</div>
              <div class="mt-0.5 text-[10px] tracking-wide text-ink-400">需要你操作的棋子</div>
            </div>
          </div>
        </div>

        <div class="relative">
          <div class="pointer-events-none absolute -inset-6 -z-10 rounded-[40px] bg-gradient-to-br from-gold-300/20 via-transparent to-jade-500/10 blur-2xl" />
          <BattlePreview :red-name="redTactic.name" :black-name="blackTactic.name" />
          <div class="absolute -bottom-4 left-5 flex items-center gap-2 rounded-full border border-ink-200 bg-paper-50 px-3 py-1.5 text-[10px] text-ink-500 shadow-sm">
            <Icon name="spark" :size="12" class="text-gold-500" />
            红方兵线正在越过楚河
          </div>
        </div>
      </section>

      <!-- 配置 -->
      <section id="config" class="grid scroll-mt-6 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div class="space-y-6">
          <!-- 策略 -->
          <!-- z-20：面板自带 backdrop-filter 会形成独立层叠上下文，抬高层级让下拉选单盖住下一块面板 -->
          <div class="panel relative z-20 p-5 sm:p-6">
            <div class="flex flex-wrap items-end justify-between gap-3">
              <div>
                <div class="kicker">01 / Matchup</div>
                <h2 class="mt-1 font-display text-xl font-bold text-ink-800">选择双方策略</h2>
                <p class="mt-1 text-[11px] text-ink-400">
                  从选单里点选出阵策略。内置与外部策略分组列出，加载新的策略包后会自动出现在「外部策略」里。
                </p>
              </div>
              <span class="chip">
                <Icon name="info" :size="12" />
                策略只能表达意图，不能改规则
              </span>
            </div>

            <div class="mt-4 grid gap-3 md:grid-cols-2">
              <div class="rounded-xl border border-vermilion-600/15 bg-vermilion-600/[.03] p-2.5">
                <div class="mb-1.5 flex items-center justify-between px-0.5">
                  <div class="flex items-center gap-2">
                    <span class="h-1.5 w-1.5 rounded-full bg-vermilion-500"></span>
                    <span class="text-[11px] font-bold text-ink-700">红方</span>
                    <span class="text-[9px] font-semibold tracking-[0.18em] text-ink-300">RED · 下方</span>
                  </div>
                  <span class="text-[9px] text-ink-300">帅府</span>
                </div>
                <StrategySelect v-model="redId" :tactics="ALL_TACTICS" />
              </div>

              <div class="rounded-xl border border-ink-800/10 bg-ink-800/[.02] p-2.5">
                <div class="mb-1.5 flex items-center justify-between px-0.5">
                  <div class="flex items-center gap-2">
                    <span class="h-1.5 w-1.5 rounded-full bg-ink-800"></span>
                    <span class="text-[11px] font-bold text-ink-700">黑方</span>
                    <span class="text-[9px] font-semibold tracking-[0.18em] text-ink-300">BLACK · 上方</span>
                  </div>
                  <span class="text-[9px] text-ink-300">将府</span>
                </div>
                <StrategySelect v-model="blackId" :tactics="ALL_TACTICS" />
              </div>
            </div>

            <div class="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-ink-200/60 pt-2.5">
              <p class="text-[10px] text-ink-400">
                共 {{ ALL_TACTICS.length }} 套 · 内置 {{ BUILTIN_TACTICS.length }} · 外部
                {{ EXTERNAL_TACTICS.length }}
              </p>
              <p v-if="TACTIC_ISSUES.length" class="text-[10px] font-semibold text-amber-600">
                {{ TACTIC_ISSUES.length }} 处策略校验未通过，详见控制台
              </p>
              <p v-else class="text-[10px] text-ink-300">
                外部策略放进 <code class="font-mono text-[9px]">tactics/external/</code> 即会分组出现
              </p>
            </div>
          </div>

          <!-- 参数 -->
          <div class="panel p-5 sm:p-6">
            <div class="flex flex-wrap items-end justify-between gap-3">
              <div>
                <div class="kicker">02 / Battlefield</div>
                <h2 class="mt-1 font-display text-xl font-bold text-ink-800">战场参数</h2>
                <p class="mt-1 text-[11px] text-ink-400">改完直接开下一局生效，不影响正在进行的对局。</p>
              </div>
              <div class="flex items-center gap-2">
                <span class="chip">
                  <Icon name="timer" :size="12" />
                  {{ estimate }}
                </span>
              </div>
            </div>

            <div class="mt-6 grid gap-x-8 gap-y-6 sm:grid-cols-2">
              <div>
                <div class="label mb-2">常规局时</div>
                <SegmentedControl v-model="duration" :options="durationOptions" />
                <p class="mt-1.5 text-[10px] text-ink-300">归零后进入加时：双方基地等速流血，复活加速。</p>
              </div>
              <div>
                <div class="label mb-2">初始观战速度</div>
                <SegmentedControl v-model="speed" :options="speedOptions" />
                <p class="mt-1.5 text-[10px] text-ink-300">对局中随时可改；变速不改变结果。</p>
              </div>

              <div class="sm:col-span-2">
                <div class="label mb-2">战局种子</div>
                <div class="flex gap-2">
                  <div class="relative flex-1">
                    <input
                      v-model="seedText"
                      type="text"
                      inputmode="numeric"
                      class="h-10 w-full rounded-xl border border-ink-200 bg-paper-50/80 px-3 pr-14 font-mono text-[13px] text-ink-800 outline-none transition focus:border-ink-400 focus:bg-white"
                      placeholder="例如 427196"
                      @input="syncSeedFromText"
                      @blur="normalizeSeed"
                    />
                    <span class="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-semibold tracking-[0.16em] text-ink-300">
                      SEED
                    </span>
                  </div>
                  <button class="icon-btn !h-10 !w-10" type="button" title="随机种子" @click="rollSeed">
                    <Icon name="dice" :size="17" />
                  </button>
                </div>
                <p class="mt-1.5 text-[10px] text-ink-300">同一份数值 + 同一对策略 + 同一个种子，必然跑出同一场仗。</p>
              </div>
            </div>

            <div class="mt-6 grid gap-x-8 gap-y-1 border-t border-ink-200/60 pt-4 sm:grid-cols-2">
              <ToggleSwitch v-model="muted" label="静音" description="合成音效；关掉不影响判定" />
              <ToggleSwitch v-model="damageNumbers" label="伤害数字" description="混战中显示浮动伤害" />
              <ToggleSwitch v-model="effects" label="战场特效" description="爆炸、尘土与粒子" />
              <ToggleSwitch v-model="screenShake" label="画面震动" description="重大冲击时的镜头震动" />
              <ToggleSwitch v-model="intentLines" label="意图线" description="显示单位这一 tick 的目标连线" />
            </div>

            <div class="mt-5 border-t border-ink-200/60 pt-4">
              <button
                type="button"
                class="flex w-full items-center justify-between gap-3 text-left"
                @click="advanced = !advanced"
              >
                <span class="flex items-center gap-2">
                  <Icon name="settings" :size="15" class="text-ink-400" />
                  <span class="text-[12px] font-semibold text-ink-700">数值微调</span>
                  <span class="rounded bg-ink-800/[.06] px-1.5 py-0.5 text-[9px] text-ink-400">ADVANCED</span>
                </span>
                <Icon
                  name="chevron-down"
                  :size="15"
                  class="text-ink-300 transition-transform"
                  :class="advanced ? 'rotate-180' : ''"
                />
              </button>
              <div v-if="advanced" class="mt-5 grid gap-x-8 gap-y-5 sm:grid-cols-2">
                <NumberSlider v-model="baseHpMul" label="基地耐久" :min="0.6" :max="1.8" :step="0.05" suffix="×" hint="双方基地血量倍率" />
                <NumberSlider v-model="damageMul" label="单位伤害" :min="0.7" :max="1.4" :step="0.05" suffix="×" hint="所有单位与炮塔伤害" />
                <NumberSlider v-model="respawnMul" label="复活读条" :min="0.6" :max="1.6" :step="0.05" suffix="×" hint="越高，阵亡惩罚越重" accent="jade" />
                <NumberSlider v-model="bleedMul" label="加时流血" :min="0.6" :max="1.6" :step="0.05" suffix="×" hint="越高，加时结束得越快" accent="jade" />
                <div class="sm:col-span-2">
                  <button class="text-[11px] font-medium text-ink-400 underline decoration-ink-300 underline-offset-4 hover:text-ink-700" type="button" @click="restoreDefaults">
                    恢复默认数值
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 对战简报 -->
        <aside class="space-y-4 self-start xl:sticky xl:top-6">
          <div class="panel overflow-hidden">
            <div class="border-b border-ink-200/60 bg-gradient-to-r from-paper-100/80 to-transparent px-5 py-4">
              <div class="kicker">Match Brief</div>
              <h2 class="mt-1 font-display text-lg font-bold text-ink-800">对战简报</h2>
            </div>
            <div class="p-5">
              <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                <div class="min-w-0 text-center">
                  <div class="flex justify-center">
                    <TacticAvatar
                      v-if="redTactic.source === 'external'"
                      :author="redTactic.author"
                      size="lg"
                      team="red"
                    />
                    <div
                      v-else
                      class="flex h-11 w-11 items-center justify-center rounded-full border-2 border-vermilion-600/25 bg-vermilion-600 text-paper-50 shadow-sm"
                    >
                      <span class="font-display text-lg font-bold">{{ redTactic.glyph ?? redTactic.name.slice(0, 1) }}</span>
                    </div>
                  </div>
                  <div class="mt-2 truncate text-[12px] font-bold text-ink-800">{{ redTactic.name }}</div>
                  <div class="mt-0.5 truncate text-[10px] text-ink-500">{{ displayAuthor(redTactic.author) }}</div>
                  <div class="text-[9px] tracking-[0.16em] text-vermilion-600">红方</div>
                </div>
                <div class="font-display text-lg font-bold text-ink-300">VS</div>
                <div class="min-w-0 text-center">
                  <div class="flex justify-center">
                    <TacticAvatar
                      v-if="blackTactic.source === 'external'"
                      :author="blackTactic.author"
                      size="lg"
                      team="black"
                    />
                    <div
                      v-else
                      class="flex h-11 w-11 items-center justify-center rounded-full border-2 border-ink-800 bg-ink-800 text-paper-50 shadow-sm"
                    >
                      <span class="font-display text-lg font-bold">{{ blackTactic.glyph ?? blackTactic.name.slice(0, 1) }}</span>
                    </div>
                  </div>
                  <div class="mt-2 truncate text-[12px] font-bold text-ink-800">{{ blackTactic.name }}</div>
                  <div class="mt-0.5 truncate text-[10px] text-ink-500">{{ displayAuthor(blackTactic.author) }}</div>
                  <div class="text-[9px] tracking-[0.16em] text-ink-400">黑方</div>
                </div>
              </div>

              <div class="mt-5 space-y-2.5 border-t border-ink-200/60 pt-4 text-[11px]">
                <div class="flex items-center justify-between">
                  <span class="text-ink-400">常规局时</span>
                  <span class="font-semibold text-ink-700">{{ duration === 0 ? '不限时' : duration + ' 秒' }}</span>
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-ink-400">初始速度</span>
                  <span class="font-semibold text-ink-700">{{ speed }}×</span>
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-ink-400">战局种子</span>
                  <span class="num font-mono text-[11px] font-semibold text-ink-700">{{ seed }}</span>
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-ink-400">预计时长</span>
                  <span class="font-semibold text-ink-700">{{ estimate }}</span>
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-ink-400">胜负条件</span>
                  <span class="font-semibold text-ink-700">基地告破</span>
                </div>
              </div>

              <button class="btn-primary mt-5 w-full !py-3.5" type="button" @click="start">
                <Icon name="swords" :size="17" />
                擂鼓开战
              </button>
              <p class="mt-2.5 text-center text-[10px] text-ink-300">
                全程自动 · 可暂停 / 变速 / 点击棋子查看状态
              </p>
            </div>
          </div>

          <div class="rounded-xl border border-ink-200/70 bg-paper-50/50 p-4">
            <div class="flex items-center gap-2 text-ink-600">
              <Icon name="info" :size="14" class="text-gold-500" />
              <span class="text-[11px] font-semibold">观战提示</span>
            </div>
            <p class="mt-2 text-[10px] leading-5 text-ink-400">
              如果你只想看一场好仗，直接保持「红·全军冲锋 / 黑·防守反击」并开战。
              想检验平衡，就把同一套策略放到两边，或对调红黑。
            </p>
          </div>
        </aside>
      </section>
    </main>

    <footer class="border-t border-ink-200/60">
      <div class="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-3 px-5 py-6 text-[10px] text-ink-300 lg:px-8">
        <span>棋阵 · 实时象棋大乱斗 · 规则内核零 DOM / 可复现</span>
        <span class="flex items-center gap-3">
          <span>Canvas 2D</span>
          <span class="h-1 w-1 rounded-full bg-ink-300"></span>
          <span>Web Audio 合成</span>
          <span class="h-1 w-1 rounded-full bg-ink-300"></span>
          <span>Vue 3</span>
        </span>
      </div>
    </footer>

    <RulesModal v-if="rulesOpen" @close="rulesOpen = false" />
  </div>
</template>
