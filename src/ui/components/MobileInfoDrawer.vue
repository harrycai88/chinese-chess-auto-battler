<script setup lang="ts">
import { computed } from 'vue'
import { UNIT_META } from '../../engine/config'
import type { Hud, LogItem } from '../composables/useBattle'
import Icon from './Icon.vue'

const props = defineProps<{ hud: Hud; logs: LogItem[] }>()
const emit = defineEmits<{ close: [] }>()

const selected = computed(() => props.hud.selected)
const selectedChar = computed(() =>
  selected.value ? UNIT_META[selected.value.type].chars[selected.value.team] : '',
)
const selectedMeta = computed(() => (selected.value ? UNIT_META[selected.value.type] : null))

function fmt(n: number): string {
  if (n >= 10000) return `${(n / 1000).toFixed(1)}k`
  return `${Math.round(n)}`
}

function logTime(t: number): string {
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 xl:hidden">
      <div class="absolute inset-0 bg-ink-900/30 backdrop-blur-[2px]" @click="emit('close')" />
      <div class="absolute right-0 top-0 flex h-full w-[356px] max-w-[94vw] flex-col border-l border-ink-200 bg-paper-50 shadow-float">
        <div class="flex items-center justify-between border-b border-ink-200/70 px-4 py-3">
          <div>
            <div class="kicker">Battle Intel</div>
            <div class="mt-0.5 font-display text-lg font-bold text-ink-800">战场详情</div>
          </div>
          <button class="icon-btn" type="button" @click="emit('close')">
            <Icon name="x" :size="16" />
          </button>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <!-- 选中单位 -->
          <div v-if="selected" class="rounded-xl border border-ink-200/70 bg-white/60 p-3">
            <div class="flex items-center gap-3">
              <div
                class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 font-display text-lg font-bold"
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
                  <span class="font-display text-base font-bold text-ink-800">{{ selected.name }}</span>
                  <span class="text-[9px] text-ink-400">{{ selected.team === 'red' ? '红方' : '黑方' }}</span>
                </div>
                <div class="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-900/[.07]">
                  <div
                    class="h-full rounded-full"
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
              <div class="num shrink-0 font-mono text-[10px] text-ink-500">
                {{ Math.max(0, Math.round(selected.hp)) }}
              </div>
            </div>
            <div class="mt-2.5 grid grid-cols-2 gap-1.5 text-[10px]">
              <div class="rounded-md bg-paper-100/80 px-2 py-1.5">
                <div class="text-[8px] text-ink-300">意图</div>
                <div class="mt-0.5 truncate font-medium text-ink-700">{{ selected.alive ? selected.intent : '已阵亡' }}</div>
              </div>
              <div class="rounded-md bg-paper-100/80 px-2 py-1.5">
                <div class="text-[8px] text-ink-300">形态 / 技能</div>
                <div class="mt-0.5 truncate font-medium text-ink-700">
                  {{ selected.alive ? selected.skill || '无' : selected.respawnIn > 0 ? `复活 ${selected.respawnIn.toFixed(0)}s` : '本局离场' }}
                </div>
              </div>
            </div>
            <p class="mt-2 text-[9px] leading-relaxed text-ink-400">{{ selectedMeta?.blurb }}</p>
          </div>

          <div v-else class="rounded-xl border border-dashed border-ink-200/80 bg-white/30 px-3 py-4 text-center">
            <div class="flex justify-center text-ink-300"><Icon name="target" :size="18" /></div>
            <div class="mt-1.5 text-[10px] text-ink-500">点击棋盘上的棋子查看状态</div>
          </div>

          <!-- 战况 -->
          <div class="mt-4 grid grid-cols-2 gap-2">
            <div class="rounded-lg border border-vermilion-600/15 bg-vermilion-600/[.04] p-2.5">
              <div class="flex items-center gap-1 text-[9px] text-vermilion-600">
                <span class="h-1 w-1 rounded-full bg-vermilion-500"></span>红方
              </div>
              <div class="mt-1 flex items-baseline gap-1">
                <span class="num font-mono text-lg font-bold text-ink-800">{{ hud.redAlive }}</span>
                <span class="text-[9px] text-ink-400">存活</span>
              </div>
              <div class="mt-1 text-[9px] text-ink-400">伤害 {{ fmt(hud.red.damage) }} · 攻城 {{ fmt(hud.red.siege) }}</div>
            </div>
            <div class="rounded-lg border border-ink-800/10 bg-ink-800/[.03] p-2.5">
              <div class="flex items-center gap-1 text-[9px] text-ink-600">
                <span class="h-1 w-1 rounded-full bg-ink-700"></span>黑方
              </div>
              <div class="mt-1 flex items-baseline gap-1">
                <span class="num font-mono text-lg font-bold text-ink-800">{{ hud.blackAlive }}</span>
                <span class="text-[9px] text-ink-400">存活</span>
              </div>
              <div class="mt-1 text-[9px] text-ink-400">伤害 {{ fmt(hud.black.damage) }} · 攻城 {{ fmt(hud.black.siege) }}</div>
            </div>
          </div>

          <!-- 日志 -->
          <div class="mt-5 flex items-center justify-between">
            <span class="kicker">Battle Log</span>
            <span class="text-[9px] text-ink-300">{{ logs.length }} 条</span>
          </div>
          <div class="mt-2 space-y-1">
            <div v-for="item in logs" :key="item.id" class="flex items-start gap-2 rounded px-1.5 py-1">
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
            <div v-if="!logs.length" class="py-4 text-center text-[10px] text-ink-300">战斗事件会在这里出现</div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
