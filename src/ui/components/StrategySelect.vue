<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { RegisteredTactic, TacticSource } from '../../engine/tactics/api'
import { displayAuthor } from '../avatars'
import Icon from './Icon.vue'
import TacticAvatar from './TacticAvatar.vue'

const props = defineProps<{
  modelValue: string
  tactics: readonly RegisteredTactic[]
}>()

const emit = defineEmits<{ 'update:modelValue': [id: string] }>()

const SOURCE_META: Record<TacticSource, { label: string; hint: string }> = {
  builtin: { label: '内置策略', hint: '随游戏发布' },
  external: { label: '外部策略', hint: '策略包加载' },
}

const open = ref(false)
const root = ref<HTMLElement | null>(null)
const activeIndex = ref(0)

/** 按来源分组，空分组不出现 */
const groups = computed(() =>
  (['builtin', 'external'] as const)
    .map((source) => ({
      source,
      ...SOURCE_META[source],
      items: props.tactics.filter((t) => t.source === source),
    }))
    .filter((g) => g.items.length > 0),
)

/** 键盘导航走的是拍平后的顺序 */
const flat = computed(() => groups.value.flatMap((g) => g.items))

const current = computed(() => flat.value.find((t) => t.id === props.modelValue) ?? flat.value[0])

function glyphOf(t: RegisteredTactic): string {
  return t.glyph ?? t.name.slice(0, 1)
}

function sealClass(t: RegisteredTactic): string {
  if (t.accent === 'jade') return 'seal-jade'
  if (t.accent === 'ink') return 'seal-ink'
  return ''
}

function indexOf(id: string): number {
  return flat.value.findIndex((t) => t.id === id)
}

function toggle(): void {
  open.value = !open.value
  if (open.value) {
    const i = indexOf(props.modelValue)
    activeIndex.value = i < 0 ? 0 : i
  }
}

function pick(id: string): void {
  emit('update:modelValue', id)
  open.value = false
}

function move(delta: number): void {
  const n = flat.value.length
  if (n === 0) return
  activeIndex.value = (activeIndex.value + delta + n) % n
}

function confirm(): void {
  const t = flat.value[activeIndex.value]
  if (t) pick(t.id)
}

