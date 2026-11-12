<script setup lang="ts">
import type { Tactic } from '../../engine/tactics/api'
import Icon from './Icon.vue'

defineProps<{
  tactic: Tactic
  selected: boolean
  side: 'red' | 'black'
  index: number
}>()

defineEmits<{ select: [] }>()
</script>

<template>
  <button
    type="button"
    class="group relative w-full overflow-hidden rounded-xl border p-3.5 text-left transition-all duration-200"
    :class="
      selected
        ? 'border-ink-800/25 bg-white shadow-[0_14px_30px_-22px_rgba(33,28,24,.75)] ring-1 ring-gold-400/40'
        : 'border-ink-200/70 bg-paper-50/60 hover:-translate-y-0.5 hover:border-ink-300 hover:bg-white/80'
    "
    @click="$emit('select')"
  >
    <span
      class="pointer-events-none absolute -right-6 -top-8 h-24 w-24 rounded-full opacity-0 blur-2xl transition group-hover:opacity-40"
      :class="tactic.accent === 'jade' ? 'bg-jade-400/30' : 'bg-vermilion-400/30'"
    />
    <div class="relative flex items-start gap-3">
      <div
        class="seal mt-0.5 h-9 w-9 shrink-0 text-[15px]"
        :class="tactic.accent === 'jade' ? 'seal-jade' : tactic.accent === 'ink' ? 'seal-ink' : ''"
      >
        <Icon v-if="tactic.id === 'charge'" name="flame" :size="17" />
        <Icon v-else-if="tactic.id === 'counter'" name="shield" :size="17" />
        <span v-else>{{ tactic.name.slice(0, 1) }}</span>
      </div>

      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span class="font-display text-[17px] font-bold leading-none text-ink-800">{{ tactic.name }}</span>
          <span class="rounded-full bg-ink-800/[.06] px-1.5 py-0.5 text-[10px] font-semibold text-ink-500">
            {{ tactic.style }}
          </span>
        </div>
        <p class="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-ink-500">
          {{ tactic.description }}
        </p>
        <div class="mt-2 flex flex-wrap gap-1">
          <span
            v-for="tag in tactic.tags"
            :key="tag"
            class="rounded border border-ink-200/70 bg-paper-100/70 px-1.5 py-0.5 text-[10px] text-ink-400"
          >
            {{ tag }}
          </span>
        </div>
      </div>

      <span
        class="mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition"
        :class="selected ? 'border-ink-800 bg-ink-800 text-paper-50' : 'border-ink-300 bg-white text-transparent'"
      >
        <svg viewBox="0 0 24 24" class="h-3 w-3" fill="none" stroke="currentColor" stroke-width="3">
          <path d="m5 13 4 4L19 7" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </span>
    </div>

    <div class="relative mt-3 flex items-center justify-between border-t border-ink-200/50 pt-2.5">
      <div class="flex items-center gap-1.5">
        <span class="text-[10px] uppercase tracking-[0.16em] text-ink-300">复杂度</span>
        <span class="flex gap-0.5">
          <span
            v-for="i in 5"
            :key="i"
            class="h-1 w-3 rounded-full"
            :class="
              i <= tactic.complexity
                ? tactic.accent === 'jade'
                  ? 'bg-jade-500'
                  : 'bg-vermilion-500'
                : 'bg-ink-200'
            "
          />
        </span>
      </div>
      <span class="text-[10px] font-medium" :class="selected ? 'text-ink-700' : 'text-ink-300'">
        {{ selected ? '出阵' : '点击选择' }}
      </span>
    </div>
  </button>
</template>