function onKey(e: KeyboardEvent): void {
  if (!open.value) return
  if (e.key === 'Escape') {
    e.stopPropagation()
    open.value = false
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    move(1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    move(-1)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    confirm()
  }
}

function onDocPointer(e: PointerEvent): void {
  if (!open.value || !root.value) return
  if (!root.value.contains(e.target as Node)) open.value = false
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocPointer)
  document.addEventListener('keydown', onKey)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointer)
  document.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div ref="root" class="relative">
    <button
      v-if="current"
      type="button"
      class="group flex w-full items-start gap-2.5 rounded-xl border bg-white px-2.5 py-2.5 text-left transition"
      :class="
        open
          ? 'border-ink-800/40 ring-2 ring-gold-400/30'
          : 'border-ink-200/80 hover:border-ink-300'
      "
      :aria-expanded="open"
      aria-haspopup="listbox"
      @click="toggle"
    >
      <TacticAvatar
        v-if="current.source === 'external'"
        :author="current.author"
        size="md"
      />
      <span v-else class="seal h-9 w-9 shrink-0 text-[14px]" :class="sealClass(current)">
        {{ glyphOf(current) }}
      </span>

      <span class="min-w-0 flex-1">
        <span class="flex items-center gap-x-1.5">
          <span class="truncate font-display text-[14px] font-bold leading-none text-ink-800">
            {{ current.name }}
          </span>
          <span
            class="shrink-0 rounded-full px-1.5 py-[1px] text-[9px] font-semibold"
            :class="
              current.source === 'external'
                ? 'bg-jade-500/10 text-jade-700'
                : 'bg-ink-800/[.06] text-ink-500'
            "
          >
            {{ current.source === 'external' ? '外部' : '内置' }}
          </span>
          <span class="shrink-0 text-[9px] text-ink-300">v{{ current.version }}</span>
        </span>
        <span
          v-if="current.source === 'external'"
          class="mt-1 flex items-center gap-1.5"
        >
          <span class="inline-flex items-center gap-1 rounded-md border border-ink-200/80 bg-paper-50 px-1.5 py-[1px] text-[9px] font-medium text-ink-600">
            <span class="text-ink-300">模型/作者</span>
            <span class="font-semibold text-ink-700">{{ displayAuthor(current.author) }}</span>
          </span>
          <span class="seal h-4 w-4 text-[9px]" :class="sealClass(current)">{{ glyphOf(current) }}</span>
        </span>
        <span class="mt-1 line-clamp-2 text-[10px] leading-4 text-ink-400">
          {{ current.description }}
        </span>
      </span>

      <Icon
        name="chevron-down"
        :size="14"
        class="mt-1 shrink-0 text-ink-400 transition-transform"
        :class="open ? 'rotate-180' : ''"
      />
    </button>

    <Transition name="fade">
      <div
        v-if="open"
        class="absolute left-0 top-full z-40 mt-1.5 w-[min(340px,calc(100vw-2.5rem))] overflow-hidden rounded-xl border border-ink-200 bg-paper-50 shadow-float"
        role="listbox"
      >
        <div class="flex items-center justify-between border-b border-ink-200/70 px-3 py-1.5">
          <span class="kicker !text-[9px]">选择策略</span>
          <span class="text-[9px] text-ink-300">{{ tactics.length }} 套可用</span>
        </div>

        <div class="max-h-[300px] overflow-y-auto p-1">
          <div v-for="g in groups" :key="g.source">
            <!-- 分组抬头 -->
            <div class="flex items-center gap-2 px-2 pb-1 pt-2">
              <span class="text-[9px] font-bold tracking-[0.16em] text-ink-400">{{ g.label }}</span>
              <span class="h-px flex-1 bg-ink-200/70"></span>
              <span class="text-[9px] text-ink-300">{{ g.hint }}</span>
            </div>

            <button
              v-for="t in g.items"
              :key="t.id"
              type="button"
              role="option"
              :aria-selected="t.id === modelValue"
              class="flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left transition"
              :class="
                indexOf(t.id) === activeIndex
                  ? 'bg-white shadow-[0_8px_18px_-16px_rgba(33,28,24,.7)]'
                  : 'hover:bg-white/70'
              "
              @mouseenter="activeIndex = indexOf(t.id)"
              @click="pick(t.id)"
            >
              <TacticAvatar
                v-if="t.source === 'external'"
                :author="t.author"
                size="sm"
                class="mt-0.5"
              />
              <span v-else class="seal mt-0.5 h-7 w-7 shrink-0 text-[12px]" :class="sealClass(t)">
                {{ glyphOf(t) }}
              </span>
              <span class="min-w-0 flex-1">
                <span class="flex items-center gap-x-1.5">
                  <span class="truncate font-display text-[13px] font-bold text-ink-800">
                    {{ t.name }}
                  </span>
                  <span class="shrink-0 text-[9px] text-ink-300">v{{ t.version }}</span>
                </span>
                <span
                  v-if="t.source === 'external'"
                  class="mt-0.5 flex items-center gap-1.5"
                >
                  <span class="inline-flex items-center gap-1 rounded border border-ink-200/70 bg-paper-100/70 px-1.5 py-[1px] text-[9px] text-ink-600">
                    <span class="text-ink-300">模型</span>
                    <span class="font-semibold text-ink-700">{{ displayAuthor(t.author) }}</span>
                  </span>
                </span>
                <span class="mt-0.5 line-clamp-2 text-[10px] leading-4 text-ink-400">
                  {{ t.description }}
                </span>
              </span>
              <Icon
                v-if="t.id === modelValue"
                name="target"
                :size="13"
                class="mt-1 shrink-0 text-ink-600"
              />
            </button>
          </div>
        </div>

        <div class="border-t border-ink-200/70 px-3 py-1.5 text-[9px] text-ink-300">
          策略只能表达意图 · 外部策略放进 tactics/external/ 后出现在上面的分组里
        </div>
      </div>
    </Transition>
  </div>
</template>
